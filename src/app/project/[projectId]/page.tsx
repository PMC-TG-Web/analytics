'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Line, Bar, Pie } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, ArcElement);

interface ProjectOverview {
  projectId: string;
  project: {
    id: string;
    name: string;
    number: string;
    status: string;
    customer: string;
    estimator: string;
    projectManager: string;
  };
  metrics: {
    totalHours: number;
    uniqueEmployees: number;
    workingDays: number;
    avgHoursPerDay: number;
    totalBudget: number;
    totalSpent: number;
    budgetRemaining: number;
    budgetUtilization: number;
  };
  team: {
    total: number;
    members: Array<{ id: string; name: string; login: string; role: string }>;
  };
  laborAnalytics: {
    employeeBreakdown: Array<{
      name: string;
      hours: number;
      days: number;
      roles: string[];
      avgHoursPerDay: number;
    }>;
    dailyTrends: Array<{ date: string; hours: number; employeesWorked: number }>;
  };
  costAnalysis: {
    lineItems: Array<{
      id: string;
      name: string;
      code: string;
      budgeted: number;
      actual: number;
      variance: number;
    }>;
  };
}

export default function ProjectDashboard({ params }: { params: Promise<{ projectId: string }> }) {
  const resolvedParams = use(params);
  const projectId = resolvedParams.projectId;

  const { user, loading: authLoading, checkAccess } = useAuth();
  const [data, setData] = useState<ProjectOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSection, setExpandedSection] = useState<string>('overview');
  const router = useRouter();

  useEffect(() => {
    if (authLoading) return;
    
    if (!user || !checkAccess('project')) {
      setError('Access denied');
      setTimeout(() => router.push('/'), 2000);
      return;
    }
  }, [authLoading, user, checkAccess, router]);

  useEffect(() => {
    if (authLoading || !user) return;

    const fetchData = async () => {
      try {
        const response = await fetch(`/api/project/${projectId}`);
        if (!response.ok) throw new Error('Failed to fetch project data');
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error loading project data');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [projectId, authLoading, user]);

  if (authLoading) return <div className="p-8 text-center">Loading...</div>;
  if (error === 'Access denied') return <div className="p-8 text-center text-red-500">Access denied. Redirecting...</div>;
  if (loading) return <div className="p-8 text-center">Loading project dashboard...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;
  if (!data) return <div className="p-8 text-center">No data available</div>;

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2">{data.project.name}</h1>
              <p className="text-gray-400">Project #{data.project.number}</p>
            </div>
            <div className="text-right">
              <span className={`inline-block px-4 py-2 rounded-lg font-semibold ${
                data.project.status === 'Active' ? 'bg-green-500/20 text-green-200' : 'bg-blue-500/20 text-blue-200'
              }`}>
                {data.project.status}
              </span>
            </div>
          </div>

          {/* Project Info Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <p className="text-gray-400 text-sm mb-1">Customer</p>
              <p className="text-white font-semibold">{data.project.customer}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <p className="text-gray-400 text-sm mb-1">Estimator</p>
              <p className="text-white font-semibold">{data.project.estimator}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <p className="text-gray-400 text-sm mb-1">Project Manager</p>
              <p className="text-white font-semibold">{data.project.projectManager}</p>
            </div>
            <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
              <p className="text-gray-400 text-sm mb-1">Team Size</p>
              <p className="text-white font-semibold">{data.team.total} members</p>
            </div>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard title="Total Hours" value={data.metrics.totalHours.toLocaleString()} subtext={`${data.metrics.uniqueEmployees} employees`} color="blue" />
          <MetricCard title="Working Days" value={data.metrics.workingDays} subtext={`${data.metrics.avgHoursPerDay.toFixed(1)} hrs/day avg`} color="green" />
          <MetricCard title="Budget Spent" value={`$${data.metrics.totalSpent.toLocaleString()}`} subtext={`${data.metrics.budgetUtilization.toFixed(1)}% of budget`} color="amber" />
          <MetricCard title="Budget Status" value={`$${data.metrics.budgetRemaining.toLocaleString()}`} subtext={data.metrics.budgetRemaining > 0 ? 'Remaining' : 'Over budget'} color={data.metrics.budgetRemaining > 0 ? 'green' : 'red'} />
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Daily Trends */}
          <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600">
            <h2 className="text-xl font-bold text-white mb-4">Labor Hours Trend (Last 30 Days)</h2>
            <div style={{ position: 'relative', height: '300px' }}>
              <Line
                data={{
                  labels: data.laborAnalytics.dailyTrends.map(d => d.date),
                  datasets: [{
                    label: 'Hours',
                    data: data.laborAnalytics.dailyTrends.map(d => d.hours),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    tension: 0.4,
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: '#9ca3af' } } },
                  scales: {
                    y: { ticks: { color: '#9ca3af' }, grid: { color: '#475569' } },
                    x: { ticks: { color: '#9ca3af' }, grid: { color: '#475569' } },
                  },
                }}
              />
            </div>
          </div>

          {/* Top Employees */}
          <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600">
            <h2 className="text-xl font-bold text-white mb-4">Top 8 Employees by Hours</h2>
            <div style={{ position: 'relative', height: '300px' }}>
              <Bar
                data={{
                  labels: data.laborAnalytics.employeeBreakdown.slice(0, 8).map(e => e.name),
                  datasets: [{
                    label: 'Hours',
                    data: data.laborAnalytics.employeeBreakdown.slice(0, 8).map(e => e.hours),
                    backgroundColor: '#3b82f6',
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  indexAxis: 'y' as const,
                  plugins: { legend: { labels: { color: '#9ca3af' } } },
                  scales: {
                    x: { ticks: { color: '#9ca3af' }, grid: { color: '#475569' } },
                    y: { ticks: { color: '#9ca3af' }, grid: { color: '#475569' } },
                  },
                }}
              />
            </div>
          </div>

          {/* Budget Distribution */}
          <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600">
            <h2 className="text-xl font-bold text-white mb-4">Budget Distribution</h2>
            <div style={{ position: 'relative', height: '300px' }}>
              <Pie
                data={{
                  labels: ['Spent', 'Remaining'],
                  datasets: [{
                    data: [data.metrics.totalSpent, Math.max(0, data.metrics.budgetRemaining)],
                    backgroundColor: ['#ef4444', '#10b981'],
                  }],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { labels: { color: '#9ca3af' } } },
                }}
              />
            </div>
          </div>

          {/* Working Days Distribution */}
          <div className="bg-slate-700/50 rounded-lg p-6 border border-slate-600">
            <h2 className="text-xl font-bold text-white mb-4">Employees by Days Worked</h2>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {data.laborAnalytics.employeeBreakdown.sort((a, b) => b.days - a.days).slice(0, 10).map((emp, idx) => (
                <div key={idx} className="flex justify-between items-center p-3 bg-slate-600/30 rounded">
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">{emp.name}</p>
                    <p className="text-gray-400 text-xs">{emp.roles.join(', ')}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-blue-400 font-semibold">{emp.days} days</p>
                    <p className="text-gray-400 text-xs">{emp.avgHoursPerDay.toFixed(1)} hrs/day</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detailed Sections */}
        <div className="space-y-4">
          {/* All Employees Detail */}
          <ExpandableSection
            title={`All Employees (${data.laborAnalytics.employeeBreakdown.length})`}
            isExpanded={expandedSection === 'employees'}
            onToggle={() => setExpandedSection(expandedSection === 'employees' ? '' : 'employees')}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600">
                    <th className="text-left py-3 px-4 text-gray-400">Employee</th>
                    <th className="text-right py-3 px-4 text-gray-400">Hours</th>
                    <th className="text-right py-3 px-4 text-gray-400">Days</th>
                    <th className="text-right py-3 px-4 text-gray-400">Avg/Day</th>
                    <th className="text-left py-3 px-4 text-gray-400">Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {data.laborAnalytics.employeeBreakdown.map((emp, idx) => (
                    <tr key={idx} className="border-b border-slate-700 hover:bg-slate-700/30">
                      <td className="py-3 px-4 text-white">{emp.name}</td>
                      <td className="py-3 px-4 text-right text-blue-400 font-semibold">{emp.hours}</td>
                      <td className="py-3 px-4 text-right text-green-400">{emp.days}</td>
                      <td className="py-3 px-4 text-right text-gray-300">{emp.avgHoursPerDay.toFixed(1)}</td>
                      <td className="py-3 px-4 text-gray-400 text-xs">{emp.roles.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ExpandableSection>

          {/* Cost Analysis */}
          <ExpandableSection
            title={`Line Items / Cost Codes (${data.costAnalysis.lineItems.length})`}
            isExpanded={expandedSection === 'costs'}
            onToggle={() => setExpandedSection(expandedSection === 'costs' ? '' : 'costs')}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-600">
                    <th className="text-left py-3 px-4 text-gray-400">Code</th>
                    <th className="text-left py-3 px-4 text-gray-400">Description</th>
                    <th className="text-right py-3 px-4 text-gray-400">Budgeted</th>
                    <th className="text-right py-3 px-4 text-gray-400">Actual</th>
                    <th className="text-right py-3 px-4 text-gray-400">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.costAnalysis.lineItems.map((item, idx) => (
                    <tr key={idx} className="border-b border-slate-700 hover:bg-slate-700/30">
                      <td className="py-3 px-4 text-white font-mono text-xs">{item.code}</td>
                      <td className="py-3 px-4 text-gray-300">{item.name}</td>
                      <td className="py-3 px-4 text-right text-gray-300">${item.budgeted.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right text-yellow-400">${item.actual.toLocaleString()}</td>
                      <td className={`py-3 px-4 text-right font-semibold ${item.variance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${item.variance.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ExpandableSection>

          {/* Team Members */}
          <ExpandableSection
            title={`Team Members (${data.team.members.length})`}
            isExpanded={expandedSection === 'team'}
            onToggle={() => setExpandedSection(expandedSection === 'team' ? '' : 'team')}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.team.members.map((member) => (
                <div key={member.id} className="bg-slate-600/30 rounded-lg p-4 border border-slate-600">
                  <p className="text-white font-semibold">{member.name}</p>
                  <p className="text-gray-400 text-sm">{member.login}</p>
                  <p className="text-blue-400 text-xs mt-2">{member.role}</p>
                </div>
              ))}
            </div>
          </ExpandableSection>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtext, color }: { title: string; value: string | number; subtext: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-200',
    green: 'bg-green-500/10 border-green-500/30 text-green-200',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-200',
    red: 'bg-red-500/10 border-red-500/30 text-red-200',
  };

  return (
    <div className={`rounded-lg p-6 border ${colors[color]}`}>
      <p className="text-gray-300 text-sm mb-2">{title}</p>
      <p className="text-3xl font-bold mb-1">{value}</p>
      <p className="text-xs text-gray-400">{subtext}</p>
    </div>
  );
}

function ExpandableSection({ title, isExpanded, onToggle, children }: { title: string; isExpanded: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-slate-700/50 rounded-lg border border-slate-600 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex justify-between items-center hover:bg-slate-600/30 transition-colors"
      >
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <span className={`text-xl transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {isExpanded && <div className="px-6 py-4 border-t border-slate-600">{children}</div>}
    </div>
  );
}
