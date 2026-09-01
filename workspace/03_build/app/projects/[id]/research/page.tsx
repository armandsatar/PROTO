'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { CandidateCard } from '@/components/CandidateCard';
import { ConfirmModal } from '@/components/ConfirmModal';

interface Candidate {
  id: string;
  candidate_text: string;
  is_original: boolean;
  generation_axis: 'original' | 'niche_down' | 'format_hint' | 'keyword_optimized';
  demand_score: number;
  demand_color: string;
  demand_signal_detail: Record<string, unknown>;
  competition_score: number;
  competition_color: string;
  competition_signal_detail: Record<string, unknown>;
  display_order: number;
}

export default function ResearchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [runNumber, setRunNumber] = useState<number | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<string>('draft');
  const [projectTitle, setProjectTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [pollingRunId, setPollingRunId] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json();
    if (data.project) {
      setProjectStatus(data.project.status);
    }
    if (data.titleIdea) {
      setProjectTitle(data.titleIdea.original_title);
    }
    if (data.latestRun) {
      setRunNumber(data.latestRun.run_number);
      setRunStatus(data.latestRun.status);
      if (data.latestRun.status === 'pending') {
        setPollingRunId(data.latestRun.id);
      }
    }
    if (data.candidates) {
      setCandidates(data.candidates);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

  // Poll for pending research
  useEffect(() => {
    if (!pollingRunId) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/research/${pollingRunId}/status`);
      const data = await res.json();
      if (data.status === 'completed') {
        setCandidates(data.candidates ?? []);
        setRunStatus('completed');
        setPollingRunId(null);
      } else if (data.status === 'failed') {
        setRunStatus('failed');
        setPollingRunId(null);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [pollingRunId]);

  async function handleRerun() {
    setShowRerunConfirm(false);
    setRerunning(true);
    setCandidates([]);
    setRunStatus('pending');

    const projRes = await fetch(`/api/projects/${id}`);
    const projData = await projRes.json();
    const title = projData.titleIdea?.original_title;
    const rationale = projData.titleIdea?.rationale;

    const res = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, originalTitle: title, rationale }),
    });
    const data = await res.json();
    if (data.runId) {
      setPollingRunId(data.runId);
      setRunNumber((prev) => (prev ?? 0) + 1);
    }
    setRerunning(false);
  }

  if (loading) return <LoadingSpinner message="Loading research results..." />;

  return (
    <div>
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-gray-700">Dashboard</Link>
        <span className="mx-2">&gt;</span>
        <Link href={`/projects/${id}`} className="hover:text-gray-700">{projectTitle}</Link>
        <span className="mx-2">&gt;</span>
        <span className="text-gray-900">Research</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Step 2 of 3: Research & Scoring</h1>
          {runNumber && (
            <span className="mt-1 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              Run #{runNumber}
            </span>
          )}
        </div>
      </div>

      {/* Pending state */}
      {(runStatus === 'pending' || rerunning) && (
        <LoadingSpinner message="Researching title variants... This may take 10-20 seconds." />
      )}

      {/* Failed state */}
      {runStatus === 'failed' && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Research failed. Try re-running.
        </div>
      )}

      {/* No research yet */}
      {!runStatus && !rerunning && (
        <div className="mt-6 text-center text-gray-500">
          <p>No research run yet.</p>
          <Link
            href={`/projects/${id}`}
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-800"
          >
            Go to Step 1 to start research →
          </Link>
        </div>
      )}

      {/* Results */}
      {runStatus === 'completed' && candidates.length > 0 && (
        <div className="mt-6 space-y-4">
          {candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c} />
          ))}

          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={() => {
                if (projectStatus === 'title_selected') {
                  setShowRerunConfirm(true);
                } else {
                  handleRerun();
                }
              }}
              disabled={rerunning}
              className="rounded-md bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-300 disabled:opacity-50"
            >
              Re-run Research
            </button>
            <Link
              href={`/projects/${id}/select`}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              I&apos;m Ready to Choose →
            </Link>
          </div>
        </div>
      )}

      {showRerunConfirm && (
        <ConfirmModal
          title="Re-run Research?"
          message="You already selected a title. Re-running will clear that selection and generate 4 new candidates."
          confirmLabel="Re-run"
          onConfirm={handleRerun}
          onCancel={() => setShowRerunConfirm(false)}
        />
      )}
    </div>
  );
}
