'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';

interface Project {
  id: string;
  status: 'draft' | 'researching' | 'title_selected';
  title: string;
  rationale: string;
  createdAt: string;
  updatedAt: string;
}

const statusBadge: Record<string, { label: string; classes: string }> = {
  draft: { label: 'Draft', classes: 'bg-gray-100 text-gray-700' },
  researching: { label: 'Researching', classes: 'bg-blue-100 text-blue-700' },
  title_selected: { label: 'Title Selected', classes: 'bg-green-100 text-green-700' },
};

export default function Dashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => setProjects(data.projects ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function handleNewProject() {
    setCreating(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled Project', rationale: 'Describe your idea here.' }),
    });
    const data = await res.json();
    if (data.projectId) {
      router.push(`/projects/${data.projectId}`);
    }
    setCreating(false);
  }

  if (loading) return <LoadingSpinner message="Loading projects..." />;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-3">
          <Link
            href="/discover"
            className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300"
          >
            Discover Niches
          </Link>
          <button
            onClick={handleNewProject}
            disabled={creating}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'New Project'}
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-gray-500">No projects yet.</p>
          <p className="mt-1 text-sm text-gray-400">
            Create a new project or discover niches to get started.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {projects.map((project) => {
            const badge = statusBadge[project.status] ?? statusBadge.draft;
            return (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">{project.title}</h2>
                    <p className="mt-1 text-sm text-gray-600 line-clamp-1">{project.rationale}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.classes}`}
                  >
                    {badge.label}
                  </span>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {new Date(project.updatedAt).toLocaleDateString()}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
