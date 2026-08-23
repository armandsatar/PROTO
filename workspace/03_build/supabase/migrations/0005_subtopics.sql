-- PROTO Phase 5 (Step 7: Subtopic Generation)
-- Implements the data model in workspace/01_spec/phase5-requirements.md §1.
-- A fourth data shape: a live, mutable, variable-length, reorderable COLLECTION, not a
-- single recommendation row (migrations 0002/0003) and not a single editable content
-- row (migration 0004). Three tables: subtopic_generations (append-only log),
-- subtopic_lists (1:1 header/status/staleness-snapshot record, holds no subtopic
-- content itself), subtopics (1:many, the live collection Step 8 will eventually read).

-- ============================================================
-- 1. Enums (transformation_map_status reused for subtopic_lists.status — decision 17)
-- ============================================================

create type subtopic_depth as enum ('shallow', 'medium', 'deep');
create type subtopic_source as enum ('ai_generated', 'manual', 'ai_regenerated');
create type subtopic_generation_type as enum ('full_list', 'single_item');
-- Adds succeeded_below_target vs. the 3-value precedent set (decision 9) — a genuinely
-- new outcome only a variable-length list can hit: the call succeeded, but produced
-- fewer items than the target range, and nothing force-pads it with fabricated content.
create type subtopic_generation_status as enum ('succeeded', 'succeeded_below_target', 'failed_fallback', 'failed_blocked');

alter type project_status add value 'subtopic_generating';
alter type project_status add value 'subtopics_confirmed';

-- ============================================================
-- 2. Tables — circular FK (subtopic_lists <-> subtopic_generations <-> subtopics)
--    resolved the same way migration 0001 resolved projects <-> research_runs:
--    nullable columns first, ALTER TABLE ADD CONSTRAINT once all three tables exist.
-- ============================================================

create table subtopic_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null unique references projects(id) on delete cascade,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  transformation_map_snapshot_at timestamptz not null,

  confirmed_format format_type not null,
  target_count_min int not null,
  target_count_max int not null,

  status transformation_map_status not null default 'draft',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),

  regenerate_count int not null default 0,
  -- FK added below via ALTER TABLE, once subtopic_generations exists (circular reference)
  current_generation_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table subtopic_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  subtopic_list_id uuid not null references subtopic_lists(id) on delete cascade,

  -- Increments across ALL rows for this list, both full_list and single_item attempts
  -- (a single unambiguous sequence, NOT NULL for every row) — "Attempt N of 5" display
  -- filters this by generation_type='full_list' rather than needing a second counter.
  generation_number int not null,
  generation_type subtopic_generation_type not null,
  -- FK added below via ALTER TABLE, once subtopics exists (circular reference). Set
  -- only when generation_type='single_item'.
  target_subtopic_id uuid,

  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  transformation_map_snapshot_at timestamptz not null,

  inputs_snapshot jsonb not null,
  output_snapshot jsonb,
  model text not null,
  generation_status subtopic_generation_status not null,
  error_detail text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (subtopic_list_id, generation_number)
);

create table subtopics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  subtopic_list_id uuid not null references subtopic_lists(id) on delete cascade,

  title text not null,
  description text not null,
  display_order int not null,
  depth subtopic_depth not null,
  source subtopic_source not null,
  source_generation_id uuid references subtopic_generations(id),

  is_edited boolean not null default false,
  last_edited_at timestamptz,
  last_edited_by uuid references auth.users(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (subtopic_list_id, display_order)
);

alter table subtopic_generations
  add constraint subtopic_generations_target_subtopic_fk
    foreign key (target_subtopic_id) references subtopics(id) on delete set null;

alter table subtopic_lists
  add constraint subtopic_lists_current_generation_fk
    foreign key (current_generation_id) references subtopic_generations(id) on delete set null;

create index idx_subtopic_lists_workspace on subtopic_lists (workspace_id);
create index idx_subtopic_generations_workspace on subtopic_generations (workspace_id);
create index idx_subtopic_generations_list on subtopic_generations (subtopic_list_id);
create index idx_subtopics_workspace on subtopics (workspace_id);
create index idx_subtopics_list on subtopics (subtopic_list_id);

-- ============================================================
-- 3. RLS — no new trigger needed. Every prior confirm/unlock lock (migrations
--    0002/0003/0004) needed a trigger because status and content lived on the SAME
--    row (an OLD-vs-NEW comparison RLS can't do). Here status lives on subtopic_lists
--    and content lives on subtopics — "is this row locked" is answerable by a plain
--    RLS subquery against the parent, the same subquery SHAPE is_workspace_member()
--    already uses, just checking a different column. Proven by this migration's
--    behavioral test, not assumed from the design alone.
-- ============================================================

alter table subtopic_lists enable row level security;
alter table subtopic_generations enable row level security;
alter table subtopics enable row level security;

grant select, insert on subtopic_generations to authenticated;
grant select, insert, update on subtopic_lists to authenticated;
grant select, insert, update, delete on subtopics to authenticated;

create policy subtopic_lists_select on subtopic_lists
  for select using (is_workspace_member(workspace_id));
create policy subtopic_lists_insert on subtopic_lists
  for insert with check (is_workspace_member(workspace_id));
create policy subtopic_lists_update on subtopic_lists
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy subtopic_generations_select on subtopic_generations
  for select using (is_workspace_member(workspace_id));
create policy subtopic_generations_insert on subtopic_generations
  for insert with check (is_workspace_member(workspace_id));

-- subtopics: always readable regardless of lock state; insert/update/delete require
-- BOTH workspace membership AND the parent list currently being 'draft'. The parent-list
-- subquery also checks sl.workspace_id = subtopics.workspace_id, closing a real
-- cross-workspace spoofing hole (claiming your own workspace_id on the row while
-- pointing subtopic_list_id at a different workspace's list).
create policy subtopics_select on subtopics
  for select using (is_workspace_member(workspace_id));

create policy subtopics_insert on subtopics
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from subtopic_lists sl
      where sl.id = subtopics.subtopic_list_id
        and sl.workspace_id = subtopics.workspace_id
        and sl.status = 'draft'
    )
  );

create policy subtopics_update on subtopics
  for update
  using (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from subtopic_lists sl
      where sl.id = subtopics.subtopic_list_id
        and sl.workspace_id = subtopics.workspace_id
        and sl.status = 'draft'
    )
  )
  with check (is_workspace_member(workspace_id));

create policy subtopics_delete on subtopics
  for delete using (
    is_workspace_member(workspace_id)
    and exists (
      select 1 from subtopic_lists sl
      where sl.id = subtopics.subtopic_list_id
        and sl.workspace_id = subtopics.workspace_id
        and sl.status = 'draft'
    )
  );
