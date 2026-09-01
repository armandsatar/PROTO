import { NextResponse } from 'next/server';
import { runResearch } from '@/lib/research/runResearch';
import {
  createServerSupabaseClient,
  HARDCODED_WORKSPACE_ID,
} from '@/lib/db/serverClient';

export async function POST(request: Request) {
  const body = await request.json();
  const { projectId, originalTitle, rationale } = body as {
    projectId: string;
    originalTitle: string;
    rationale: string;
  };

  if (!projectId || !originalTitle || !rationale) {
    return NextResponse.json(
      { error: 'projectId, originalTitle, and rationale are required' },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();

  try {
    const result = await runResearch({
      supabase,
      projectId,
      workspaceId: HARDCODED_WORKSPACE_ID,
      originalTitle,
      rationale,
    });

    return NextResponse.json({ runId: result.runId, candidates: result.candidates });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Research failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
