import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/db/serverClient';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const supabase = createServerSupabaseClient();

  const { data: run, error: runErr } = await supabase
    .from('research_runs')
    .select('id, status, run_number, error_detail, started_at, completed_at')
    .eq('id', runId)
    .single();

  if (runErr || !run) {
    return NextResponse.json({ error: 'Research run not found' }, { status: 404 });
  }

  if (run.status === 'completed') {
    const { data: candidates } = await supabase
      .from('title_candidates')
      .select('*')
      .eq('research_run_id', run.id)
      .order('display_order', { ascending: true });

    return NextResponse.json({ status: run.status, candidates });
  }

  return NextResponse.json({
    status: run.status,
    error: run.error_detail ?? undefined,
  });
}
