-- PROTO Phase 8 (Step 10: Copywriting)
-- Implements the data model in workspace/01_spec/phase8-requirements.md §9, amended
-- 2026-08-27 (decisions 13-14): one shared marketing narrative, adapted per platform,
-- modeled as a 7th `copy_platform` sentinel value ('narrative') rather than a second
-- parallel header+log shape. Same 4-table family as migration 0006 (content_builds ->
-- content_generations -> subtopic_contents -> content_compliance_changes): every FK
-- here points strictly backward too — copywriting_builds -> copy_generations ->
-- platform_copies -> copy_compliance_changes — so, same as 0006, no nullable-then-
-- ALTER-TABLE circular-FK trick is needed anywhere below. copy_generations references
-- copywriting_build_id + a bare `platform` enum column (not platform_copies.id),
-- mirroring content_generations referencing subtopic_id rather than
-- subtopic_contents.id — this is what avoids the circularity.

-- ============================================================
-- 1. Enums (transformation_map_status reused for copywriting_builds.status — same
--    reuse convention as content_builds/cover_designs; content_status/
--    content_quality_flag/content_compliance_status/content_risk_category/
--    content_change_detector reused verbatim from migration 0006, decision in §9.3)
-- ============================================================

create type copy_platform as enum ('etsy', 'gumroad', 'stanstore', 'whop', 'pinterest', 'instagram', 'narrative');
create type copy_trigger_scope as enum ('initial', 'regenerate_one', 'regenerate_all');
-- One more value than content_generation_status's 4 — succeeded_outside_soft_target is
-- a genuinely distinct, non-blocking outcome no prior text phase needed (§9.3).
create type copy_generation_status as enum ('succeeded', 'succeeded_outside_soft_target', 'failed_hard_limit_exceeded', 'failed_fallback', 'failed_blocked');
create type copy_hard_limit_status as enum ('within_limit', 'exceeds_limit');

alter type project_status add value 'copy_generating';
alter type project_status add value 'copy_confirmed';

-- ============================================================
-- 2. Tables — strictly linear FK order, no circular reference (see header note)
-- ============================================================

create table copywriting_builds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null unique references projects(id) on delete cascade,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  transformation_map_snapshot_at timestamptz not null,
  -- Gap-fill (phase8-requirements.md §8.3): a direct copy of content_builds' own
  -- subtopic_list_confirmed_at column/technique — the original locked doc named
  -- "confirmed subtopics list" as a dependency but never operationalized a detection
  -- path for it, and Step 8's own per-row subtopic staleness never bumps
  -- content_builds.confirmed_at, so this needed its own explicit snapshot column.
  subtopic_list_confirmed_at timestamptz not null,
  content_build_confirmed_at timestamptz not null,
  cover_look_snapshot text not null,

  confirmed_format format_type not null,

  status transformation_map_status not null default 'draft',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),

  regenerate_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table copy_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  copywriting_build_id uuid not null references copywriting_builds(id) on delete cascade,

  -- A bare enum value, not a FK — the platform set (including the 'narrative'
  -- sentinel, decision 14) is a fixed code-level constant, not a table row.
  platform copy_platform not null,

  -- Sequential PER PLATFORM (including the narrative row's own sequence), same
  -- convention as content_generations' per-subtopic numbering.
  generation_number int not null,
  trigger_scope copy_trigger_scope not null,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  transformation_map_snapshot_at timestamptz not null,
  subtopic_list_confirmed_at timestamptz not null,
  content_build_confirmed_at timestamptz not null,
  cover_look_snapshot text not null,

  -- Structured, not plain text (unlike content_generations) — every platform's (and
  -- the narrative's own) output is a heterogeneous field set, §0.3/§9.2.
  inputs_snapshot jsonb not null,
  draft_content_snapshot jsonb,
  output_snapshot jsonb,

  specificity_score int,
  compliance_status content_compliance_status not null,
  -- Always 'within_limit' for the narrative row (§4 rule 1 never applies to it) and
  -- for any platform this build's decision 5 hasn't enforced a ceiling for yet.
  hard_limit_status copy_hard_limit_status not null default 'within_limit',
  model text not null,
  generation_status copy_generation_status not null,
  error_detail text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (copywriting_build_id, platform, generation_number),
  check (specificity_score is null or specificity_score between 1 and 10)
);

create table platform_copies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  copywriting_build_id uuid not null references copywriting_builds(id) on delete cascade,

  -- Up to 7 per project (6 real platforms + the 'narrative' sentinel, decision 14) —
  -- cardinality inherited from the fixed enum, not a live upstream table (§0.2).
  platform copy_platform not null,

  -- Hybrid shape (decision 11, §9.2): typed title/body for the two near-universal
  -- concepts, jsonb for the rest. The narrative row stores its 4 structured fields
  -- (hook/transformation_story/cta/summary) in platform_fields; title/body stay null
  -- for that row specifically.
  title text,
  body text not null default '',
  platform_fields jsonb not null default '{}'::jsonb,

  word_count int not null default 0,
  char_count int not null default 0,
  hard_limit_status copy_hard_limit_status not null default 'within_limit',
  content_status content_status not null default 'failed_empty',
  source_generation_id uuid references copy_generations(id) on delete set null,

  -- Per-row staleness (§8.4), new to this phase: null for the narrative row itself;
  -- populated with the narrative row's own updated_at at the moment each of the 6 real
  -- platforms was last generated/adapted from it. A live mismatch flags that platform
  -- stale-relative-to-narrative — same frozen-snapshot-vs-live-value technique as
  -- content_generations.subtopic_snapshot, one level up.
  narrative_snapshot_at timestamptz,

  is_edited boolean not null default false,
  compliance_reviewed boolean not null default false,
  quality_flag content_quality_flag not null default 'clean',

  last_edited_at timestamptz,
  last_edited_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (copywriting_build_id, platform)
);

create table copy_compliance_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  copy_generation_id uuid not null references copy_generations(id) on delete cascade,
  -- Denormalized direct query path, same reasoning as content_compliance_changes'
  -- subtopic_content_id.
  platform_copy_id uuid not null references platform_copies(id) on delete cascade,

  original_text text not null,
  rewritten_text text not null,
  reason text not null,
  risk_category content_risk_category not null,
  detected_by content_change_detector not null,

  created_at timestamptz not null default now()
);

create index idx_copywriting_builds_workspace on copywriting_builds (workspace_id);
create index idx_copy_generations_workspace on copy_generations (workspace_id);
create index idx_copy_generations_build on copy_generations (copywriting_build_id);
create index idx_platform_copies_workspace on platform_copies (workspace_id);
create index idx_platform_copies_build on platform_copies (copywriting_build_id);
create index idx_copy_compliance_changes_workspace on copy_compliance_changes (workspace_id);
create index idx_copy_compliance_changes_generation on copy_compliance_changes (copy_generation_id);
create index idx_copy_compliance_changes_copy on copy_compliance_changes (platform_copy_id);

-- ============================================================
-- 3. RLS — the Step 9 lesson (cover_generations' cross-workspace spoofing gap, caught
--    live by a failing test) is applied proactively here from the start: every INSERT
--    policy below checks its parent row's workspace_id in addition to the inserting
--    row's own, not just is_workspace_member(workspace_id) alone.
-- ============================================================

alter table copywriting_builds enable row level security;
alter table copy_generations enable row level security;
alter table platform_copies enable row level security;
alter table copy_compliance_changes enable row level security;

grant select, insert, update on copywriting_builds to authenticated;
grant select, insert on copy_generations to authenticated;
grant select, insert, update on platform_copies to authenticated;
grant select, insert on copy_compliance_changes to authenticated;

create policy copywriting_builds_select on copywriting_builds
  for select using (is_workspace_member(workspace_id));
create policy copywriting_builds_insert on copywriting_builds
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projects p where p.id = copywriting_builds.project_id and p.workspace_id = copywriting_builds.workspace_id)
  );
create policy copywriting_builds_update on copywriting_builds
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy copy_generations_select on copy_generations
  for select using (is_workspace_member(workspace_id));
create policy copy_generations_insert on copy_generations
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from copywriting_builds cb where cb.id = copy_generations.copywriting_build_id and cb.workspace_id = copy_generations.workspace_id)
  );

create policy copy_compliance_changes_select on copy_compliance_changes
  for select using (is_workspace_member(workspace_id));
create policy copy_compliance_changes_insert on copy_compliance_changes
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from copy_generations cg where cg.id = copy_compliance_changes.copy_generation_id and cg.workspace_id = copy_compliance_changes.workspace_id)
  );

-- platform_copies: always readable regardless of lock state. Insert/update require
-- BOTH workspace membership AND the parent build currently being 'draft', plus the
-- parent-workspace-match check. No DELETE grant at all — the row set (6 platforms +
-- narrative) is fixed, never user-managed (unlike subtopic_contents' cascade-only delete).
create policy platform_copies_select on platform_copies
  for select using (is_workspace_member(workspace_id));

create policy platform_copies_insert on platform_copies
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from copywriting_builds cb
      where cb.id = platform_copies.copywriting_build_id
        and cb.workspace_id = platform_copies.workspace_id
        and cb.status = 'draft'
    )
  );

create policy platform_copies_update on platform_copies
  for update
  using (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from copywriting_builds cb
      where cb.id = platform_copies.copywriting_build_id
        and cb.workspace_id = platform_copies.workspace_id
        and cb.status = 'draft'
    )
  )
  with check (is_workspace_member(workspace_id));
