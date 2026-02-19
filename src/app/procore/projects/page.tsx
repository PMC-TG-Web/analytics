'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

interface ProcoreProject {
  id: string;
  name: string;
  project_number: string;
  project_status: string;
  company_name: string;
  estimator?: { name: string };
  project_manager?: { name: string };
}

export default function ProcoreProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<ProcoreProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setError('Not authenticated');
      setTimeout(() => router.push('/login'), 2000);
      return;
    }

    fetchProjects();
  }, [authLoading, user, router]);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      setError(null);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);

      // Fetch projects from the API (which handles token refresh server-side)
      const response = await fetch('/api/procore/projects?includeBidBoard=0', {
        credentials: 'include',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch projects');
      }

      const data = await response.json();
      setProjects(data.projects || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error loading projects';
      const finalMessage = message.includes('aborted') ? 'Request timed out. Please try again.' : message;
      console.error('Error fetching projects:', message);
      setError(finalMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (type: 'projects' | 'bid-board', format: 'csv' | 'json') => {
    try {
      const endpoint = `/api/procore/export/${type}?format=${format}`;
      const response = await fetch(endpoint, { credentials: 'include' });

      if (!response.ok) {
        throw new Error('Download failed');
      }

      const blob = await response.blob();
      const filename = response.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] 
        || `export-${type}-${new Date().toISOString().slice(0, 10)}.${format}`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert(`Failed to download ${type}`);
      console.error('Download error:', err);
    }
  };

  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.project_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.company_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (authLoading) return <div className="p-8 text-center">Loading...</div>;
  
  if (error && !projects.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
        <div className="max-w-4xl mx-auto">
          <Link href="/" className="text-blue-400 hover:text-blue-300 mb-6 inline-block">
            ← Back to Dashboard
          </Link>
          <div className="bg-slate-700/50 rounded-lg p-8 border border-red-500/30 text-center">
            <h2 className="text-2xl font-bold text-red-400 mb-2">🔓 Re-Authentication Required</h2>
            <p className="text-gray-400 text-sm mb-6">Your Procore credentials have expired.</p>
            <p className="text-gray-300 mb-8">{error}</p>
            <div className="flex gap-4 justify-center flex-wrap">
              <a
                href="/api/auth/procore/login?returnTo=/procore/projects"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors text-lg"
              >
                Sign in with Procore
              </a>
              <button
                onClick={fetchProjects}
                className="bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Try Again
              </button>
            </div>
            <p className="text-gray-500 text-xs mt-8">You'll be redirected to Procore to sign in securely.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/" className="text-blue-400 hover:text-blue-300 mb-4 inline-block">
            ← Back to Dashboard
          </Link>
          <h1 className="text-4xl font-bold text-white mb-2">Procore Projects</h1>
          <p className="text-gray-400 mb-6">Select a project to view labor analytics and financial metrics</p>
          
          {/* Export Buttons */}
          <div className="flex flex-wrap gap-3">
            <div className="flex gap-2">
              <span className="text-sm text-gray-400 self-center">Export Projects:</span>
              <button
                onClick={() => handleDownload('projects', 'csv')}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
              >
                CSV
              </button>
              <button
                onClick={() => handleDownload('projects', 'json')}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium transition-colors"
              >
                JSON
              </button>
            </div>
            <div className="flex gap-2">
              <span className="text-sm text-gray-400 self-center">Bid Board:</span>
              <button
                onClick={() => handleDownload('bid-board', 'csv')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition-colors"
              >
                CSV
              </button>
              <button
                onClick={() => handleDownload('bid-board', 'json')}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium transition-colors"
              >
                JSON
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search by project name, number, or customer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Projects Grid */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading projects...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            {projects.length === 0 ? 'No projects found' : 'No projects match your search'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProjects.map((project) => (
              <Link
                key={project.id}
                href={`/project/${project.id}`}
                className="group"
              >
                <div className="bg-slate-700/50 border border-slate-600 rounded-lg p-6 hover:border-blue-500 hover:bg-slate-700/80 transition-all cursor-pointer h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors mb-1">
                        {project.name}
                      </h3>
                      <p className="text-gray-400 text-sm">#{project.project_number}</p>
                    </div>
                    <span
                      className={`px-3 py-1 rounded text-sm font-semibold whitespace-nowrap ml-2 ${
                        project.project_status === 'Active'
                          ? 'bg-green-500/20 text-green-200'
                          : 'bg-blue-500/20 text-blue-200'
                      }`}
                    >
                      {project.project_status}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Customer:</span>
                      <span className="text-white">{project.company_name}</span>
                    </div>
                    {project.project_manager && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">PM:</span>
                        <span className="text-white">{project.project_manager.name}</span>
                      </div>
                    )}
                    {project.estimator && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Estimator:</span>
                        <span className="text-white">{project.estimator.name}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-slate-600">
                    <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-3 rounded transition-colors">
                      View Dashboard →
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Project Count */}
        <div className="mt-8 text-center text-gray-400 text-sm">
          Showing {filteredProjects.length} of {projects.length} projects
        </div>
      </div>
    </div>
  );
}
