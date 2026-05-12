import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type WeatherPayload = {
  temp: number | null;
  condition: string;
  icon: string;
  location: string;
  hourly: { time: string; temp: number | null; icon: string }[];
  daily: { date: string; low: number | null; high: number | null; icon: string }[];
  unavailable?: boolean;
};

const DEFAULT_LAT = 40.06;
const DEFAULT_LON = -76.2;
const DEFAULT_LOCATION = 'Paradise, PA';
const WEATHER_GOV_USER_AGENT = 'AnalyticsApp/1.0 (weather route)';

function clampCoordinate(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveCoordinates(request: NextRequest) {
  const latParam = Number.parseFloat(String(request.nextUrl.searchParams.get('lat') || '').trim());
  const lonParam = Number.parseFloat(String(request.nextUrl.searchParams.get('lon') || '').trim());

  if (Number.isFinite(latParam) && Number.isFinite(lonParam)) {
    return {
      latitude: clampCoordinate(latParam, -90, 90),
      longitude: clampCoordinate(lonParam, -180, 180),
      usedBrowserCoordinates: true,
    };
  }

  return {
    latitude: DEFAULT_LAT,
    longitude: DEFAULT_LON,
    usedBrowserCoordinates: false,
  };
}

function getIconFromForecast(value: unknown) {
  const forecast = String(value || '').toLowerCase();
  if (!forecast) return '☁';
  if (forecast.includes('thunder')) return '⛈';
  if (forecast.includes('snow') || forecast.includes('sleet')) return '❄';
  if (forecast.includes('rain') || forecast.includes('shower') || forecast.includes('drizzle')) return '🌧';
  if (forecast.includes('fog') || forecast.includes('mist')) return '🌫';
  if (forecast.includes('sunny') || forecast.includes('clear')) return '☀';
  if (forecast.includes('partly') || forecast.includes('mostly sunny')) return '⛅';
  return '☁';
}

function fallbackWeather(): WeatherPayload {
  const now = new Date();
  now.setMinutes(0, 0, 0);

  const hourly = Array.from({ length: 8 }, (_, index) => {
    const time = new Date(now);
    time.setHours(now.getHours() + index);
    return {
      time: time.toLocaleTimeString([], { hour: 'numeric' }),
      temp: null,
      icon: '☁',
    };
  });

  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      date: date.toLocaleDateString([], { weekday: 'short' }),
      high: null,
      low: null,
      icon: '☁',
    };
  });

  return {
    temp: null,
    condition: 'Unavailable',
    icon: '☁',
    location: DEFAULT_LOCATION,
    hourly,
    daily,
    unavailable: true,
  };
}

async function fetchWeatherGovJson(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/geo+json',
      'User-Agent': WEATHER_GOV_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`weather.gov returned ${response.status}`);
  }

  return response.json();
}

function mapWeatherGovWeather(
  pointsData: any,
  hourlyData: any,
  forecastData: any,
  options?: { preferDefaultLocation?: boolean }
): WeatherPayload | null {
  const hourlyPeriods = hourlyData?.properties?.periods;
  const forecastPeriods = forecastData?.properties?.periods;

  if (!Array.isArray(hourlyPeriods) || hourlyPeriods.length === 0 || !Array.isArray(forecastPeriods) || forecastPeriods.length === 0) {
    return null;
  }
  const currentPeriod = hourlyPeriods[0];
  const hourly = hourlyPeriods.slice(0, 8).map((period: any) => ({
    time: new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' }),
    temp: typeof period.temperature === 'number' ? period.temperature : null,
    icon: getIconFromForecast(period.shortForecast),
  }));

  const daytimePeriods = forecastPeriods.filter((period: any) => period?.isDaytime === true).slice(0, 7);
  const daily = daytimePeriods.map((period: any) => {
    const overnight = forecastPeriods.find(
      (candidate: any) => candidate?.isDaytime === false && new Date(candidate.startTime) > new Date(period.startTime)
    );

    return {
      date: new Date(period.startTime).toLocaleDateString([], { weekday: 'short' }),
      high: typeof period.temperature === 'number' ? period.temperature : null,
      low: typeof overnight?.temperature === 'number' ? overnight.temperature : null,
      icon: getIconFromForecast(period.shortForecast),
    };
  });

  const city = String(pointsData?.properties?.relativeLocation?.properties?.city || '').trim();
  const state = String(pointsData?.properties?.relativeLocation?.properties?.state || '').trim();
  const location = options?.preferDefaultLocation
    ? DEFAULT_LOCATION
    : city && state
      ? `${city}, ${state}`
      : DEFAULT_LOCATION;

  return {
    temp: typeof currentPeriod.temperature === 'number' ? currentPeriod.temperature : null,
    condition: String(currentPeriod.shortForecast || 'Unavailable'),
    icon: getIconFromForecast(currentPeriod.shortForecast),
    location,
    hourly,
    daily,
  };
}

export async function GET(request: NextRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const { latitude, longitude, usedBrowserCoordinates } = resolveCoordinates(request);
    const pointsData = await fetchWeatherGovJson(`https://api.weather.gov/points/${latitude},${longitude}`, controller.signal);
    const forecastUrl = String(pointsData?.properties?.forecast || '').trim();
    const forecastHourlyUrl = String(pointsData?.properties?.forecastHourly || '').trim();

    if (!forecastUrl || !forecastHourlyUrl) {
      throw new Error('weather.gov points response missing forecast URLs');
    }

    const [hourlyData, forecastData] = await Promise.all([
      fetchWeatherGovJson(forecastHourlyUrl, controller.signal),
      fetchWeatherGovJson(forecastUrl, controller.signal),
    ]);

    const weather = mapWeatherGovWeather(pointsData, hourlyData, forecastData, {
      preferDefaultLocation: !usedBrowserCoordinates,
    });
    return NextResponse.json(weather || fallbackWeather());
  } catch (error) {
    console.warn('[weather] Falling back after forecast fetch failed:', error instanceof Error ? error.message : String(error));
    return NextResponse.json(fallbackWeather());
  } finally {
    clearTimeout(timeout);
  }
}