-- PROTO Phase 4 (Step 6: Visceral Transformation Map)
-- Implements the data model in workspace/01_spec/phase4-requirements.md §1.
-- Different shape from migrations 0002/0003: this is editable-content-shaped (decision
-- 1), not recommend/confirm-shaped. Two tables with genuinely different roles:
-- transformation_map_generations is a pure insert-only audit log (no update path at
-- all — the AI call always resolves before the row is ever inserted, so there's no
-- pending->completed transition to track, unlike research_runs in migration 0001);
-- transformation_maps is the live, directly-editable 1:1 record.

-- ============================================================
-- 1. Enums (generation_status reused as-is from migration 0002 — no new type)
-- ============================================================

create type transformation_map_status as enum ('draft', 'confirmed');

alter type project_status add value 'transformation_mapping';
alter type project_status add value 'transformation_map_confirmed';

-- ============================================================
-- 2. transformation_map_generations — insert-only audit log
-- ============================================================

create table transformation_map_generations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  generation_number int not null,
  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  inputs_snapshot jsonb not null,

  headline_before text,
  headline_after text,
  dim_emotional_before text,
  dim_emotional_after text,
  dim_practical_before text,
  dim_practical_after text,
  dim_identity_before text,
  dim_identity_after text,
  dim_pain_point_before text,
  dim_pain_point_after text,

  model text not null,
  generation_status generation_status not null,
  error_detail text,

  created_at timestamptz not null default now(),
  completed_at timestamptz,

  unique (project_id, generation_number)
);

create index idx_transformation_map_generations_workspace on transformation_map_generations (workspace_id);
create index idx_transformation_map_generations_project on transformation_map_generations (project_id);

-- ============================================================
-- 3. transformation_maps — live, editable, 1:1 with projects
-- ============================================================

create table transformation_maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null unique references projects(id) on delete cascade,
  source_generation_id uuid not null references transformation_map_generations(id),
  title_candidate_id uuid not null references title_candidates(id) on delete cascade,

  headline_before text not null,
  headline_after text not null,
  dim_emotional_before text not null,
  dim_emotional_after text not null,
  dim_practical_before text not null,
  dim_practical_after text not null,
  dim_identity_before text not null,
  dim_identity_after text not null,
  dim_pain_point_before text not null,
  dim_pain_point_after text not null,

  is_edited boolean not null default false,
  last_edited_at timestamptz,
  last_edited_by uuid references auth.users(id),

  status transformation_map_status not null default 'draft',
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),

  regenerate_count int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_transformation_maps_workspace on transformation_maps (workspace_id);

alter table projects add column current_transformation_map_generation_id uuid references transformation_map_generations(id) on delete set null;

-- ============================================================
-- 4. RLS
-- ============================================================

alter table transformation_map_generations enable row level security;
alter table transformation_maps enable row level security;

-- Generations: select + insert only. No update grant at all — this table is
-- append-only by construction, simpler than every prior generation-log table.
grant select, insert on transformation_map_generations to authenticated;
grant select, insert, update on transformation_maps to authenticated;

create policy transformation_map_generations_select on transformation_map_generations
  for select using (is_workspace_member(workspace_id));
create policy transformation_map_generations_insert on transformation_map_generations
  for insert with check (is_workspace_member(workspace_id));

create policy transformation_maps_select on transformation_maps
  for select using (is_workspace_member(workspace_id));
create policy transformation_maps_insert on transformation_maps
  for insert with check (is_workspace_member(workspace_id));
create policy transformation_maps_update on transformation_maps
  for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- RLS stays coarse (workspace-gated only) — the fine-grained "no editing content
-- fields while staying confirmed, but the confirm/unlock transitions themselves are
-- always allowed" rule needs OLD-vs-NEW comparison, same family of problem solved by
-- the confirm-once triggers in migrations 0002/0003. A transition INTO or OUT OF
-- 'confirmed' always passes; only "stayed confirmed AND content changed" is blocked.
create or replace function enforce_transformation_map_content_lock()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'confirmed' and new.status = 'confirmed' then
    if new.headline_before is distinct from old.headline_before
      or new.headline_after is distinct from old.headline_after
      or new.dim_emotional_before is distinct from old.dim_emotional_before
      or new.dim_emotional_after is distinct from old.dim_emotional_after
      or new.dim_practical_before is distinct from old.dim_practical_before
      or new.dim_practical_after is distinct from old.dim_practical_after
      or new.dim_identity_before is distinct from old.dim_identity_before
      or new.dim_identity_after is distinct from old.dim_identity_after
      or new.dim_pain_point_before is distinct from old.dim_pain_point_before
      or new.dim_pain_point_after is distinct from old.dim_pain_point_after
    then
      raise exception 'transformation_maps: content fields are locked while status is confirmed — unlock first';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_transformation_maps_content_lock
  before update on transformation_maps
  for each row
  execute function enforce_transformation_map_content_lock();
