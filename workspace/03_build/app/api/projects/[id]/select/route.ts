import { NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  HARDCODED_WORKSPACE_ID,
  HARDCODED_USER_ID,
} from '@/lib/db/serverClient';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { candidateId } = body as { candidateId: string };

  if (!candidateId) {
    return NextResponse.json({ error: 'candidateId is required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  // Update project: lock selection
  const { error: projectErr } = await supabase
    .from('projects')
    .update({
      selected_candidate_id: candidateId,
      status: 'title_selected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', HARDCODED_WORKSPACE_ID);

  if (projectErr) {
    return NextResponse.json({ error: projectErr.message }, { status: 500 });
  }

  // Get the research run ID for the audit log
  const { data: project } = await supabase
    .from('projects')
    .select('current_research_run_id')
    .eq('id', id)
    .single();

  // Insert title_selections audit row
  const { error: selectionErr } = await supabase.from('title_selections').insert({
    project_id: id,
    workspace_id: HARDCODED_WORKSPACE_ID,
    research_run_id: project?.current_research_run_id,
    selected_candidate_id: candidateId,
    selected_by: HARDCODED_USER_ID,
  });

  if (selectionErr) {
    return NextResponse.json({ error: selectionErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
