import React from "react";
import Navigation from "@/components/Navigation";

interface DashboardToolbarProps {
  startDate: string;
  setStartDate: (value: string) => void;
  endDate: string;
  setEndDate: (value: string) => void;
}

export function DashboardToolbar({
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}: DashboardToolbarProps) {
  return (
    <div style={{ 
      background: '#ffffff', 
      borderRadius: 12, 
      padding: '16px 24px', 
      marginBottom: 32,
      border: '1px solid #ddd',
      display: 'flex',
      alignItems: 'center',
      gap: 20
    }}>
      <div style={{ color: '#666', fontWeight: 600 }}>Date Range:</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#666', fontSize: 14 }}>From:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#222',
              fontSize: 14
            }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: '#666', fontSize: 14 }}>To:</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{
              background: '#fff',
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#222',
              fontSize: 14
            }}
          />
        </label>
        {(startDate || endDate) && (
          <button
            onClick={() => {
              setStartDate("");
              setEndDate("");
            }}
            style={{
              background: '#E06C00',
              border: 'none',
              borderRadius: 6,
              padding: '6px 12px',
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
              fontWeight: 600
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
