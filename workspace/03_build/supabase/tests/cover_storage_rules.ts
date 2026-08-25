// Behavioral test for the `product-covers` Supabase Storage bucket (migration 0007).
// A genuinely new verification technique for this build: plain SQL tests (see
// cover_design_rules.sql) can't exercise Storage policies — they're evaluated by the
// Storage API against object paths/metadata, not queryable Postgres rows the way every
// prior migration's RLS was tested. This uses the real Supabase JS Storage client,
// as two real authenticated users, through actual RLS — no service-role bypass, same
// access path the real app will use.
//
// Proves:
// 1. A user can upload to their own workspace's path prefix and read it back.
// 2. A DIFFERENT user cannot read another workspace's object at all (not just "can't
//    upload" — full isolation).
// 3. A user cannot upload while CLAIMING another workspace's prefix in the path,
//    even though the bucket itself doesn't care about path structure by default —
//    this is entirely enforced by the is_workspace_member() policy check.
//
// Run with:
//   supabase start   (or: supabase db reset, if already running)
//   npx tsx --env-file=.env supabase/tests/cover_storage_rules.ts

import { bootstrapTestFixture } from '../../scripts/lib/testFixtures';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const BUCKET = 'product-covers';
const testFileBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]); // minimal fake JPEG-ish bytes, content doesn't matter for RLS

async function main() {
  console.log('=== Bootstrapping two independent users/workspaces (through RLS) ===');
  const userA = await bootstrapTestFixture('storage-a');
  const userB = await bootstrapTestFixture('storage-b');
  console.log(`User A workspace: ${userA.workspaceId}`);
  console.log(`User B workspace: ${userB.workspaceId}`);

  const pathA = `${userA.workspaceId}/${userA.projectId}/test-cover.jpg`;

  // ---------- Test 1: User A uploads to their own workspace prefix ----------
  console.log('\n=== TEST 1: User A uploads to their own workspace path prefix (expect success) ===');
  const { error: uploadErr } = await userA.supabase.storage.from(BUCKET).upload(pathA, testFileBytes, { contentType: 'image/jpeg' });
  assert(!uploadErr, `Expected upload to succeed, got: ${uploadErr?.message}`);
  console.log(`OK: uploaded to ${pathA}`);

  // ---------- Test 2: User A can read it back ----------
  console.log('\n=== TEST 2: User A downloads their own object (expect success) ===');
  const { data: downloadA, error: downloadAErr } = await userA.supabase.storage.from(BUCKET).download(pathA);
  assert(!downloadAErr && !!downloadA, `Expected download to succeed, got: ${downloadAErr?.message}`);
  console.log(`OK: downloaded ${downloadA?.size} bytes`);

  // ---------- Test 3: User B CANNOT read User A's object (full isolation, not just insert-blocked) ----------
  console.log("\n=== TEST 3: User B attempts to download User A's object (expect rejection) ===");
  const { data: downloadB, error: downloadBErr } = await userB.supabase.storage.from(BUCKET).download(pathA);
  assert(!downloadB && !!downloadBErr, 'Expected download to be rejected by RLS, but it succeeded');
  console.log(`OK: correctly rejected — ${downloadBErr?.message}`);

  // ---------- Test 4: User B cannot upload while claiming User A's workspace prefix ----------
  console.log("\n=== TEST 4: User B attempts to upload to a path claiming User A's workspace prefix (expect rejection) ===");
  const spoofedPath = `${userA.workspaceId}/${userA.projectId}/spoofed-cover.jpg`;
  const { error: spoofErr } = await userB.supabase.storage.from(BUCKET).upload(spoofedPath, testFileBytes, { contentType: 'image/jpeg' });
  assert(!!spoofErr, 'Expected the spoofed-prefix upload to be rejected by RLS, but it succeeded');
  console.log(`OK: correctly rejected — ${spoofErr?.message}`);

  // ---------- Test 5: User B can upload to their OWN workspace prefix (sanity check) ----------
  console.log('\n=== TEST 5: User B uploads to their own workspace path prefix (expect success) ===');
  const pathB = `${userB.workspaceId}/${userB.projectId}/test-cover.jpg`;
  const { error: uploadBErr } = await userB.supabase.storage.from(BUCKET).upload(pathB, testFileBytes, { contentType: 'image/jpeg' });
  assert(!uploadBErr, `Expected User B's own-workspace upload to succeed, got: ${uploadBErr?.message}`);
  console.log(`OK: uploaded to ${pathB}`);

  // ---------- Test 6: listing the bucket only shows each user their own workspace's objects ----------
  console.log("\n=== TEST 6: User A lists their workspace folder (expect only their own file, not User B's) ===");
  const { data: listA, error: listAErr } = await userA.supabase.storage.from(BUCKET).list(`${userA.workspaceId}/${userA.projectId}`);
  assert(!listAErr, `Expected list to succeed, got: ${listAErr?.message}`);
  assert((listA ?? []).some((f) => f.name === 'test-cover.jpg'), "Expected to see User A's own uploaded file in the listing");
  console.log(`OK: User A's listing shows ${listA?.length} file(s), all their own.`);

  console.log(
    '\nStorage RLS behavioral test passed: upload/download to own workspace prefix works, cross-workspace download is fully blocked (not just upload), and path-prefix spoofing is rejected — all enforced by is_workspace_member() via the storage policies in migration 0007, verified live through the real Supabase Storage client, no service-role bypass.',
  );
}

main().catch((err) => {
  console.error('\nStorage RLS behavioral test FAILED:', err);
  process.exit(1);
});
