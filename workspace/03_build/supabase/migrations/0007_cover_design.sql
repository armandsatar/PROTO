-- PROTO Phase 7 (Step 9: Design)
-- Implements the data model in workspace/01_spec/phase7-requirements.md §7, plus a
-- Supabase Storage bucket for the binary cover assets — the first phase to store
-- anything besides text/jsonb in Postgres columns. A real 2-way circular FK
-- (cover_designs <-> cover_generations), same resolution technique as migrations
-- 0001/0005: nullable column first, ALTER TABLE ADD CONSTRAINT once both tables exist.

-- ============================================================
-- 1. Enums (transformation_map_status reused for cover_designs.status — decision 4)
-- ============================================================

create type cover_approval_status as enum ('pending', 'approved');
create type cover_trigger_scope as enum ('initial_candidate', 'style_edit', 'user_upload');
-- Simpler 3-value set than every text phase's 4-value set (§7.3) — there is no
-- length-miss-equivalent outcome for an image, either an artifact exists or it doesn't.
create type cover_generation_status as enum ('succeeded', 'failed_fallback', 'failed_blocked');

alter type project_status add value 'design_generating';
alter type project_status add value 'cover_approved';

-- ============================================================
-- 2. Tables — circular FK resolved the same way migration 0001/0005 did
-- ============================================================

create table cover_designs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null unique references projects(id) on delete cascade,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  -- Staleness snapshot for the Step 8 dependency — a timestamp, not an FK, since
  -- content_builds has no supersede/version model to point at (§7.10, direct reuse of
  -- Step 8's own precedent for depending on Step 7's list via the identical situation).
  content_build_confirmed_at timestamptz not null,

  recommended_look_id text not null,
  recommendation_reason text not null,
  confirmed_look_id text not null,
  look_is_overridden boolean not null default false,

  -- FK added below via ALTER TABLE, once cover_generations exists (circular reference)
  current_cover_generation_id uuid,

  candidate_count int not null default 0,
  edit_round_count int not null default 0,

  approval_status cover_approval_status not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references auth.users(id),

  status transformation_map_status not null default 'draft',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table cover_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  cover_design_id uuid not null references cover_designs(id) on delete cascade,

  generation_number int not null,
  trigger_scope cover_trigger_scope not null,
  -- Self-referencing — no circular-FK trick needed, `id` is already defined above in
  -- this same CREATE TABLE. Which prior candidate a style_edit is based on (§5.2/§7.3).
  parent_generation_id uuid references cover_generations(id) on delete set null,

  look_id text,
  edit_instruction text,
  prompt_sent text,
  -- The REMOTE Gemini interaction id (e.g. "v1_ChdEdTJOYW8yaUc1R2UyOG9QOEtUVHVRMBIX...",
  -- confirmed live in scripts/verify-gemini-connector.ts's output) — needed for the
  -- style-edit call's multi-turn continuation (previous_interaction_id). Distinct from
  -- this row's own `id` and from `parent_generation_id` (an internal lineage FK) — a
  -- technical necessity flagged and approved during build planning, not in the
  -- original requirements doc. Null for user_upload (no Gemini call involved).
  gemini_interaction_id text,

  asset_storage_path text,
  model text,
  cost_usd numeric(6, 4),
  generation_status cover_generation_status not null,
  error_detail text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (cover_design_id, generation_number)
);

alter table cover_designs
  add constraint cover_designs_current_generation_fk
    foreign key (current_cover_generation_id) references cover_generations(id) on delete set null;

create index idx_cover_designs_workspace on cover_designs (workspace_id);
create index idx_cover_generations_workspace on cover_generations (workspace_id);
create index idx_cover_generations_design on cover_generations (cover_design_id);
create index idx_cover_generations_parent on cover_generations (parent_generation_id);

-- ============================================================
-- 3. RLS (Postgres tables) — no new mechanism, same is_workspace_member() convention
--    as every prior migration. cover_generations is append-only (select+insert only,
--    same as every prior generation log — no update/delete grant). cover_designs
--    is a coarse workspace-gated header, no trigger needed (mirrors migrations
--    0005/0006's finding that a mutable header with no same-row content-lock problem
--    needs no OLD-vs-NEW trigger).
-- ============================================================

alter table cover_designs enable row level security;
alter table cover_generations enable row level security;

grant select, insert, update on cover_designs to authenticated;
grant select, insert on cover_generations to authenticated;

-- INSERT/UPDATE additionally verify projects.workspace_id matches the claimed
-- workspace_id — Postgres FK constraints check referential integrity only (does a row
-- with this id exist), not RLS-visibility, so project_id alone doesn't stop a caller
-- from claiming their own valid workspace_id while pointing at a project they don't
-- actually have access to. Proactively closed here, the same class of fix Step 7/8
-- needed for subtopics/subtopic_contents — NOTE this same gap exists on every other
-- project-linked header table since migration 0002 (format_recommendations,
-- lead_magnet_recommendations, transformation_maps, subtopic_lists, content_builds all
-- lack this check too), flagged as a pre-existing, cross-cutting finding worth a
-- dedicated review pass, not retrofitted here — out of scope for this migration.
create policy cover_designs_select on cover_designs
  for select using (is_workspace_member(workspace_id));
create policy cover_designs_insert on cover_designs
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projects p where p.id = cover_designs.project_id and p.workspace_id = cover_designs.workspace_id)
  );
create policy cover_designs_update on cover_designs
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

-- INSERT also checks the parent cover_designs row's workspace_id — same class of fix
-- as subtopics_insert relative to subtopic_lists (migration 0005): the concern isn't
-- primarily SELECT-time visibility (RLS still gates reads by a row's own workspace_id
-- either way), it's that candidate_count/edit_round_count cap enforcement (§4.2) could
-- be silently polluted by a spoofed cross-workspace row if any future query counts
-- cover_generations by cover_design_id without also filtering by workspace_id.
create policy cover_generations_select on cover_generations
  for select using (is_workspace_member(workspace_id));
create policy cover_generations_insert on cover_generations
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from cover_designs cd where cd.id = cover_generations.cover_design_id and cd.workspace_id = cover_generations.workspace_id)
  );

-- ============================================================
-- 4. Supabase Storage — the first binary-asset bucket in this codebase.
--
-- NOTE ON REMOTE DEPLOYMENT (flagged, not silently assumed away): a documented
-- Supabase CLI issue (github.com/supabase/cli/issues/96) shows storage-policy
-- migrations can fail with "must be owner of table objects" when pushed to a REMOTE
-- (hosted) project, even though they apply cleanly against a LOCAL `supabase db
-- reset` (the local postgres role has full ownership; a remote project's migration
-- role may not). This migration is verified against local dev only, per this
-- project's established workflow — the remote-push path needs its own live check
-- before this ever ships to a real hosted Supabase project, not assumed to just work.
--
-- Private bucket (not public) — cover assets are workspace-scoped, potentially for
-- unpublished products, served via short-lived signed URLs (lib/cover/storage.ts,
-- increment 5), never a public URL.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-covers', 'product-covers', false, 10485760, array['image/jpeg', 'image/png']);

-- Path convention: {workspace_id}/{project_id}/{cover_generation_id}.{ext} — the first
-- folder segment is the workspace id, checked against real workspace membership via
-- the SAME is_workspace_member() function every Postgres table already uses (a
-- literal reuse, not just a re-expressed pattern, since storage.foldername() lets a
-- path segment be cast and passed straight into the existing function).
-- No update/delete policy — objects are never modified or removed once uploaded,
-- same append-only restraint as cover_generations itself (a new candidate is a new
-- object at a new path, never an overwrite).
create policy cover_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-covers'
    and is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy cover_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-covers'
    and is_workspace_member(((storage.foldername(name))[1])::uuid)
  );
