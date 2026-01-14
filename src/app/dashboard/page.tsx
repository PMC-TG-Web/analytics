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
      <main className="p-8">
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

  return (
    <main className="p-8" style={{ fontFamily: 'sans-serif' }}>
      <h1>Dashboard</h1>
      <div style={{ display: 'flex', gap: 36, marginBottom: 48 }}>
        <SummaryCard label="Sales" value={totalSales} prefix="$" large />
        <SummaryCard label="Cost" value={totalCost} prefix="$" large />
        <SummaryCard label="Hours" value={totalHours} large />
        <SummaryCard label="RPH" value={rph} prefix="$" decimals={2} large />
        <SummaryCard label="Markup %" value={markup} suffix="%" decimals={1} large />
      </div>
      <h2>Status Breakdown</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 36, marginBottom: 48 }}>
        {Object.entries(statusGroups).map(([status, group]) => {
          const sales = group.reduce((sum, p) => sum + (p.sales ?? 0), 0);
          const cost = group.reduce((sum, p) => sum + (p.cost ?? 0), 0);
          const hours = group.reduce((sum, p) => sum + (p.hours ?? 0), 0);
          const rph = hours ? sales / hours : 0;
          const markup = cost ? ((sales - cost) / cost) * 100 : 0;
          return (
            <div key={status} style={{
              background: '#f5f5f5',
              borderRadius: 18,
              padding: '30px 48px',
              minWidth: 330,
              boxShadow: '0 3px 12px #0001',
              marginBottom: 12,
            }}>
              <div style={{ fontWeight: 700, fontSize: 27, marginBottom: 18 }}>{status}</div>
              <dl style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>Sales</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 20 }}>{`$${sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>Cost</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 20 }}>{`$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>Hours</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 20 }}>{hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <dt>RPH</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 20 }}>{`$${rph.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <dt>Markup %</dt>
                  <dd style={{ marginLeft: 12, fontWeight: 700, fontSize: 20 }}>{`${markup.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}</dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
      {/* Unique project count by customer+projectName */}
      <div>
        Project count: {
          Array.from(
            new Set(
              projects.map(p => `${p.customer ?? ''}|${p.projectName ?? ''}`)
            )
          ).length
        }
      </div>

      {/* Time Series Line Chart by Month/Year for Hours by Status */}
      <div style={{ marginTop: 64, background: '#fff', borderRadius: 18, boxShadow: '0 2px 8px #0001', padding: 32 }}>
        <h2 style={{ marginBottom: 24 }}>Hours by Month/Year (Submitted, In Progress, Accepted)</h2>
        <TimeSeriesChart projects={projects} />
      </div>
    </main>
  );
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
      background: '#f5f5f5',
      borderRadius: large ? 18 : 12,
      padding: large ? '30px 48px' : '20px 32px',
      minWidth: large ? 180 : 120,
      boxShadow: large ? '0 3px 12px #0001' : '0 2px 8px #0001',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: large ? 24 : 16, color: '#666', marginBottom: 12 }}>{label}</div>
      <div style={{ fontSize: large ? 42 : 28, fontWeight: 700 }}>
        {prefix}{value?.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}
      </div>
    </div>
  );
}