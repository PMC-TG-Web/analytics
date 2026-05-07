import { NextResponse } from 'next/server';
import { getCachedValue, setCachedValue } from '@/lib/serverReadCache';

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
const DEFAULT_LOCATION = 'Quarryville, PA';
const WEATHER_CACHE_KEY = 'weather:default';
const WEATHER_CACHE_TTL_MS = 2 * 60 * 1000;
const WEATHER_FALLBACK_CACHE_TTL_MS = 15 * 1000;

function getIcon(code: number | null | undefined) {
  if (code === 0) return '☀';
  if (typeof code !== 'number') return '☁';
  if (code >= 1 && code <= 3) return '⛅';
  if (code >= 45 && code <= 48) return '🌫';
  if (code >= 51 && code <= 67) return '🌧';
  if (code >= 71 && code <= 77) return '❄';
  if (code >= 80 && code <= 82) return '🌦';
  if (code >= 95) return '⛈';
  return '☁';
}

function getCondition(code: number | null | undefined) {
  if (code === 0) return 'Clear';
  if (typeof code !== 'number') return 'Unavailable';
  if (code >= 1 && code <= 3) return 'Partly Cloudy';
  if (code >= 45 && code <= 48) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Raining';
  if (code >= 71 && code <= 77) return 'Snowing';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Stormy';
  return 'Cloudy';
}

function celsiusToFahrenheit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round((value * 9) / 5 + 32);
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

function buildOpenMeteoUrl() {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(DEFAULT_LAT));
  url.searchParams.set('longitude', String(DEFAULT_LON));
  url.searchParams.set('current_weather', 'true');
  url.searchParams.set('hourly', 'temperature_2m,weathercode');
  url.searchParams.set('daily', 'weathercode,temperature_2m_max,temperature_2m_min');
  url.searchParams.set('timezone', 'auto');
  return url;
}

function mapOpenMeteoWeather(weatherData: any): WeatherPayload | null {
  if (!weatherData?.current_weather || !weatherData?.hourly?.time || !weatherData?.daily?.time) {
    return null;
  }

  const code = weatherData.current_weather.weathercode;
  const now = new Date();
  now.setMinutes(0, 0, 0);
  let startIndex = weatherData.hourly.time.findIndex((time: string) => new Date(time) >= now);
  if (startIndex === -1) startIndex = new Date().getHours();

  const hourly = weatherData.hourly.time.slice(startIndex, startIndex + 8).map((time: string, index: number) => {
    const sourceIndex = startIndex + index;
    return {
      time: new Date(time).toLocaleTimeString([], { hour: 'numeric' }),
      temp: celsiusToFahrenheit(weatherData.hourly.temperature_2m?.[sourceIndex]),
      icon: getIcon(weatherData.hourly.weathercode?.[sourceIndex]),
    };
  });

  const daily = weatherData.daily.time.slice(0, 7).map((time: string, index: number) => ({
    date: new Date(time).toLocaleDateString([], { weekday: 'short' }),
    high: celsiusToFahrenheit(weatherData.daily.temperature_2m_max?.[index]),
    low: celsiusToFahrenheit(weatherData.daily.temperature_2m_min?.[index]),
    icon: getIcon(weatherData.daily.weathercode?.[index]),
  }));

  return {
    temp: celsiusToFahrenheit(weatherData.current_weather.temperature),
    condition: getCondition(code),
    icon: getIcon(code),
    location: DEFAULT_LOCATION,
    hourly,
    daily,
  };
}

export async function GET() {
  const cached = getCachedValue<WeatherPayload>(WEATHER_CACHE_KEY);
  if (cached) {
    const response = NextResponse.json(cached);
    response.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    response.headers.set('X-Cache', 'HIT');
    return response;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(buildOpenMeteoUrl(), {
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}`);
    }

    const weather = mapOpenMeteoWeather(await response.json()) || fallbackWeather();
    setCachedValue(WEATHER_CACHE_KEY, weather, WEATHER_CACHE_TTL_MS);

    const successResponse = NextResponse.json(weather);
    successResponse.headers.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    successResponse.headers.set('X-Cache', 'MISS');
    return successResponse;
  } catch (error) {
    console.warn('[weather] Falling back after forecast fetch failed:', error instanceof Error ? error.message : String(error));
    const fallback = fallbackWeather();
    setCachedValue(WEATHER_CACHE_KEY, fallback, WEATHER_FALLBACK_CACHE_TTL_MS);

    const fallbackResponse = NextResponse.json(fallback);
    fallbackResponse.headers.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    fallbackResponse.headers.set('X-Cache', 'MISS');
    return fallbackResponse;
  } finally {
    clearTimeout(timeout);
  }
}