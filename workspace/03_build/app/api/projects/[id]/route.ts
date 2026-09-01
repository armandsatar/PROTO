import { NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  HARDCODED_WORKSPACE_ID,
} from '@/lib/db/serverClient';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('id, status, selected_candidate_id, current_research_run_id, created_at, updated_at')
    .eq('id', id)
    .eq('workspace_id', HARDCODED_WORKSPACE_ID)
    .single();

  if (projectErr || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const { data: titleIdea } = await supabase
    .from('title_ideas')
    .select('id, original_title, rationale')
    .eq('project_id', id)
    .single();

  let latestRun = null;
  let candidates = null;

  if (project.current_research_run_id) {
    const { data: run } = await supabase
      .from('research_runs')
      .select('id, run_number, status, started_at, completed_at, error_detail')
      .eq('id', project.current_research_run_id)
      .single();

    latestRun = run;

    if (run?.status === 'completed') {
      const { data: cands } = await supabase
        .from('title_candidates')
        .select('*')
        .eq('research_run_id', run.id)
        .order('display_order', { ascending: true });

      candidates = cands;
    }
  }

  return NextResponse.json({ project, titleIdea, latestRun, candidates });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { title, rationale } = body as { title: string; rationale: string };

  if (!title || !rationale) {
    return NextResponse.json({ error: 'title and rationale are required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { error } = await supabase
    .from('title_ideas')
    .update({ original_title: title, rationale, updated_at: new Date().toISOString() })
    .eq('project_id', id)
    .eq('workspace_id', HARDCODED_WORKSPACE_ID);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
