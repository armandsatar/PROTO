import { describe, it, expect, vi } from 'vitest';
import { buildCoverAssetPath, uploadCoverAsset, getSignedCoverUrl } from '../lib/cover/storage';

describe('buildCoverAssetPath', () => {
  it('builds the {workspace_id}/{project_id}/{cover_generation_id}.jpg path for jpeg', () => {
    expect(buildCoverAssetPath('ws-1', 'proj-1', 'gen-1', 'image/jpeg')).toBe('ws-1/proj-1/gen-1.jpg');
  });

  it('uses .png extension for image/png', () => {
    expect(buildCoverAssetPath('ws-1', 'proj-1', 'gen-1', 'image/png')).toBe('ws-1/proj-1/gen-1.png');
  });
});

function mockSupabase(overrides: { uploadError?: { message: string }; signedUrlError?: { message: string }; signedUrl?: string }) {
  const upload = vi.fn().mockResolvedValue({ error: overrides.uploadError ?? null });
  const createSignedUrl = vi.fn().mockResolvedValue(
    overrides.signedUrlError
      ? { data: null, error: overrides.signedUrlError }
      : { data: { signedUrl: overrides.signedUrl ?? 'https://example.supabase.co/storage/v1/object/sign/product-covers/ws-1/proj-1/gen-1.jpg?token=abc' }, error: null },
  );
  return { storage: { from: () => ({ upload, createSignedUrl }) } } as never;
}

describe('uploadCoverAsset', () => {
  it('returns the built path on success', async () => {
    const supabase = mockSupabase({});
    const path = await uploadCoverAsset({ supabase, workspaceId: 'ws-1', projectId: 'proj-1', coverGenerationId: 'gen-1', buffer: Buffer.from('x'), contentType: 'image/jpeg' });
    expect(path).toBe('ws-1/proj-1/gen-1.jpg');
  });

  it('throws with the storage error message on failure', async () => {
    const supabase = mockSupabase({ uploadError: { message: 'bucket not found' } });
    await expect(
      uploadCoverAsset({ supabase, workspaceId: 'ws-1', projectId: 'proj-1', coverGenerationId: 'gen-1', buffer: Buffer.from('x'), contentType: 'image/jpeg' }),
    ).rejects.toThrow(/bucket not found/);
  });
});

describe('getSignedCoverUrl', () => {
  it('returns the signed URL on success', async () => {
    const supabase = mockSupabase({});
    const url = await getSignedCoverUrl({ supabase, assetStoragePath: 'ws-1/proj-1/gen-1.jpg' });
    expect(url).toContain('token=');
  });

  it('throws on failure', async () => {
    const supabase = mockSupabase({ signedUrlError: { message: 'object not found' } });
    await expect(getSignedCoverUrl({ supabase, assetStoragePath: 'ws-1/proj-1/gen-1.jpg' })).rejects.toThrow(/object not found/);
  });
});
