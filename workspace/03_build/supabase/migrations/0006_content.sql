-- PROTO Phase 6 (Step 8: Content Builder)
-- Implements the data model in workspace/01_spec/phase6-requirements.md §1.
-- A fourth new table beyond the established 3-table shape: content_builds (header) +
-- content_generations (append-only log) + subtopic_contents (live, 1:1 with subtopics)
-- + content_compliance_changes (append-only child log of the visible change-log
-- requirement). Unlike migrations 0001/0005, every FK here points strictly backward —
-- content_builds -> content_generations -> subtopic_contents -> content_compliance_changes
-- — so no nullable-then-ALTER-TABLE circular-FK trick is needed anywhere below.

-- ============================================================
-- 1. Enums (transformation_map_status reused for content_builds.status — decision 15)
-- ============================================================

create type content_status as enum ('generated', 'manual', 'failed_empty');
create type content_quality_flag as enum ('clean', 'below_specificity_threshold');
create type content_trigger_scope as enum ('initial', 'regenerate_one', 'regenerate_all', 'new_subtopic_backfill');
create type content_compliance_status as enum ('no_changes_needed', 'changes_applied', 'review_pass_failed');
-- One more value than precedent's 3-value generation_status set, mirroring decision 9's
-- succeeded_below_target precedent — here applied to length instead of count.
create type content_generation_status as enum ('succeeded', 'succeeded_outside_length_target', 'failed_fallback', 'failed_blocked');
create type content_risk_category as enum ('unsupported_claim', 'absolute_language', 'missing_disclaimer', 'diagnostic_language', 'other');
create type content_change_detector as enum ('ai_judgment', 'deterministic_keyword_catch');

alter type project_status add value 'content_generating';
alter type project_status add value 'content_confirmed';

-- ============================================================
-- 2. Tables — strictly linear FK order, no circular reference (see header note)
-- ============================================================

create table content_builds (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null unique references projects(id) on delete cascade,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  transformation_map_snapshot_at timestamptz not null,
  -- Snapshot of subtopic_lists.confirmed_at at generation time — a real version marker,
  -- not just a timestamp of convenience: subtopics rows are only editable while
  -- subtopic_lists.status='draft' (migration 0005's RLS), so the confirmed subtopics
  -- list this build trusts as input cannot change without an explicit unlock-and-
  -- reconfirm cycle, which always produces a fresh confirmed_at. Per-row staleness
  -- (§7.4 of the requirements doc) is a separate, finer-grained check — see
  -- content_generations.subtopic_snapshot below, not replaced by this column.
  subtopic_list_confirmed_at timestamptz not null,

  confirmed_format format_type not null,

  status transformation_map_status not null default 'draft',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),

  regenerate_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  content_build_id uuid not null references content_builds(id) on delete cascade,

  -- Nullable specifically so this log row SURVIVES its subtopic being deleted later
  -- (direct precedent match to subtopic_generations.target_subtopic_id's identical
  -- on delete set null treatment, migration 0005). Always populated at insert time.
  subtopic_id uuid references subtopics(id) on delete set null,

  -- Sequential PER SUBTOPIC, not per document — "Attempt N of 5" is a per-subtopic
  -- concept here, unlike Step 7 where it was per-list.
  generation_number int not null,
  trigger_scope content_trigger_scope not null,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  transformation_map_snapshot_at timestamptz not null,
  subtopic_list_confirmed_at timestamptz not null,

  -- Frozen copy of this subtopic's title/description/depth at generation time — the
  -- per-row staleness comparison basis (compared against the LIVE subtopics row).
  subtopic_snapshot jsonb not null,
  inputs_snapshot jsonb not null,

  -- The writer pass's raw output, before the review pass touches it.
  draft_content_snapshot text,
  -- The final content after the review pass — what gets copied into
  -- subtopic_contents.body on acceptance. Kept distinct from draft_content_snapshot so
  -- "what did compliance/specificity actually change" is reconstructable from the log
  -- alone, without relying on content_compliance_changes rows existing.
  output_snapshot text,

  specificity_score int,
  compliance_status content_compliance_status not null,
  model text not null,
  generation_status content_generation_status not null,
  error_detail text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (content_build_id, subtopic_id, generation_number),
  check (specificity_score is null or specificity_score between 1 and 10)
);

create table subtopic_contents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  content_build_id uuid not null references content_builds(id) on delete cascade,
  -- The real 1:1 relationship (unlike subtopics, this table's cardinality is entirely
  -- inherited — Step 8 never adds/deletes/reorders its own rows, phase6 §0.1).
  -- Cascades on delete: the only physically consistent option for a hard 1:1 FK: when
  -- the parent subtopics row is gone, there is nothing left for this row to describe.
  subtopic_id uuid not null unique references subtopics(id) on delete cascade,

  body text not null default '',
  word_count int not null default 0,
  target_word_min int not null,
  target_word_max int not null,

  content_status content_status not null default 'failed_empty',
  source_generation_id uuid references content_generations(id) on delete set null,

  is_edited boolean not null default false,
  -- True only if the CURRENT body is exactly what the compliance/review pass last
  -- produced. Reset to false on any manual edit (a hand-edit after review can
  -- reintroduce an unreviewed claim) — non-blocking UI flag, not a lock.
  compliance_reviewed boolean not null default false,
  quality_flag content_quality_flag not null default 'clean',

  last_edited_at timestamptz,
  last_edited_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table content_compliance_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  content_generation_id uuid not null references content_generations(id) on delete cascade,
  -- Denormalized direct query path — "show this subtopic's change history" without
  -- joining through the log.
  subtopic_content_id uuid not null references subtopic_contents(id) on delete cascade,

  -- The specific flagged span (a sentence or short passage), NOT the whole document
  -- body — span-level is the only shape that satisfies "plain-English, glance-readable"
  -- (phase6 §5.1). A deep ebook chapter can be 2,000 words; nobody wants a full-body diff.
  original_text text not null,
  rewritten_text text not null,
  reason text not null,
  risk_category content_risk_category not null,
  detected_by content_change_detector not null,

  created_at timestamptz not null default now()
);

create index idx_content_builds_workspace on content_builds (workspace_id);
create index idx_content_generations_workspace on content_generations (workspace_id);
create index idx_content_generations_build on content_generations (content_build_id);
create index idx_content_generations_subtopic on content_generations (subtopic_id);
create index idx_subtopic_contents_workspace on subtopic_contents (workspace_id);
create index idx_subtopic_contents_build on subtopic_contents (content_build_id);
create index idx_content_compliance_changes_workspace on content_compliance_changes (workspace_id);
create index idx_content_compliance_changes_generation on content_compliance_changes (content_generation_id);
create index idx_content_compliance_changes_content on content_compliance_changes (subtopic_content_id);

-- ============================================================
-- 3. RLS — same no-trigger insight as migration 0005 (status and content live on
--    different tables: content_builds.status vs. subtopic_contents rows), plus one new
--    subtlety: subtopic_contents' DELETE path is exclusively the ON DELETE CASCADE
--    fired by Step 7's deleteSubtopic() removing the parent subtopics row — that
--    cascade runs under the deleting user's own RLS, not a bypass. If DELETE required
--    content_builds.status='draft' (mirroring INSERT/UPDATE), the cascade would fail
--    with an opaque RLS error inside Step 7's code whenever Step 8's content happens to
--    be independently confirmed. DELETE is therefore workspace-gated only — proven by
--    this migration's behavioral test, not assumed.
-- ============================================================

alter table content_builds enable row level security;
alter table content_generations enable row level security;
alter table subtopic_contents enable row level security;
alter table content_compliance_changes enable row level security;

grant select, insert, update on content_builds to authenticated;
grant select, insert on content_generations to authenticated;
grant select, insert, update, delete on subtopic_contents to authenticated;
grant select, insert on content_compliance_changes to authenticated;

create policy content_builds_select on content_builds
  for select using (is_workspace_member(workspace_id));
create policy content_builds_insert on content_builds
  for insert with check (is_workspace_member(workspace_id));
create policy content_builds_update on content_builds
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy content_generations_select on content_generations
  for select using (is_workspace_member(workspace_id));
create policy content_generations_insert on content_generations
  for insert with check (is_workspace_member(workspace_id));

create policy content_compliance_changes_select on content_compliance_changes
  for select using (is_workspace_member(workspace_id));
create policy content_compliance_changes_insert on content_compliance_changes
  for insert with check (is_workspace_member(workspace_id));

-- subtopic_contents: always readable regardless of lock state. Insert/update require
-- BOTH workspace membership AND the parent build currently being 'draft' — the
-- parent-build subquery also checks cb.workspace_id = subtopic_contents.workspace_id,
-- closing the same cross-workspace spoofing hole migration 0005 closed for subtopics.
-- Delete requires ONLY workspace membership (see header note above).
create policy subtopic_contents_select on subtopic_contents
  for select using (is_workspace_member(workspace_id));

create policy subtopic_contents_insert on subtopic_contents
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from content_builds cb
      where cb.id = subtopic_contents.content_build_id
        and cb.workspace_id = subtopic_contents.workspace_id
        and cb.status = 'draft'
    )
  );

create policy subtopic_contents_update on subtopic_contents
  for update
  using (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from content_builds cb
      where cb.id = subtopic_contents.content_build_id
        and cb.workspace_id = subtopic_contents.workspace_id
        and cb.status = 'draft'
    )
  )
  with check (is_workspace_member(workspace_id));

create policy subtopic_contents_delete on subtopic_contents
  for delete using (is_workspace_member(workspace_id));
