'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';

export default function ProjectInputPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [rationale, setRationale] = useState('');
  const [status, setStatus] = useState<string>('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [researching, setResearching] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.titleIdea) {
          setTitle(data.titleIdea.original_title);
          setRationale(data.titleIdea.rationale);
        }
        if (data.project) {
          setStatus(data.project.status);
          setHasRun(!!data.project.current_research_run_id);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    setSaving(true);
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, rationale }),
    });
    setSaving(false);
  }

  async function handleResearch() {
    setResearching(true);
    // Save current values first
    await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, rationale }),
    });
    // Trigger research
    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, originalTitle: title, rationale }),
    });
    const data = await res.json();
    if (data.runId) {
      router.push(`/projects/${id}/research`);
    } else {
      setResearching(false);
    }
  }

  const titleValid = title.trim().length >= 10 && title.trim().length <= 100;
  const rationaleValid = rationale.trim().length >= 20 && rationale.trim().length <= 500;
  const canResearch = titleValid && rationaleValid && !researching;

  if (loading) return <LoadingSpinner message="Loading project..." />;

  return (
    <div>
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-gray-700">Dashboard</Link>
        <span className="mx-2">&gt;</span>
        <span className="text-gray-900">{title || 'New Project'}</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Step 1 of 3: Title Idea Input</h1>
        {status === 'title_selected' && (
          <div className="mt-3 rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            Title selected. <Link href={`/projects/${id}/select`} className="font-medium underline">View selection</Link>
          </div>
        )}
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-gray-700">
            Product Title Idea
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Notion Budget Tracker for Freelancers"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-base outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-sm text-gray-500">
            Describe the product concept — be specific enough for research. (10-100 chars)
          </p>
        </div>

        <div>
          <label htmlFor="rationale" className="block text-sm font-medium text-gray-700">
            Why This Niche?
          </label>
          <textarea
            id="rationale"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            rows={4}
            placeholder="e.g., Freelancers need expense tracking tailored to irregular income..."
            className="mt-1 block w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-base outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-sm text-gray-500">
            Explain the gap, audience, or trend this product addresses. (20-500 chars)
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>
          <button
            onClick={handleResearch}
            disabled={!canResearch}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {researching ? 'Starting Research...' : 'Research This Title →'}
          </button>
        </div>

        {hasRun && (
          <div className="mt-2">
            <Link
              href={`/projects/${id}/research`}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              View latest research results →
            </Link>
          </div>
        )}

        <div className="mt-4 border-t border-gray-200 pt-4">
          <Link href="/discover" className="text-sm text-gray-500 hover:text-gray-700">
            I don&apos;t have an idea yet — discover niches →
          </Link>
        </div>
      </div>
    </div>
  );
}
