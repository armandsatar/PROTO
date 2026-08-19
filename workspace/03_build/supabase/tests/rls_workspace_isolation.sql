-- Behavioral RLS test: two fake users, two workspaces, prove isolation.
-- Verified 2026-08-19 against local Postgres (supabase start / db reset) — see the
-- corresponding entry in phase1-requirements.md / build notes for the full run output.
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/rls_workspace_isolation.sql | \
--     docker exec -i supabase_db_<project-slug> psql -U postgres -d postgres
--
-- Simulates each authenticated user via request.jwt.claims, the same mechanism
-- Supabase's auth.uid() reads from a real GoTrue-issued JWT in production.

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'user-a@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'user-b@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Workspace A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft');

insert into title_ideas (project_id, workspace_id, original_title, rationale, created_by) values
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Notion Budget Tracker for Freelancers', 'Seeing rising search interest, low exact-angle competition on Etsy.', '11111111-1111-1111-1111-111111111111');

\echo '=== FIXTURE STATE (as superuser, bypasses RLS) ==='
select 'projects (all rows, superuser view)' as check, count(*) from projects;
select 'title_ideas (all rows, superuser view)' as check, count(*) from title_ideas;

-- ---------- Test 1: User A (member of Workspace A) queries projects ----------
\echo ''
\echo '=== TEST 1: User A queries projects as authenticated role ==='
set role authenticated;
set request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select 'User A sees N projects (expect 1)' as result, count(*) as row_count from projects;
select 'User A sees this project id' as result, id, workspace_id from projects;

reset role;
reset request.jwt.claims;

-- ---------- Test 2: User B (member of Workspace B, NOT Workspace A) queries same table ----------
\echo ''
\echo '=== TEST 2: User B queries projects as authenticated role (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

select 'User B sees N projects (expect 0)' as result, count(*) as row_count from projects;
select 'User B sees N title_ideas (expect 0)' as result, count(*) as row_count from title_ideas;

reset role;
reset request.jwt.claims;

-- ---------- Test 3: User B attempts to INSERT a project into User A's workspace ----------
\echo ''
\echo '=== TEST 3: User B attempts to INSERT into Workspace A (expect RLS rejection) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

\echo 'Attempting cross-workspace insert (this should fail with a policy violation):'
insert into projects (workspace_id, created_by, status)
values ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'draft');
