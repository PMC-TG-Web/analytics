"use client";
import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
// Dynamically import Chart.js to avoid SSR issues
const Line = dynamic(() => import('react-chartjs-2').then(mod => mod.Line), { ssr: false });
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";

type Project = {
  id: string;
  [key: string]: any;
};

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const querySnapshot = await getDocs(collection(db, "projects"));
      const data = querySnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setProjects(data);
      setLoading(false);
    }
    fetchData();
  }, []);


  if (loading) {
    return (
      <main className="p-8" style={{ background: '#1a1d23', minHeight: '100vh', color: '#e5e7eb' }}>
        <div>Loading...</div>
      </main>
    );
  }

  // Calculate summary metrics
  const totalSales = projects.reduce((sum, p) => sum + (p.sales ?? 0), 0);
  const totalCost = projects.reduce((sum, p) => sum + (p.cost ?? 0), 0);
  const totalHours = projects.reduce((sum, p) => sum + (p.hours ?? 0), 0);
  const rph = totalHours ? totalSales / totalHours : 0;
  const markup = totalCost ? ((totalSales - totalCost) / totalCost) * 100 : 0;

  // Group by status
  const statusGroups: Record<string, typeof projects> = {};
  projects.forEach((p) => {
    const status = p.status || 'Unknown';
    if (!statusGroups[status]) statusGroups[status] = [];
    statusGroups[status].push(p);
  });

  // Calculate win rate: (Complete + In Progress + Accepted) / (Bid Submitted + Lost)
  const getUniqueProjectCount = (statusKey: string) => {
    const group = statusGroups[statusKey] || [];
    return new Set(group.map(p => `${p.customer ?? ''}|${p.projectNumber ?? ''}`)).size;
  };
  
  const wonProjects = getUniqueProjectCount('Complete') + getUniqueProjectCount('In Progress') + getUniqueProjectCount('Accepted');
  const totalBids = getUniqueProjectCount('Bid Submitted') + getUniqueProjectCount('Lost');
  const winRate = totalBids > 0 ? (wonProjects / totalBids) * 100 : 0;

  return (
    <main className="p-8" style={{ fontFamily: 'sans-serif', background: '#1a1d23', minHeight: '100vh', color: '#e5e7eb' }}>
      <h1 style={{ color: '#fff', marginBottom: 32, fontSize: 32 }}>Paradise Masonry Estimating Dashboard</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 20, marginBottom: 48 }}>
        <SummaryCard label="Sales" value={totalSales} prefix="$" large />
        <SummaryCard label="Cost" value={totalCost} prefix="$" large />
        <SummaryCard label="Hours" value={totalHours} large />
        <SummaryCard label="RPH" value={rph} prefix="$" decimals={2} large />
        <SummaryCard label="Markup %" value={markup} suffix="%" decimals={1} large />
        <SummaryCard label="Win Rate" value={winRate} suffix="%" decimals={1} large />
      </div>
      <h2 style={{ color: '#fff', marginBottom: 24, fontSize: 24 }}>Sales Funnel</h2>
      <FunnelChart statusGroups={statusGroups} />
      
      <h2 style={{ color: '#fff', marginBottom: 24, marginTop: 64, fontSize: 24 }}>Status Breakdown</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 48 }}>
        {Object.entries(statusGroups).map(([status, group]) => {
          const sales = group.reduce((sum, p) => sum + (p.sales ?? 0), 0);
          const cost = group.reduce((sum, p) => sum + (p.cost ?? 0), 0);
          const hours = group.reduce((sum, p) => sum + (p.hours ?? 0), 0);
          const rph = hours ? sales / hours : 0;
          const markup = cost ? ((sales - cost) / cost) * 100 : 0;
          return (
            <div key={status} style={{
              background: '#2b2d31',
              borderRadius: 12,
              padding: '24px 32px',
              minWidth: 330,
              boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
              border: '1px solid #3a3d42',
              marginBottom: 12,
            }}>
              <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 18, color: '#fff' }}>{status}</div>
              <dl style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>Sales</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#22c55e' }}>{`$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>Cost</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{`$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>Hours</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt style={{ color: '#9ca3af' }}>RPH</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{`$${rph.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <dt style={{ color: '#9ca3af' }}>Markup %</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 18, color: '#e5e7eb' }}>{`${markup.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      {/* Unique project count by customer+projectName */}
      <div style={{ color: '#9ca3af', marginBottom: 24 }}>
        Project count: {
          Array.from(
            new Set(
              projects.map(p => `${p.customer ?? ''}|${p.projectName ?? ''}`)
            )
          ).length
        }
      </div>

      {/* Time Series Line Chart by Month/Year for Hours by Status */}
      <div style={{ marginTop: 64, background: '#2b2d31', borderRadius: 12, boxShadow: '0 4px 6px rgba(0,0,0,0.3)', border: '1px solid #3a3d42', padding: 32 }}>
        <h2 style={{ marginBottom: 24, color: '#fff', fontSize: 20 }}>Hours by Month/Year (Submitted, In Progress, Accepted)</h2>
        <TimeSeriesChart projects={projects} />
      </div>
    </main>
  );
}

// Funnel Chart Component
function FunnelChart({ statusGroups }: { statusGroups: Record<string, any[]> }) {
  // Define funnel stages in order
  const funnelStages = [
    { key: 'Estimating', label: 'Estimating', color: '#3b82f6' },
    { key: 'Bid Submitted', label: 'Bid Submitted', color: '#8b5cf6' },
    { key: 'Accepted', label: 'Accepted', color: '#22c55e' },
    { key: 'In Progress', label: 'In Progress', color: '#f59e0b' },
    { key: 'Complete', label: 'Complete', color: '#10b981' },
  ];

  const getFunnelData = (stageKey: string) => {
    const group = statusGroups[stageKey] || [];
    const sales = group.reduce((sum, p) => sum + (p.sales ?? 0), 0);
    // Count distinct customer+projectNumber combinations
    const uniqueProjects = new Set(
      group.map(p => `${p.customer ?? ''}|${p.projectNumber ?? ''}`)
    );
    const count = uniqueProjects.size;
    return { sales, count };
  };

  // Calculate total unique projects across all funnel stages
  const totalProjects = funnelStages.reduce((sum, stage) => {
    return sum + getFunnelData(stage.key).count;
  }, 0);

  return (
    <div style={{ marginBottom: 48, background: '#2b2d31', borderRadius: 12, padding: 32, border: '1px solid #3a3d42' }}>
      {/* Metrics Row */}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 24 }}>
        {funnelStages.map((stage) => {
          const { sales, count } = getFunnelData(stage.key);
          const percentage = totalProjects > 0 ? ((count / totalProjects) * 100).toFixed(1) : '0.0';
          return (
            <div key={stage.key} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, color: '#9ca3af', marginBottom: 4 }}>{stage.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
                {count}
              </div>
              <div style={{ fontSize: 12, color: stage.color }}>
                {percentage}%
              </div>
            </div>
          );
        })}
      </div>

      {/* Horizontal Funnel Bar */}
      <div style={{ display: 'flex', height: 120, gap: 2, marginBottom: 16 }}>
        {funnelStages.map((stage, index) => {
          const { count } = getFunnelData(stage.key);
          const percentage = totalProjects > 0 ? (count / totalProjects) * 100 : 0;
          const minWidth = 10; // Minimum width percentage
          const width = Math.max(percentage, minWidth);

          return (
            <div
              key={stage.key}
              style={{
                flex: width,
                background: stage.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
                transition: 'all 0.3s ease',
              }}
            >
              <div style={{ 
                position: 'absolute', 
                bottom: -24, 
                fontSize: 12, 
                color: '#9ca3af',
                whiteSpace: 'nowrap'
              }}>
                Step {index + 1}
              </div>
            </div>
          );
        })}
      </div>

      {/* Stage Labels */}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 32 }}>
        {funnelStages.map((stage, index) => (
          <div key={stage.key} style={{ textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
            Step {index + 1}<br />{stage.label}
          </div>
        ))}
      </div>

      {/* Lost Section */}
      {statusGroups['Lost'] && statusGroups['Lost'].length > 0 && (
        <div style={{ marginTop: 32, padding: 20, background: '#1a1d23', borderRadius: 8, border: '1px solid #ef4444' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, color: '#9ca3af' }}>Lost Opportunities</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#ef4444', marginTop: 4 }}>
                {new Set(statusGroups['Lost'].map(p => `${p.customer ?? ''}|${p.projectNumber ?? ''}`)).size} projects
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#ef4444' }}>
                ${(statusGroups['Lost'].reduce((sum, p) => sum + (p.sales ?? 0), 0) / 1000000).toFixed(1)}M
              </div>
              <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                {((new Set(statusGroups['Lost'].map(p => `${p.customer ?? ''}|${p.projectNumber ?? ''}`)).size / totalProjects) * 100).toFixed(1)}% dropoff
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Time series chart component
function TimeSeriesChart({ projects }: { projects: any[] }) {
  // Helper to get YYYY-MM from a date string
  function getMonthYear(dateStr: string) {
    if (!dateStr) return 'Unknown';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Unknown';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  // Aggregate hours by month/year and status
  const statusKeys = [
    { key: 'In Progress', color: 'rgba(255, 206, 86, 1)' },
    { key: 'Accepted', color: 'rgba(75, 192, 192, 1)' },
    { key: 'Bid Submitted', color: 'rgba(153, 102, 255, 1)' },
  ];
  const dataByStatus: Record<string, Record<string, number>> = {};
  statusKeys.forEach(({ key }) => (dataByStatus[key] = {}));

  projects.forEach((p) => {
    const status = p.status;
    const date = p.dateCreated || p.dateUpdated;
    const monthYear = getMonthYear(date);
    const hours = Number(p.hours ?? 0);
    statusKeys.forEach(({ key }) => {
      if (status === key) {
        dataByStatus[key][monthYear] = (dataByStatus[key][monthYear] || 0) + hours;
      }
    });
  });

  // Get all unique month/year labels, sorted
  const allMonths = Array.from(
    new Set(
      statusKeys.flatMap(({ key }) => Object.keys(dataByStatus[key]))
    )
  ).filter(m => m !== 'Unknown').sort();

  const chartData = {
    labels: allMonths,
    datasets: statusKeys.map(({ key, color }) => ({
      label: key,
      data: allMonths.map(month => dataByStatus[key][month] || 0),
      borderColor: color,
      backgroundColor: color.replace('1)', '0.2)'),
      tension: 0.3,
      fill: false,
      yAxisID: key === 'Bid Submitted' ? 'y1' : 'y',
    })),
  };

  const options = {
        responsive: true,
        plugins: {
          legend: { position: 'top' as const },
          title: { display: false },
        },
        scales: {
          y: {
            type: 'linear' as const,
            beginAtZero: true,
            title: { display: true, text: 'Hours (Submitted, In Progress, Accepted)' },
            position: 'left' as const,
          },
          y1: {
            type: 'linear' as const,
            beginAtZero: true,
            title: { display: true, text: 'Hours (Bid Submitted)' },
            position: 'right' as const,
            grid: { drawOnChartArea: false },
          },
          x: { title: { display: true, text: 'Month/Year' } },
        },
  };

  return (
    <div style={{ width: '100%', minHeight: 400 }}>
      <Line data={chartData} options={options} />
    </div>
  );
}

type SummaryCardProps = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  large?: boolean;
};

function SummaryCard({ label, value, prefix = '', suffix = '', decimals = 0, large = false }: SummaryCardProps) {
  return (
    <div style={{
      background: '#2b2d31',
      borderRadius: 12,
      padding: large ? '24px 20px' : '20px 32px',
      minWidth: large ? 180 : 120,
      boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
      border: '1px solid #3a3d42',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: large ? 14 : 16, color: '#9ca3af', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: large ? 36 : 28, fontWeight: 700, color: '#22c55e' }}>
        {prefix}{value?.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
      </div>
    </div>
  );
}