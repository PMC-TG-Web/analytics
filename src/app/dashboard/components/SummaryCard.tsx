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
    <div className="bg-white rounded-3xl p-6 shadow-md border border-gray-100 flex flex-col items-center justify-center hover:shadow-xl transition-all duration-300 hover:-translate-y-1 w-full">
      <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 text-center">{label}</div>
      <div className="text-2xl md:text-3xl font-black text-teal-800 tracking-tight text-center">
        {prefix}{value?.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
      </div>
    </div>
  );
}
