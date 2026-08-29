import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportOutputFormat } from './types';

// The private bucket created in migration 0009 — direct structural mirror of
// lib/cover/storage.ts's product-covers pattern (§8.5), extended for real product files.
const BUCKET = 'product-exports';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

const EXTENSION_BY_FORMAT: Record<ExportOutputFormat, string> = {
  pdf: 'pdf',
  docx: 'docx',
  notion_markdown: 'md',
};

export const CONTENT_TYPE_BY_FORMAT: Record<ExportOutputFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  notion_markdown: 'text/markdown',
};

/**
 * Path convention, same shape as migration 0007's cover assets:
 * {workspace_id}/{project_id}/{export_generation_id}.{ext} — the first folder segment
 * is what is_workspace_member() checks via storage.foldername(name)[1].
 */
export function buildExportAssetPath(workspaceId: string, projectId: string, exportGenerationId: string, outputFormat: ExportOutputFormat): string {
  return `${workspaceId}/${projectId}/${exportGenerationId}.${EXTENSION_BY_FORMAT[outputFormat]}`;
}

export interface UploadExportAssetParams {
  supabase: SupabaseClient;
  workspaceId: string;
  projectId: string;
  exportGenerationId: string;
  outputFormat: ExportOutputFormat;
  buffer: Buffer | string;
}

/**
 * Uploads a rendered export file — returns the storage path to persist in
 * export_generations.asset_storage_path, not a URL, since the bucket is private and
 * any URL must be freshly signed at read time (getSignedExportUrl below).
 */
export async function uploadExportAsset(params: UploadExportAssetParams): Promise<string> {
  const path = buildExportAssetPath(params.workspaceId, params.projectId, params.exportGenerationId, params.outputFormat);

  const { error } = await params.supabase.storage.from(BUCKET).upload(path, params.buffer, { contentType: CONTENT_TYPE_BY_FORMAT[params.outputFormat] });
  if (error) throw new Error(`Failed to upload export asset: ${error.message}`);

  return path;
}

export interface GetSignedExportUrlParams {
  supabase: SupabaseClient;
  assetStoragePath: string;
  expiresInSeconds?: number;
}

/** Same private-bucket + short-lived-signed-URL serving mechanism as cover assets (§8.5). */
export async function getSignedExportUrl(params: GetSignedExportUrlParams): Promise<string> {
  const { data, error } = await params.supabase.storage.from(BUCKET).createSignedUrl(params.assetStoragePath, params.expiresInSeconds ?? DEFAULT_SIGNED_URL_TTL_SECONDS);
  if (error || !data) throw new Error(`Failed to create signed export URL: ${error?.message}`);

  return data.signedUrl;
}
