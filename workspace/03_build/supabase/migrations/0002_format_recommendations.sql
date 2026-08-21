-- PROTO Phase 2 (Step 4: Format Recommendation)
-- Implements the data model in workspace/01_spec/phase2-requirements.md §1.
-- Single-table design (decision 4) — one row is both the AI/fallback recommendation
-- and, once acted on, the record of what the user confirmed. See §1.2 for the full
-- row-lifecycle this requires: confirm-in-place, supersede-and-copy-forward on
-- "Change Format", supersede-only on Reconsider / title-change invalidation.

-- ============================================================
-- 1. Enums
-- ============================================================

create type format_type as enum ('tracker', 'workbook', 'ebook', 'quiz');
create type delivery_mode as enum ('printable', 'fillable');
create type confidence_level as enum ('high', 'medium', 'low');
create type generation_status as enum ('succeeded', 'failed_fallback', 'failed_blocked');
create type recommendation_status as enum ('active', 'superseded');
create type supersede_reason as enum ('title_changed', 'user_requested_reconsider', 'user_requested_format_change');

-- Extending project_status (migration 0001) with Step 4's two new states. Not used by
-- any DML in this migration file, only by later application code in separate
-- transactions, so the "can't use a new enum value in the same transaction it was
-- added in" Postgres restriction doesn't apply here.
alter type project_status add value 'format_recommending';
alter type project_status add value 'format_selected';

-- ============================================================
-- 2. format_recommendations (single table — §1.2)
-- ============================================================

create table format_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  title_candidate_id uuid not null references title_candidates(id) on delete cascade,

  -- Recommendation fields: set at generation time, never edited after.
  recommended_format format_type not null,
  recommended_delivery_mode delivery_mode,
  confidence confidence_level not null,
  reasoning_summary text not null,
  reasoning_signals jsonb not null,
  alternate_format_considered format_type,
  inputs_snapshot jsonb not null,
  model text not null,
  generation_status generation_status not null,

  -- Confirmation fields: null until the user acts, set once, then immutable
  -- (enforced by the UPDATE policy below, not a CHECK — the "only while null" rule
  -- needs to see the OLD row, which CHECK constraints can't do).
  confirmed_format format_type,
  confirmed_delivery_mode delivery_mode,
  is_override boolean,
  override_reason text,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,

  -- Lifecycle fields
  recommendation_status recommendation_status not null default 'active',
  superseded_at timestamptz,
  superseded_reason supersede_reason,

  created_at timestamptz not null default now(),

  -- Hard business rule (§1.4): ebook never has a delivery mode, confirmed or recommended.
  check (recommended_format <> 'ebook' or recommended_delivery_mode is null),
  check (confirmed_format is null or confirmed_format <> 'ebook' or confirmed_delivery_mode is null)
);

-- Only one active row per project at a time (§1.2's core lifecycle invariant).
create unique index one_active_recommendation_per_project
  on format_recommendations (project_id)
  where recommendation_status = 'active';

create index idx_format_recommendations_workspace on format_recommendations (workspace_id);
create index idx_format_recommendations_project on format_recommendations (project_id);

alter table projects add column current_format_recommendation_id uuid references format_recommendations(id) on delete set null;

-- ============================================================
-- 3. RLS
-- ============================================================

alter table format_recommendations enable row level security;

-- Same GRANT-before-RLS lesson from migration 0001's Increment 2: without this, every
-- policy below is unreachable and queries fail with "permission denied", not the RLS
-- policy's own message. No delete grant — nothing in phase2-requirements.md deletes
-- these rows, history is preserved via superseding, not removal.
grant select, insert, update on format_recommendations to authenticated;

create policy format_recommendations_select on format_recommendations
  for select using (is_workspace_member(workspace_id));

create policy format_recommendations_insert on format_recommendations
  for insert with check (is_workspace_member(workspace_id));

-- RLS deliberately stays coarse here (workspace-gated only) — the fine-grained "set
-- once" rule ("confirmation fields immutable once confirmed_at is set, but
-- recommendation_status can still flip to superseded afterward via Change Format")
-- needs to compare OLD vs NEW column values, which RLS structurally can't do: USING
-- only sees the row being targeted (OLD), WITH CHECK only sees the row post-update
-- (NEW), and neither can reference the other within a single policy expression. A
-- trigger can see both, so that's where this rule actually lives — see below.
create policy format_recommendations_update on format_recommendations
  for update
  using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- The actual "set once" enforcement (§1.2's follow-up note, resolved now rather than
-- deferred further): once confirmed_at is set, none of the confirmation fields may
-- change again. Superseding (recommendation_status/superseded_at/superseded_reason)
-- remains allowed on an already-confirmed row — that's exactly what Change Format does.
create or replace function enforce_format_recommendation_confirm_once()
returns trigger
language plpgsql
as $$
begin
  if old.confirmed_at is not null then
    if new.confirmed_format is distinct from old.confirmed_format
      or new.confirmed_delivery_mode is distinct from old.confirmed_delivery_mode
      or new.is_override is distinct from old.is_override
      or new.override_reason is distinct from old.override_reason
      or new.confirmed_by is distinct from old.confirmed_by
      or new.confirmed_at is distinct from old.confirmed_at
    then
      raise exception 'format_recommendations: confirmation fields are immutable once confirmed_at is set';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_format_recommendations_confirm_once
  before update on format_recommendations
  for each row
  execute function enforce_format_recommendation_confirm_once();
