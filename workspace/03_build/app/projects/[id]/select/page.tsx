'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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

export default function SelectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [projectTitle, setProjectTitle] = useState('');
  const [projectStatus, setProjectStatus] = useState<string>('draft');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedCandidateText, setSelectedCandidateText] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingText, setConfirmingText] = useState('');
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.titleIdea) {
          setProjectTitle(data.titleIdea.original_title);
        }
        if (data.project) {
          setProjectStatus(data.project.status);
          setSelectedCandidateId(data.project.selected_candidate_id);
        }
        if (data.candidates) {
          setCandidates(data.candidates);
          if (data.project?.selected_candidate_id) {
            const selected = data.candidates.find(
              (c: Candidate) => c.id === data.project.selected_candidate_id,
            );
            if (selected) setSelectedCandidateText(selected.candidate_text);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSelect() {
    if (!confirmingId) return;
    setSubmitting(true);

    const res = await fetch(`/api/projects/${id}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: confirmingId }),
    });
    const data = await res.json();
    if (data.ok) {
      router.push(`/projects/${id}`);
    }
    setSubmitting(false);
    setConfirmingId(null);
  }

  async function handleUnlock() {
    setShowUnlockConfirm(false);
    setSubmitting(true);

    await fetch(`/api/projects/${id}/unlock`, { method: 'PUT' });
    setProjectStatus('researching');
    setSelectedCandidateId(null);
    setSelectedCandidateText('');
    setSubmitting(false);
  }

  if (loading) return <LoadingSpinner message="Loading candidates..." />;

  const isLocked = projectStatus === 'title_selected';

  return (
    <div>
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/" className="hover:text-gray-700">Dashboard</Link>
        <span className="mx-2">&gt;</span>
        <Link href={`/projects/${id}`} className="hover:text-gray-700">{projectTitle}</Link>
        <span className="mx-2">&gt;</span>
        <span className="text-gray-900">Select Title</span>
      </nav>

      <h1 className="text-3xl font-bold text-gray-900">Step 3 of 3: Select Your Title</h1>

      {/* Locked banner */}
      {isLocked && (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3">
          <p className="text-sm text-green-800">
            <span className="font-semibold">Title locked:</span> {selectedCandidateText}
          </p>
          <button
            onClick={() => setShowUnlockConfirm(true)}
            disabled={submitting}
            className="mt-2 text-sm font-medium text-green-700 underline hover:text-green-900"
          >
            Change Selection
          </button>
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="mt-6 text-center text-gray-500">
          <p>No candidates available.</p>
          <Link
            href={`/projects/${id}/research`}
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-800"
          >
            Run research first →
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {candidates.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              onSelect={
                isLocked
                  ? undefined
                  : () => {
                      setConfirmingId(c.id);
                      setConfirmingText(c.candidate_text);
                    }
              }
              selectLabel="Select This Title"
              disabled={submitting}
            />
          ))}
        </div>
      )}

      {/* Back to research */}
      {candidates.length > 0 && !isLocked && (
        <div className="mt-6">
          <Link
            href={`/projects/${id}/research`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← Back to research results
          </Link>
        </div>
      )}

      {/* Confirm selection modal */}
      {confirmingId && (
        <ConfirmModal
          title="Lock in this title?"
          message={`"${confirmingText}" — You can change it later but will need to unlock first.`}
          confirmLabel={submitting ? 'Selecting...' : 'Confirm Selection'}
          onConfirm={handleSelect}
          onCancel={() => setConfirmingId(null)}
        />
      )}

      {/* Confirm unlock modal */}
      {showUnlockConfirm && (
        <ConfirmModal
          title="Change Selection?"
          message="This will unlock your selection. You'll need to re-select a candidate."
          confirmLabel="Unlock"
          onConfirm={handleUnlock}
          onCancel={() => setShowUnlockConfirm(false)}
        />
      )}
    </div>
  );
}
