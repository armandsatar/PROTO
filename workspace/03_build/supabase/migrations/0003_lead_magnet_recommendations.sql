-- PROTO Phase 3 (Step 5: Lead Magnet Check)
-- Implements the data model in workspace/01_spec/phase3-requirements.md §1.
-- Same single-table pattern as format_recommendations (migration 0002): one row is
-- both the AI/fallback recommendation and, once acted on, the confirmed choice.
-- New vs. migration 0002: two upstream snapshots (title_candidate_id AND
-- format_recommendation_id — decision 9), since this step depends on both Step 2/3's
-- title and Step 4's *confirmed* format.

-- ============================================================
-- 1. Enums (confidence_level, generation_status, recommendation_status reused as-is
--    from migration 0002 — decision 16, no new types needed)
-- ============================================================

create type lead_magnet_type as enum ('stripped_sample', 'standalone_funnel');
create type lm_supersede_reason as enum ('title_changed', 'format_changed', 'user_requested_reconsider', 'user_requested_change');

alter type project_status add value 'lead_magnet_checking';
alter type project_status add value 'lead_magnet_reviewed';

-- ============================================================
-- 2. lead_magnet_recommendations
-- ============================================================

create table lead_magnet_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id) on delete cascade,

  -- Recommendation fields: set at generation time, never edited after.
  recommended_suitable boolean not null,
  recommended_type lead_magnet_type,
  confidence confidence_level not null,
  reasoning_summary text not null,
  reasoning_signals jsonb not null,
  alternate_type_considered lead_magnet_type,
  inputs_snapshot jsonb not null,
  model text not null,
  generation_status generation_status not null,

  -- Confirmation fields: null until the user acts, set once, then immutable (trigger below).
  confirmed_suitable boolean,
  confirmed_type lead_magnet_type,
  is_override boolean,
  override_reason text,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,

  -- Lifecycle fields
  recommendation_status recommendation_status not null default 'active',
  superseded_at timestamptz,
  superseded_reason lm_supersede_reason,

  created_at timestamptz not null default now(),

  -- Decision 8: not-suitable forces both type fields to null. IS DISTINCT FROM makes
  -- these null-safe for unconfirmed rows (confirmed_suitable starts null) — see
  -- migration comments below each check for the truth-table reasoning.
  check (recommended_suitable = true or recommended_type is null),
  check (recommended_suitable = true or alternate_type_considered is null),
  -- confirmed_suitable=false -> confirmed_type must be null; null/true -> unconstrained here
  check (confirmed_suitable is distinct from false or confirmed_type is null),
  -- confirmed_suitable=true -> confirmed_type must be set; null/false -> unconstrained here
  check (confirmed_suitable is distinct from true or confirmed_type is not null)
);

create unique index one_active_lead_magnet_recommendation_per_project
  on lead_magnet_recommendations (project_id)
  where recommendation_status = 'active';

create index idx_lead_magnet_recommendations_workspace on lead_magnet_recommendations (workspace_id);
create index idx_lead_magnet_recommendations_project on lead_magnet_recommendations (project_id);

alter table projects add column current_lead_magnet_recommendation_id uuid references lead_magnet_recommendations(id) on delete set null;

-- ============================================================
-- 3. RLS (same shape as migration 0002 — GRANT before RLS, coarse workspace-gated
--    policies, fine-grained "set once" rule lives in a trigger, not RLS)
-- ============================================================

alter table lead_magnet_recommendations enable row level security;

grant select, insert, update on lead_magnet_recommendations to authenticated;

create policy lead_magnet_recommendations_select on lead_magnet_recommendations
  for select using (is_workspace_member(workspace_id));

create policy lead_magnet_recommendations_insert on lead_magnet_recommendations
  for insert with check (is_workspace_member(workspace_id));

create policy lead_magnet_recommendations_update on lead_magnet_recommendations
  for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- Same "set once" rule as trg_format_recommendations_confirm_once (migration 0002),
-- own instance for this table's field names.
create or replace function enforce_lead_magnet_recommendation_confirm_once()
returns trigger
language plpgsql
as $$
begin
  if old.confirmed_at is not null then
    if new.confirmed_suitable is distinct from old.confirmed_suitable
      or new.confirmed_type is distinct from old.confirmed_type
      or new.is_override is distinct from old.is_override
      or new.override_reason is distinct from old.override_reason
      or new.confirmed_by is distinct from old.confirmed_by
      or new.confirmed_at is distinct from old.confirmed_at
    then
      raise exception 'lead_magnet_recommendations: confirmation fields are immutable once confirmed_at is set';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_lead_magnet_recommendations_confirm_once
  before update on lead_magnet_recommendations
  for each row
  execute function enforce_lead_magnet_recommendation_confirm_once();
