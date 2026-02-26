"use client";

import { useState, useEffect } from "react";
import { isUsingMockData, getMockDataReason } from "@/lib/firebaseAdapter";

export default function MockDataBanner() {
  const [showBanner, setShowBanner] = useState(false);
  const [dataSource, setDataSource] = useState("sample");

  useEffect(() => {
    // Check if using mock data
    if (isUsingMockData()) {
      setShowBanner(true);
      // Check if we have real CSV data loaded
      const hasRealData = localStorage.getItem('hasRealProjectData') === 'true';
      setDataSource(hasRealData ? 'csv' : 'sample');
    }
  }, []);

  if (!showBanner) return null;

  const message = dataSource === 'csv' 
    ? "Displaying your real project data from CSV (Firebase temporarily unavailable)"
    : "Displaying demo sample projects (Firebase temporarily unavailable)";
  
  const bgColor = dataSource === 'csv' ? 'bg-blue-100 border-blue-600' : 'bg-yellow-100 border-yellow-600';
  const textColor = dataSource === 'csv' ? 'text-blue-900' : 'text-yellow-900';

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 ${bgColor} border-b-2 px-4 py-3 shadow-lg`}>
      <div className="max-w-7xl mx-auto flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="text-2xl">{dataSource === 'csv' ? '📊' : '⚠️'}</div>
          <div className="flex-1">
            <h3 className={`font-bold ${textColor}`}>
              {dataSource === 'csv' ? 'Real Data Mode' : 'Demo Mode Active'}
            </h3>
            <p className={`text-sm ${textColor} mt-1`}>
              {message}
            </p>
            <p className={`text-xs ${textColor} mt-1 font-mono opacity-75`}>
              {getMockDataReason()}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowBanner(false)}
          className={`${textColor} hover:opacity-75 text-xl font-bold flex-shrink-0`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
