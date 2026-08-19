-- PROTO Phase 1 (Steps 1-3: Input, Title Research & Scoring, Selection)
-- Implements the data model in workspace/01_spec/phase1-requirements.md §1.
-- RLS is the sole access-control mechanism per spec §2 ("RLS not hand-written auth checks").

create extension if not exists "pgcrypto";

-- ============================================================
-- 1. Multi-tenancy scaffolding (§1.1)
-- ============================================================

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  name text not null,
  created_at timestamptz not null default now()
);

create type workspace_role as enum ('owner', 'member');

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role workspace_role not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ============================================================
-- 2. Core entities (§1.2)
-- ============================================================

create type project_status as enum ('draft', 'researching', 'title_selected');

create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  status project_status not null default 'draft',
  -- FKs added below via ALTER TABLE, once research_runs/title_candidates exist (circular reference)
  current_research_run_id uuid,
  selected_candidate_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table title_ideas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  original_title text not null,
  rationale text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type research_run_status as enum ('pending', 'completed', 'partial', 'failed');

create table research_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_number int not null,
  idea_title_snapshot text not null,
  idea_rationale_snapshot text not null,
  ai_connector_used text not null,
  status research_run_status not null default 'pending',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_detail text,
  unique (project_id, run_number)
);

create type generation_axis as enum ('original', 'niche_down', 'format_hint', 'keyword_optimized');
create type score_color as enum ('green', 'amber', 'red');

create table title_candidates (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null references research_runs(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  candidate_text text not null,
  is_original boolean not null default false,
  generation_axis generation_axis not null,
  demand_score smallint not null check (demand_score between 1 and 10),
  demand_color score_color not null,
  demand_signal_detail jsonb not null,
  competition_score smallint not null check (competition_score between 1 and 10),
  competition_color score_color not null,
  competition_signal_detail jsonb not null,
  display_order smallint not null check (display_order between 1 and 4),
  created_at timestamptz not null default now(),
  unique (research_run_id, display_order),
  check (
    (demand_score >= 7 and demand_color = 'green') or
    (demand_score between 5 and 6 and demand_color = 'amber') or
    (demand_score <= 4 and demand_color = 'red')
  ),
  check (
    (competition_score >= 7 and competition_color = 'green') or
    (competition_score between 5 and 6 and competition_color = 'amber') or
    (competition_score <= 4 and competition_color = 'red')
  )
);

create unique index one_original_per_run on title_candidates (research_run_id) where is_original;

create table title_selections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  research_run_id uuid not null references research_runs(id) on delete cascade,
  selected_candidate_id uuid not null references title_candidates(id) on delete cascade,
  selected_by uuid not null references auth.users(id),
  selected_at timestamptz not null default now()
);

alter table projects
  add constraint projects_current_research_run_fk
    foreign key (current_research_run_id) references research_runs(id) on delete set null,
  add constraint projects_selected_candidate_fk
    foreign key (selected_candidate_id) references title_candidates(id) on delete set null;

create index idx_projects_workspace on projects (workspace_id);
create index idx_title_ideas_workspace on title_ideas (workspace_id);
create index idx_research_runs_workspace on research_runs (workspace_id);
create index idx_research_runs_project on research_runs (project_id);
create index idx_title_candidates_workspace on title_candidates (workspace_id);
create index idx_title_candidates_run on title_candidates (research_run_id);
create index idx_title_selections_workspace on title_selections (workspace_id);
create index idx_title_selections_project on title_selections (project_id);

-- ============================================================
-- 3. Row-Level Security (§2 architecture principle: RLS, not hand-written checks)
-- ============================================================

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table title_ideas enable row level security;
alter table research_runs enable row level security;
alter table title_candidates enable row level security;
alter table title_selections enable row level security;

create or replace function is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

-- RLS policies alone are not sufficient: Postgres checks table-level GRANTs before
-- evaluating RLS at all, and Supabase's `authenticated` role has no privileges on a
-- freshly created table by default. Without these grants every policy above is
-- unreachable and every query fails with "permission denied for table X" regardless
-- of what the policies say. Grants are scoped to match each table's documented
-- mutability in §1.2: title_candidates/title_selections are insert+select only
-- (no update/delete grant at all, on top of having no such policies either).
grant usage on schema public to authenticated;

grant select, insert, update on workspaces to authenticated;
grant select, insert on workspace_members to authenticated;
grant select, insert, update on projects to authenticated;
grant select, insert, update on title_ideas to authenticated;
grant select, insert, update on research_runs to authenticated;
grant select, insert on title_candidates to authenticated;
grant select, insert on title_selections to authenticated;

create policy workspaces_select on workspaces
  for select using (is_workspace_member(id));
create policy workspaces_insert on workspaces
  for insert with check (owner_user_id = auth.uid());
create policy workspaces_update on workspaces
  for update using (is_workspace_member(id)) with check (is_workspace_member(id));

create policy workspace_members_select on workspace_members
  for select using (is_workspace_member(workspace_id));
create policy workspace_members_insert on workspace_members
  for insert with check (
    is_workspace_member(workspace_id)
    or (
      user_id = auth.uid()
      and exists (select 1 from workspaces w where w.id = workspace_id and w.owner_user_id = auth.uid())
    )
  );

create policy projects_select on projects
  for select using (is_workspace_member(workspace_id));
create policy projects_insert on projects
  for insert with check (is_workspace_member(workspace_id));
create policy projects_update on projects
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy title_ideas_select on title_ideas
  for select using (is_workspace_member(workspace_id));
create policy title_ideas_insert on title_ideas
  for insert with check (is_workspace_member(workspace_id));
create policy title_ideas_update on title_ideas
  for update using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id));

create policy research_runs_select on research_runs
  for select using (is_workspace_member(workspace_id));
create policy research_runs_insert on research_runs
  for insert with check (is_workspace_member(workspace_id));
create policy research_runs_update on research_runs
  for update
  using (is_workspace_member(workspace_id) and status = 'pending')
  with check (is_workspace_member(workspace_id));

create policy title_candidates_select on title_candidates
  for select using (is_workspace_member(workspace_id));
create policy title_candidates_insert on title_candidates
  for insert with check (is_workspace_member(workspace_id));

create policy title_selections_select on title_selections
  for select using (is_workspace_member(workspace_id));
create policy title_selections_insert on title_selections
  for insert with check (is_workspace_member(workspace_id));
