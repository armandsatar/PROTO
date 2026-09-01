import { NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  HARDCODED_WORKSPACE_ID,
  HARDCODED_USER_ID,
} from '@/lib/db/serverClient';

export async function GET() {
  const supabase = createServerSupabaseClient();

  const { data: projects, error } = await supabase
    .from('projects')
    .select(`
      id,
      status,
      created_at,
      updated_at,
      title_ideas (
        original_title,
        rationale
      )
    `)
    .eq('workspace_id', HARDCODED_WORKSPACE_ID)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = (projects ?? []).map((p) => {
    const idea = Array.isArray(p.title_ideas) ? p.title_ideas[0] : p.title_ideas;
    return {
      id: p.id,
      status: p.status,
      title: idea?.original_title ?? '(untitled)',
      rationale: idea?.rationale ?? '',
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });

  return NextResponse.json({ projects: result });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { title, rationale } = body as { title: string; rationale: string };

  if (!title || !rationale) {
    return NextResponse.json({ error: 'title and rationale are required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .insert({
      workspace_id: HARDCODED_WORKSPACE_ID,
      created_by: HARDCODED_USER_ID,
      status: 'draft',
    })
    .select()
    .single();

  if (projectErr || !project) {
    return NextResponse.json(
      { error: projectErr?.message ?? 'Failed to create project' },
      { status: 500 },
    );
  }

  const { error: ideaErr } = await supabase.from('title_ideas').insert({
    project_id: project.id,
    workspace_id: HARDCODED_WORKSPACE_ID,
    original_title: title,
    rationale,
    created_by: HARDCODED_USER_ID,
  });

  if (ideaErr) {
    return NextResponse.json({ error: ideaErr.message }, { status: 500 });
  }

  return NextResponse.json({ projectId: project.id }, { status: 201 });
}
