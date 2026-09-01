import { NextResponse } from 'next/server';
import {
  createServerSupabaseClient,
  HARDCODED_WORKSPACE_ID,
} from '@/lib/db/serverClient';

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();

  const { error } = await supabase
    .from('projects')
    .update({
      selected_candidate_id: null,
      status: 'researching',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('workspace_id', HARDCODED_WORKSPACE_ID);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
