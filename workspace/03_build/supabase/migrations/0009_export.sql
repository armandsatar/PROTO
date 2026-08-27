-- PROTO Phase 9 (Step 11: Export)
-- Implements the data model in workspace/01_spec/phase9-requirements.md §8, amended
-- during build planning: a build-time completion split the original single-header
-- sketch into export_builds (a pure Step-4-shaped recommend/confirm record, no
-- content/approval of its own) + export_format_states (one row per (project_id,
-- output_format) that has been generated, carrying decision 4's approval mechanics and
-- §7's staleness detection independently per format — required once decision 6
-- confirmed multiple formats can coexist per project; a single approval_status scalar
-- on one header would have silently forced one format's state onto all of them).
--
-- Table order is strictly linear, no circular FK anywhere: export_builds (independent)
-- -> export_generations (references workspace/project directly, NOT export_builds —
-- generations persist across export_builds' own supersede cycle) -> export_format_states
-- (references export_generations(id) safely, since export_generations never points
-- back) -> export_field_maps (child of export_generations).

-- ============================================================
-- 1. Enums (generation_status, recommendation_status, cover_approval_status,
--    transformation_map_status all reused verbatim — see inline notes below)
-- ============================================================

create type export_output_format as enum ('pdf', 'notion_markdown', 'docx');
create type export_trigger_scope as enum ('initial', 'regenerate');
-- One more value than cover_generation_status's 3 — succeeded_with_warnings covers
-- §5's non-blocking sanity-check failures (a rendered page count wildly off from the
-- confirmed word count, a detected blank page), a real outcome distinct from a clean
-- success or a genuine failure.
create type export_generation_status as enum ('succeeded', 'succeeded_with_warnings', 'failed_fallback', 'failed_blocked');
-- Decision 1's structure-extraction output shape (§4.1) — classifies confirmed prose
-- spans for fillable-delivery products only.
create type export_field_type as enum ('heading', 'instructional_paragraph', 'checklist_item', 'user_input_blank', 'table_row');

alter type project_status add value 'export_generating';
alter type project_status add value 'ready_to_download';

-- ============================================================
-- 2. Tables
-- ============================================================

create table export_builds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- NOT unique — mirrors format_recommendations' own supersede-on-change shape
  -- exactly (migration 0002): "Change output format" creates a NEW row rather than
  -- updating in place, the prior one marked 'superseded'. projects.current_export_build_id
  -- (added below) always points at the single active one.
  project_id uuid not null references projects(id) on delete cascade,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),

  recommended_output_format export_output_format not null,
  reasoning_summary text not null,
  inputs_snapshot jsonb not null,
  model text not null,
  -- Reused verbatim from migration 0002 — the identical shape of AI call (small enum
  -- classification + a stated reason), same generic 3-value outcome set.
  generation_status generation_status not null,

  -- Confirmation fields: null until the user acts, set once.
  confirmed_output_format export_output_format,
  is_override boolean,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,

  -- Reused verbatim from migration 0002. Unlike format_recommendations, no
  -- superseded_reason enum is needed here — there is exactly one way an export_builds
  -- row is ever superseded (an explicit "Change output format" action), not three
  -- distinct triggers the way Step 4 had (title change / reconsider / format change),
  -- so a bare timestamp is sufficient audit trail without a single-value enum.
  recommendation_status recommendation_status not null default 'active',
  superseded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects add column current_export_build_id uuid references export_builds(id) on delete set null;

create table export_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  -- References the project directly, NOT export_builds — a generation for a given
  -- output_format persists independently of export_builds' own supersede cycle (the
  -- "recommended/confirmed primary format" can change without invalidating a PDF that
  -- was already generated for a different format entirely, decision 6).
  project_id uuid not null references projects(id) on delete cascade,
  output_format export_output_format not null,

  -- Sequential PER (project, output_format) — mirrors cover_generations' per-design
  -- numbering and copy_generations' per-platform numbering.
  generation_number int not null,
  trigger_scope export_trigger_scope not null,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  content_build_confirmed_at timestamptz not null,
  -- Snapshot of the cover_generations.id that was embedded — the staleness comparison
  -- basis (§7.2), not a live-following FK (on delete set null, since the cover
  -- generation embedded in an already-rendered file should never disappear from the
  -- audit log just because that cover candidate is later superseded upstream).
  cover_generation_id uuid references cover_generations(id) on delete set null,

  asset_storage_path text,
  -- Names the render engine used (e.g. '@react-pdf/renderer', 'docx',
  -- 'notion-markdown-assembler') — this phase's analog of an AI model name, since the
  -- assembly pipeline is deterministic engineering, not a generative call (§4).
  model text,
  page_count int,
  generation_status export_generation_status not null,
  error_detail text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (project_id, output_format, generation_number)
);

create table export_format_states (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  output_format export_output_format not null,

  -- §7's 4-way staleness dependencies (title > format > content bodies > cover),
  -- snapshotted per format independently — the build-time completion this migration's
  -- header comment describes.
  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  content_build_confirmed_at timestamptz not null,
  cover_generation_id uuid references cover_generations(id) on delete set null,

  current_export_generation_id uuid references export_generations(id) on delete set null,

  -- Reused verbatim (cover_designs' exact shape) — decision 4's mandatory
  -- visual-review gate, mirrored per format rather than once per project.
  status transformation_map_status not null default 'draft',
  approval_status cover_approval_status not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (project_id, output_format)
);

create table export_field_maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  export_generation_id uuid not null references export_generations(id) on delete cascade,
  -- Nullable so this audit row survives the subtopic being deleted later, same
  -- precedent as content_generations.subtopic_id (migration 0006).
  subtopic_id uuid references subtopics(id) on delete set null,

  field_order int not null,
  field_type export_field_type not null,
  source_text text not null,

  created_at timestamptz not null default now()
);

create index idx_export_builds_workspace on export_builds (workspace_id);
create index idx_export_builds_project on export_builds (project_id);
create index idx_export_generations_workspace on export_generations (workspace_id);
create index idx_export_generations_project_format on export_generations (project_id, output_format);
create index idx_export_format_states_workspace on export_format_states (workspace_id);
create index idx_export_field_maps_workspace on export_field_maps (workspace_id);
create index idx_export_field_maps_generation on export_field_maps (export_generation_id);

-- ============================================================
-- 3. RLS — every INSERT policy checks its parent's workspace_id from the start
--    (the Step 9/10 lesson, applied proactively again, not discovered via a failing test).
-- ============================================================

alter table export_builds enable row level security;
alter table export_generations enable row level security;
alter table export_format_states enable row level security;
alter table export_field_maps enable row level security;

grant select, insert, update on export_builds to authenticated;
grant select, insert on export_generations to authenticated;
grant select, insert, update on export_format_states to authenticated;
grant select, insert on export_field_maps to authenticated;

create policy export_builds_select on export_builds
  for select using (is_workspace_member(workspace_id));
create policy export_builds_insert on export_builds
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projects p where p.id = export_builds.project_id and p.workspace_id = export_builds.workspace_id)
  );
create policy export_builds_update on export_builds
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy export_generations_select on export_generations
  for select using (is_workspace_member(workspace_id));
create policy export_generations_insert on export_generations
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projects p where p.id = export_generations.project_id and p.workspace_id = export_generations.workspace_id)
  );

create policy export_format_states_select on export_format_states
  for select using (is_workspace_member(workspace_id));
create policy export_format_states_insert on export_format_states
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projects p where p.id = export_format_states.project_id and p.workspace_id = export_format_states.workspace_id)
  );
create policy export_format_states_update on export_format_states
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy export_field_maps_select on export_field_maps
  for select using (is_workspace_member(workspace_id));
create policy export_field_maps_insert on export_field_maps
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from export_generations eg where eg.id = export_field_maps.export_generation_id and eg.workspace_id = export_field_maps.workspace_id)
  );

-- ============================================================
-- 4. Supabase Storage — a new bucket for real product files, same private-bucket +
--    signed-URL + path-prefix-RLS pattern as migration 0007's product-covers bucket,
--    per decision in phase9-requirements.md §8.5. Same remote-deployment caveat as
--    migration 0007 applies (github.com/supabase/cli/issues/96) — verified against
--    local dev only.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-exports',
  'product-exports',
  false,
  52428800,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/markdown', 'application/zip']
);

-- Path convention: {workspace_id}/{project_id}/{export_generation_id}.{ext} — identical
-- technique to product-covers, literal reuse of is_workspace_member() via
-- storage.foldername(). No update/delete policy — objects are never modified once
-- uploaded, same append-only restraint as export_generations itself.
create policy export_assets_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-exports'
    and is_workspace_member(((storage.foldername(name))[1])::uuid)
  );

create policy export_assets_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-exports'
    and is_workspace_member(((storage.foldername(name))[1])::uuid)
  );
