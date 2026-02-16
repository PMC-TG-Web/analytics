"use client";

import React, { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { collection, getDocs, query, orderBy, limit } from "firebase/firestore";
import { db } from "@/firebase";
import ProtectedPage from "@/components/ProtectedPage";
import Navigation from "@/components/Navigation";

interface Announcement {
  id: string;
  title: string;
  content: string;
  date: string;
  author: string;
  important?: boolean;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  hireDate?: string;
  role?: string;
}

interface WeatherData {
  temp: number;
  condition: string;
  icon: string;
  location: string;
  hourly: { time: string; temp: number; icon: string }[];
  daily: { date: string; low: number; high: number; icon: string }[];
}

const SAFETY_TOPICS = [
  {
    month: "January",
    title: "Silica Dust Exposure Protection",
    content: "When cutting, grinding, or drilling concrete, always use water-fed tools or HEPA-filtered vacuums. Ensure respirators are worn when required.",
    source: "OSHA Concrete Safety"
  },
  {
    month: "February",
    title: "Cold Weather Concrete Placement",
    content: "Protect concrete from freezing until it reaches 500 psi. Use insulating blankets and heated enclosures when temperatures drop below 40°F.",
    source: "ACI 306R-16"
  },
  {
    month: "March",
    title: "Fall Protection & Guardrails",
    content: "Guardrails or personal fall arrest systems are required for heights over 6 feet. Inspect all harnesses and lanyards before use.",
    source: "Safety Standards"
  },
  {
    month: "April",
    title: "Safe Operation of Power Trowels",
    content: "Keep hands and feet away from rotating blades. Always wear proper footwear and ensure the 'dead-man' switch is functioning correctly.",
    source: "Equipment Safety Manual"
  },
  {
    month: "May",
    title: "Proper Lifting Techniques",
    content: "Lift with your legs, not your back. Get help for loads over 50 lbs. Keep the load close to your body while moving.",
    source: "OSHA Guidelines"
  },
  {
    month: "June",
    title: "Heat Stress Prevention",
    content: "Drink water every 15 minutes, even if not thirsty. Wear light-colored clothing and take breaks in the shade. Watch for signs of heat exhaustion.",
    source: "NIOSH Heat Safety"
  },
  {
    month: "July",
    title: "Personal Protective Equipment (PPE)",
    content: "Hard hats, safety glasses, and high-visibility vests are mandatory at all times. Use gloves when handling wet concrete to prevent skin burns.",
    source: "Company Policy"
  },
  {
    month: "August",
    title: "Electrical Safety on Site",
    content: "Inspect extension cords for damage. Use GFCI protection for all power tools. Keep electrical equipment away from wet concrete areas.",
    source: "Electrical Standards"
  },
  {
    month: "September",
    title: "Trenching and Excavation",
    content: "Ensure proper shoring or sloping for trenches deeper than 5 feet. Keep excavated materials at least 2 feet away from the edge.",
    source: "OSHA Subpart P"
  },
  {
    month: "October",
    title: "Fire Prevention & Extinguishers",
    content: "Keep flammable liquids in approved containers. Know the location of the nearest fire extinguisher and how to use the PASS method.",
    source: "Fire Safety"
  },
  {
    month: "November",
    title: "Hand & Power Tool Safety",
    content: "Use the right tool for the job. Never remove safety guards. Disconnect tools before changing bits or blades.",
    source: "General Safety"
  },
  {
    month: "December",
    title: "Ladder and Scaffold Safety",
    content: "Maintain 3 points of contact on ladders. Scaffolds must be level and fully planked. Never use a damaged ladder.",
    source: "Scaffolding Safety"
  }
];

export default function Home() {
  return (
    <ProtectedPage page="home">
      <HomeContent />
    </ProtectedPage>
  );
}

function HomeContent() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        // Load Announcements
        const annSnapshot = await getDocs(query(collection(db, "announcements"), orderBy("date", "desc"), limit(5)));
        const annData = annSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Announcement));
        setAnnouncements(annData);

        // Load Employees for Anniversaries
        const empSnapshot = await getDocs(collection(db, "employees"));
        const empData = empSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
        setEmployees(empData.filter(e => e.hireDate));

        // Load Weather (Using Open-Meteo for Quarryville, PA)
        try {
          const lat = 40.06;
          const lon = -76.20;
          const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=temperature_2m,weathercode&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto`);
          const weatherData = await weatherRes.json();
          if (weatherData.current_weather) {
            const tempF = Math.round((weatherData.current_weather.temperature * 9 / 5) + 32);
            const code = weatherData.current_weather.weathercode;
            
            const getIcon = (c: number) => {
              if (c === 0) return "☀";
              if (c >= 1 && c <= 3) return "⛅";
              if (c >= 45 && c <= 48) return "🌫";
              if (c >= 51 && c <= 67) return "🌧";
              if (c >= 71 && c <= 77) return "❄";
              if (c >= 80 && c <= 82) return "🌦";
              if (c >= 95) return "⛈";
              return "☁";
            };

            const getCondition = (c: number) => {
              if (c === 0) return "Clear";
              if (c >= 1 && c <= 3) return "Partly Cloudy";
              if (c >= 45 && c <= 48) return "Foggy";
              if (c >= 51 && c <= 67) return "Raining";
              if (c >= 71 && c <= 77) return "Snowing";
              if (c >= 80 && c <= 82) return "Showers";
              if (c >= 95) return "Stormy";
              return "Cloudy";
            };

            // Process Hourly (Next 8 hours)
            const now = new Date();
            now.setMinutes(0, 0, 0);
            
            // Find the index of the current hour in the record
            let startIndex = weatherData.hourly.time.findIndex((t: string) => new Date(t) >= now);
            if (startIndex === -1) startIndex = new Date().getHours();

            const hourly = weatherData.hourly.time.slice(startIndex, startIndex + 8).map((t: string, i: number) => ({
              time: new Date(t).toLocaleTimeString([], { hour: 'numeric' }),
              temp: Math.round((weatherData.hourly.temperature_2m[startIndex + i] * 9/5) + 32),
              icon: getIcon(weatherData.hourly.weathercode[startIndex + i])
            }));

            // Process Daily (7 days)
            const daily = weatherData.daily.time.map((t: string, i: number) => ({
              date: new Date(t).toLocaleDateString([], { weekday: 'short' }),
              high: Math.round((weatherData.daily.temperature_2m_max[i] * 9/5) + 32),
              low: Math.round((weatherData.daily.temperature_2m_min[i] * 9/5) + 32),
              icon: getIcon(weatherData.daily.weathercode[i])
            }));

            setWeather({
              temp: tempF,
              condition: getCondition(code),
              icon: getIcon(code),
              location: "Quarryville, PA",
              hourly,
              daily
            });
          }
        } catch (wErr) {
          console.error("Weather fetch failed:", wErr);
        }
      } catch (error) {
        console.error("Error fetching home page data:", error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const currentMonthIdx = new Date().getMonth();
  const currentSafetyTopic = SAFETY_TOPICS[currentMonthIdx];

  const anniversaries = useMemo(() => {
    const today = new Date();
    const currentMonth = today.getMonth();
    
    return employees
      .filter(emp => {
        if (!emp.hireDate) return false;
        const hireDate = new Date(emp.hireDate);
        return hireDate.getMonth() === currentMonth;
      })
      .map(emp => {
        const hireDate = new Date(emp.hireDate!);
        const years = today.getFullYear() - hireDate.getFullYear();
        return { ...emp, years };
      })
      .filter(emp => emp.years > 0)
      .sort((a, b) => {
        const dateA = new Date(a.hireDate!).getDate();
        const dateB = new Date(b.hireDate!).getDate();
        return dateA - dateB;
      });
  }, [employees]);

  return (
    <main className="min-h-screen bg-neutral-100 text-slate-900 font-sans p-2 md:p-4">
      <div className="w-full flex flex-col min-h-[calc(100vh-2rem)] bg-white shadow-2xl rounded-3xl overflow-hidden border border-gray-200 p-4 md:p-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 md:mb-10 border-b border-gray-100 pb-8">
          <div className="flex items-center gap-6">
            <div className="relative w-32 h-16 md:w-48 md:h-24">
              <Image 
                src="/logo.png" 
                alt="Paradise Masonry Logo" 
                fill
                className="object-contain"
                priority
              />
            </div>
            <div className="h-12 w-px bg-gray-200 hidden md:block"></div>
            <div>
              <h1 className="text-red-900 text-2xl md:text-3xl font-black tracking-tighter uppercase italic leading-none">
                Hub <span className="text-stone-800">Central</span>
              </h1>
              <p className="text-gray-500 font-bold italic text-[9px] md:text-[11px] mt-1.5 max-w-xs md:max-w-md border-l-2 border-red-900/20 pl-3">
                "Shaping the world we live in, by pouring into the foundation of our community."
              </p>
            </div>
          </div>
          <Navigation currentPage="home" />
        </div>

        {/* Company Identity Card */}
        <div className="bg-stone-800 rounded-3xl shadow-xl mb-8 md:mb-10 overflow-hidden relative group border border-stone-700">
          <div className="absolute top-0 right-0 w-64 h-64 bg-red-900/10 rounded-full -mr-32 -mt-32 blur-3xl group-hover:bg-red-900/20 transition-colors duration-700"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-red-900/5 rounded-full -ml-32 -mb-32 blur-3xl"></div>
          
          <div className="relative p-6 md:p-10">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12">
              {/* Left Column: Mission & Vision */}
              <div className="lg:col-span-7 space-y-8 md:space-y-10">
                <div>
                  <h3 className="text-red-500 text-[10px] md:text-[11px] font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-red-900"></span>
                    Our Mission
                  </h3>
                  <p className="text-xl md:text-3xl font-black text-white italic leading-tight tracking-tight">
                    "Shaping the world we live in, by pouring into the foundation of our community."
                  </p>
                </div>

                <div className="pt-8 border-t border-stone-700/50">
                  <h3 className="text-stone-400 text-[10px] md:text-[11px] font-black uppercase tracking-[0.3em] mb-4 flex items-center gap-3">
                    <span className="w-8 h-px bg-stone-600"></span>
                    Company Vision
                  </h3>
                  <div className="space-y-4">
                    <p className="text-xs md:text-lg font-bold text-stone-100 leading-relaxed">
                      To continue growth in both culture and business, empowering employees to provide for themselves and their families while striving to be the preferred concrete contractor in the region.
                    </p>
                    <p className="text-[10px] md:text-xs text-stone-400 font-medium leading-relaxed max-w-2xl italic">
                      Applying the Serving Leadership model to fulfill dreams and glorifying God by being faithful stewards of all that is entrusted to us.
                    </p>
                  </div>
                </div>
              </div>

              {/* Right Column: Values */}
              <div className="lg:col-span-5 bg-black/20 rounded-3xl p-6 md:p-8 border border-white/5 backdrop-blur-sm">
                <h3 className="text-white text-[10px] md:text-[11px] font-black uppercase tracking-[0.3em] mb-6 flex items-center justify-between">
                  Core Values
                </h3>
                <div className="space-y-3 md:space-y-4">
                  {[
                    { id: '1', title: 'Serving Leadership', sub: 'Christian Values' },
                    { id: '2', title: 'Safety', sub: 'Zero Compromise' },
                    { id: '3', title: 'Quality', sub: 'Standard of Excellence' },
                    { id: '4', title: 'Excellent Experience', sub: 'For our people' },
                    { id: '5', title: 'Efficiency', sub: 'Profitability' },
                  ].map((v) => (
                    <div key={v.id} className="flex items-center gap-4 group/item">
                      <div className="w-8 h-8 rounded-xl bg-red-900/30 flex items-center justify-center text-red-500 font-black text-xs group-hover/item:bg-red-900 group-hover/item:text-white transition-all">
                        {v.id}
                      </div>
                      <div>
                        <div className="text-white font-black text-[11px] md:text-sm uppercase tracking-wide">{v.title}</div>
                        <div className="text-[8px] md:text-[10px] font-bold text-stone-500 uppercase tracking-widest mt-0.5">{v.sub}</div>
                      </div>
                    </div>
                  ))}
                </div>
                
                <div className="mt-8 pt-6 border-t border-white/5">
                  <p className="text-[9px] md:text-[10px] font-black uppercase text-stone-500 tracking-[0.2em] leading-relaxed italic">
                    Built on the bedrock of integrity, honest feedback, & continuous Innovation.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 md:gap-8 flex-1">
          {/* Main Content Column */}
          <div className="order-2 lg:order-1 lg:col-span-8 xl:col-span-9 space-y-6 md:space-y-8">
            {/* Safety Topic Section */}
            <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100 overflow-hidden relative group">
              <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                <svg className="w-40 h-40 text-red-900" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 4.946-2.597 9.181-6.5 11.5a11.954 11.954 0 01-3.5-2.001c-3.903-2.319-6.5-6.554-6.5-11.5 0-.68.056-1.35.166-2.001zM10 2a1 1 0 00-1 1v1h2V3a1 1 0 00-1-1zM4 6h12v1H4V6zm2 2v7h1V8H6zm3 0v7h1V8H9zm3 0v7h1V8h-1z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="relative">
                <div className="flex items-center gap-3 mb-4 md:mb-6">
                  <div className="px-3 py-1 bg-red-900 text-white text-[9px] md:text-[10px] font-black uppercase tracking-widest rounded-full whitespace-nowrap shadow-sm">Monthly Safety Topic</div>
                  <div className="text-red-900/40 font-black italic text-sm md:text-base">{currentSafetyTopic.month}</div>
                </div>
                <h2 className="text-2xl md:text-3xl font-black text-stone-800 uppercase tracking-tight mb-3 md:mb-4">
                  {currentSafetyTopic.title}
                </h2>
                <p className="text-base md:text-lg text-gray-600 leading-relaxed max-w-2xl mb-6 font-medium">
                  {currentSafetyTopic.content}
                </p>
                <div className="flex items-center gap-2 text-[10px] md:text-xs font-bold text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600"></span>
                  Source: {currentSafetyTopic.source}
                </div>
              </div>
            </section>

            {/* Announcements Section */}
            <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
              <div className="flex justify-between items-center mb-6 md:mb-8">
                <h2 className="text-xl md:text-2xl font-black text-stone-800 uppercase tracking-tight flex items-center gap-2 md:gap-3">
                  <div className="w-1.5 md:w-2 h-6 md:h-8 bg-red-900 rounded-full"></div>
                  Company Communication
                </h2>
                <button className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-red-700 hover:text-red-900 transition-colors">
                  View All
                </button>
              </div>

              {loading ? (
                <div className="flex items-center gap-3 italic text-gray-400 font-medium py-4">
                  <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                  Loading...
                </div>
              ) : announcements.length === 0 ? (
                <div className="bg-gray-50 rounded-2xl p-8 md:p-10 text-center border-2 border-dashed border-gray-100">
                   <div className="text-gray-400 font-bold italic mb-2 text-sm md:text-base">No recent announcements.</div>
                   <p className="text-[9px] md:text-xs text-gray-400 uppercase tracking-widest font-black">Innovation in Concrete</p>
                </div>
              ) : (
                <div className="space-y-4 md:space-y-6">
                  {announcements.map((ann) => (
                    <div key={ann.id} className="p-5 md:p-6 bg-gray-50 rounded-2xl border border-transparent hover:border-red-100 transition-all group">
                      <div className="flex justify-between items-start mb-2 md:mb-3">
                        <h3 className="text-lg md:text-xl font-black text-stone-800 group-hover:text-red-700 transition-colors">
                          {ann.title}
                        </h3>
                        {ann.important && (
                          <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[7px] md:text-[8px] font-black uppercase tracking-widest rounded shadow-sm">Important</span>
                        )}
                      </div>
                      <p className="text-gray-600 leading-relaxed mb-4 text-xs md:text-sm font-medium">
                        {ann.content}
                      </p>
                      <div className="flex items-center gap-3 md:gap-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-gray-400">
                        <span>{ann.author}</span>
                        <span className="w-1 h-1 rounded-full bg-gray-200"></span>
                        <span>{new Date(ann.date).toLocaleDateString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Sidebar Column */}
          <div className="order-1 lg:order-2 lg:col-span-4 xl:col-span-3 space-y-6 md:space-y-8">
            {/* Employee Anniversaries */}
            <section className="bg-stone-800 rounded-3xl p-6 md:p-8 shadow-xl text-white relative overflow-hidden">
               <div className="absolute top-0 right-0 w-32 h-32 bg-red-900/10 rounded-full -mr-16 -mt-16"></div>
               <div className="relative">
                <h2 className="text-lg md:text-xl font-black uppercase tracking-tight mb-6 flex items-center gap-3 italic">
                  <span className="text-red-700 text-xl md:text-2xl">★</span>
                  Anniversaries
                </h2>
                
                {anniversaries.length === 0 ? (
                  <div className="text-stone-400 font-bold italic text-xs md:text-sm">No anniversaries this month.</div>
                ) : (
                  <div className="space-y-4">
                    {anniversaries.map((emp) => (
                      <div key={emp.id} className="flex items-center gap-3 md:gap-4 p-3 md:p-4 bg-white/5 rounded-2xl border border-white/5">
                        <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-red-700 to-red-950 flex items-center justify-center font-black text-lg md:text-xl shadow-lg border-2 border-white/10 flex-shrink-0">
                          {emp.firstName[0]}{emp.lastName[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-base md:text-lg leading-none mb-1 truncate">
                            {emp.firstName} {emp.lastName}
                          </p>
                          <p className="text-red-400 text-[9px] md:text-[10px] font-black uppercase tracking-widest">
                            {emp.years} {emp.years === 1 ? 'Year' : 'Years'} Service
                          </p>
                        </div>
                        <div className="ml-auto text-stone-400 font-black italic text-[10px] md:text-xs">
                          {new Date(emp.hireDate!).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Quick Links */}
            <section className="bg-white rounded-3xl p-6 md:p-8 shadow-sm border border-gray-100">
               <h2 className="text-lg md:text-xl font-black text-stone-800 uppercase tracking-tight mb-5 md:mb-6 flex items-center gap-2 md:gap-3">
                  <div className="w-1.5 md:w-2 h-5 md:h-6 bg-red-900 rounded-full"></div>
                  Quick Access
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
                  {[
                    { label: 'Dashboard', href: '/dashboard', color: 'bg-stone-50 text-stone-700 hover:bg-stone-100' },
                    { label: 'WIP Report', href: '/wip', color: 'bg-red-50 text-red-900 hover:bg-red-100' },
                    { label: 'Project Gantt', href: '/project-schedule', color: 'bg-gray-50 text-gray-700 hover:bg-gray-100' },
                    { label: 'Equipment', href: '/equipment', color: 'bg-stone-800 text-white hover:bg-stone-900' },
                    { label: 'Field Log', href: '/field', color: 'bg-red-900 text-white hover:bg-red-950' },
                    { label: 'Employees', href: '/employees', color: 'bg-neutral-50 text-neutral-600 hover:bg-neutral-100' },
                  ].map(link => (
                    <Link 
                      key={link.label}
                      href={link.href}
                      className={`p-3 md:p-4 rounded-2xl font-black text-[10px] md:text-xs uppercase tracking-tight text-center transition-all hover:scale-105 active:scale-95 ${link.color}`}
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
            </section>
          </div>
        </div>

        {/* Weather / Site Status (Full Width at Bottom) */}
        <section className="mt-8 md:mt-10">
          <div className={`rounded-3xl p-6 md:p-8 shadow-lg transition-all ${weather?.condition.includes('Rain') || weather?.condition.includes('Storm') ? 'bg-blue-600' : 'bg-orange-600'} text-white`}>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-8 md:gap-12">
                <div className="flex items-center gap-4 md:gap-6">
                  <div className="text-6xl md:text-8xl drop-shadow-md">{weather?.icon || "☀"}</div>
                  <div>
                    <div className="flex items-center gap-3">
                      <p className="font-black text-4xl md:text-6xl tracking-tighter">{weather?.temp ?? "--"}°F</p>
                      <span className="text-[10px] md:text-xs bg-white/20 px-2 py-1 rounded font-black uppercase tracking-widest">{weather?.condition ?? "..."}</span>
                    </div>
                    <p className="text-white/70 text-[10px] md:text-xs font-bold uppercase tracking-widest leading-none mt-2">{weather?.location ?? "Local Site"}</p>
                  </div>
                </div>

                {/* Hourly Forecast (Expanded for better readability at bottom) */}
                <div className="flex-1 w-full overflow-hidden">
                  <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/50 mb-4 italic flex items-center gap-2">
                    <span className="w-4 h-px bg-white/20"></span>
                    Next 8 Hours
                  </p>
                  <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-none snap-x justify-between">
                    {weather?.hourly?.map((h, i) => (
                      <div key={i} className="flex flex-col items-center min-w-[60px] md:min-w-[80px] bg-white/10 rounded-2xl py-3 px-2 border border-white/5 snap-center transition-transform hover:scale-110">
                        <span className="text-[10px] font-black uppercase text-white/60 mb-1">{h.time}</span>
                        <span className="text-2xl mb-1">{h.icon}</span>
                        <span className="text-sm md:text-base font-black">{h.temp}°</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 7-Day Forecast (Side-by-side on desktop) */}
                <div className="w-full md:w-auto md:min-w-[280px] pt-6 md:pt-0 border-t md:border-t-0 md:border-l border-white/10 md:pl-8">
                  <p className="text-[10px] md:text-xs font-black uppercase tracking-widest text-white/50 mb-4 italic flex items-center gap-2">
                    <span className="w-4 h-px bg-white/20"></span>
                    7-Day Outlook
                  </p>
                  <div className="space-y-3">
                    {weather?.daily?.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="w-10 font-black uppercase text-white/60">{d.date}</span>
                        <span className="text-xl">{d.icon}</span>
                        <div className="flex gap-3 w-20 justify-end">
                          <span className="font-black text-white">{d.high}°</span>
                          <span className="font-bold text-white/40">{d.low}°</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-12 md:mt-16 pt-6 md:pt-8 border-t border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4 text-[9px] md:text-[10px] font-black uppercase tracking-widest text-gray-400 italic text-center">
          <div className="flex items-center gap-2">
             <span className="text-red-900">PARADISE MASONRY</span>
             <span className="w-1 h-1 rounded-full bg-gray-200"></span>
             <span>Innovation in Concrete</span>
          </div>
          <div className="flex gap-4 md:gap-6">
            <span className="hover:text-red-900 cursor-pointer">Safety Manual</span>
            <span className="hover:text-red-900 cursor-pointer">HR Portal</span>
          </div>
        </div>
      </div>
    </main>
  );
}
