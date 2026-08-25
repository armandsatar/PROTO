import type { SupabaseClient } from '@supabase/supabase-js';

// The private bucket created in migration 0007 — cover assets are workspace-scoped,
// potentially for unpublished products, never served via a public URL.
const BUCKET = 'product-covers';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

/**
 * Path convention confirmed live in migration 0007's storage policies:
 * {workspace_id}/{project_id}/{cover_generation_id}.{ext} — the first folder segment
 * is what is_workspace_member() checks via storage.foldername(name)[1].
 */
export function buildCoverAssetPath(workspaceId: string, projectId: string, coverGenerationId: string, contentType: string): string {
  const extension = contentType === 'image/png' ? 'png' : 'jpg';
  return `${workspaceId}/${projectId}/${coverGenerationId}.${extension}`;
}

export interface UploadCoverAssetParams {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  coverGenerationId: string;
  buffer: Buffer;
  contentType: string;
}

/**
 * Uploads a rendered/AI-generated cover asset — returns the storage path to persist
 * in cover_generations.asset_storage_path (§7.3), not a URL, since the bucket is
 * private and any URL must be freshly signed at read time (getSignedCoverUrl below).
 */
export async function uploadCoverAsset(params: UploadCoverAssetParams): Promise<string> {
  const path = buildCoverAssetPath(params.workspaceId, params.projectId, params.coverGenerationId, params.contentType);

  const { error } = await params.supabase.storage.from(BUCKET).upload(path, params.buffer, { contentType: params.contentType });
  if (error) throw new Error(`Failed to upload cover asset: ${error.message}`);

  return path;
}

export interface GetSignedCoverUrlParams {
  supabase: SupabaseClient;
  assetStoragePath: string;
  expiresInSeconds?: number;
}

/**
 * Decision 17's proposed storage approach (private bucket + short-lived signed URLs,
 * DEV-proposed, reviewed by Arman before build per §5.3) — the actual serving
 * mechanism a future UI will call. No public URL exists for any cover asset.
 */
export async function getSignedCoverUrl(params: GetSignedCoverUrlParams): Promise<string> {
  const { data, error } = await params.supabase.storage
    .from(BUCKET)
    .createSignedUrl(params.assetStoragePath, params.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`Failed to create signed cover URL: ${error?.message}`);

  return data.signedUrl;
}
