import React from "react";

interface SummaryCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  large?: boolean;
}

export function SummaryCard({
  label,
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  large = false,
}: SummaryCardProps) {
  return (
    <div style={{
      background: '#ffffff',
      borderRadius: 12,
      padding: large ? '24px 32px' : '16px 20px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      border: '1px solid #ddd',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{ color: '#666', fontSize: 13, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ 
        fontSize: large ? 28 : 20, 
        fontWeight: 800, 
        color: label.includes('Sales') ? '#10b981' : '#E06C00'
      }}>
        {prefix}{value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
      </div>
    </div>
  );
}
