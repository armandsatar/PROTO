-- PROTO Phase 10 (Step 12: Pricing Recommendation)
-- Implements the data model in workspace/01_spec/phase10-requirements.md §8.
--
-- Pricing is optional/advisory (decision 7): ready_to_download remains Step 11's
-- terminal status. A project can move ready_to_download → pricing_recommending →
-- pricing_confirmed, but ready_to_download is a valid stopping point — pricing is
-- never mandatory.
--
-- Two tables: pricing_recommendations (the formula-computed base recommendation,
-- same recommend/confirm shape as format_recommendations) and
-- pricing_platform_suggestions (4 child rows per recommendation, one per storefront
-- platform, each with an independently confirmable/overridable suggested price).

-- ============================================================
-- 1. Enums
-- ============================================================

-- generation_status, recommendation_status: reused verbatim from migration 0002.
-- copy_platform: reused from migration 0008 — only the 4 storefront values are used
-- here (etsy, gumroad, stanstore, whop), enforced via CHECK constraint on the child
-- table, not a new enum.

create type pricing_supersede_reason as enum (
  'title_changed',
  'format_changed',
  'export_changed',
  'user_requested_reconsider',
  'user_requested_change'
);

alter type project_status add value 'pricing_recommending';
alter type project_status add value 'pricing_confirmed';

-- ============================================================
-- 2. Tables
-- ============================================================

create table pricing_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,

  -- Staleness snapshot FKs (§7.2) — 3 dependencies, not just 1 like Step 4
  title_candidate_id uuid not null references title_candidates(id) on delete cascade,
  format_recommendation_id uuid not null references format_recommendations(id),
  export_page_count_snapshot int not null,

  -- Formula outputs (§4.2) — stored for transparency/debugging
  recommended_price numeric(10,2) not null,
  base_price numeric(10,2) not null,
  comparable_count int not null,
  demand_competition_multiplier numeric(4,2) not null,
  depth_adjustment numeric(10,2) not null,

  -- AI reasoning (§4.3) — explains the formula's output in natural language
  reasoning_summary text not null,
  reasoning_signals jsonb not null,
  inputs_snapshot jsonb not null,
  model text not null,

  -- Reused from migration 0002 — same 3-value outcome set
  generation_status generation_status not null,

  -- Confirmation fields: null until the user acts
  confirmed_price numeric(10,2),
  is_override boolean,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,

  -- Reused from migration 0002
  recommendation_status recommendation_status not null default 'active',
  superseded_at timestamptz,
  superseded_reason pricing_supersede_reason,

  created_at timestamptz not null default now()
);

alter table projects add column current_pricing_recommendation_id uuid
  references pricing_recommendations(id) on delete set null;

create table pricing_platform_suggestions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  pricing_recommendation_id uuid not null references pricing_recommendations(id) on delete cascade,

  -- Reuses copy_platform enum from migration 0008 — only the 4 storefront values
  platform copy_platform not null,
  -- CHECK: only the 4 pricing-relevant platforms, not pinterest/instagram/narrative
  constraint pricing_platform_storefronts_only
    check (platform in ('etsy', 'gumroad', 'stanstore', 'whop')),

  platform_multiplier numeric(4,2) not null,
  suggested_price numeric(10,2) not null,

  -- Confirmation: independently confirmable per platform
  confirmed_price numeric(10,2),
  is_override boolean,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,

  created_at timestamptz not null default now(),

  unique (pricing_recommendation_id, platform)
);

-- ============================================================
-- 3. Indexes
-- ============================================================

create index idx_pricing_recommendations_workspace on pricing_recommendations (workspace_id);
create index idx_pricing_recommendations_project on pricing_recommendations (project_id);
create index idx_pricing_platform_suggestions_workspace on pricing_platform_suggestions (workspace_id);
create index idx_pricing_platform_suggestions_recommendation on pricing_platform_suggestions (pricing_recommendation_id);

-- ============================================================
-- 4. RLS — same parent-workspace-check pattern as every prior migration
-- ============================================================

alter table pricing_recommendations enable row level security;
alter table pricing_platform_suggestions enable row level security;

grant select, insert, update on pricing_recommendations to authenticated;
grant select, insert, update on pricing_platform_suggestions to authenticated;

create policy pricing_recommendations_select on pricing_recommendations
  for select using (is_workspace_member(workspace_id));
create policy pricing_recommendations_insert on pricing_recommendations
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from projects p where p.id = pricing_recommendations.project_id and p.workspace_id = pricing_recommendations.workspace_id)
  );
create policy pricing_recommendations_update on pricing_recommendations
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy pricing_platform_suggestions_select on pricing_platform_suggestions
  for select using (is_workspace_member(workspace_id));
create policy pricing_platform_suggestions_insert on pricing_platform_suggestions
  for insert with check (
    is_workspace_member(workspace_id)
    and exists (select 1 from pricing_recommendations pr where pr.id = pricing_platform_suggestions.pricing_recommendation_id and pr.workspace_id = pricing_platform_suggestions.workspace_id)
  );
create policy pricing_platform_suggestions_update on pricing_platform_suggestions
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));
