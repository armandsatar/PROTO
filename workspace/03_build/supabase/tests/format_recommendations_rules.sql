-- Behavioral test for format_recommendations (migration 0002):
-- 1. Workspace isolation holds, same as every other table (title_candidates precedent).
-- 2. The confirm-once trigger actually rejects re-editing confirmation fields.
-- 3. Superseding an already-confirmed row (Change Format) still works — the trigger
--    must allow THAT specific case, not just blanket-reject all updates post-confirm.
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/format_recommendations_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('33333333-3333-3333-3333-333333333333', 'user-a-fmt@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'user-b-fmt@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-2000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Workspace A'),
  ('bbbbbbbb-2000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-2000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'owner'),
  ('bbbbbbbb-2000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-2000-0000-0000-000000000003', 'aaaaaaaa-2000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'title_selected');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('dddddddd-2000-0000-0000-000000000004', 'cccccccc-2000-0000-0000-000000000003', 'aaaaaaaa-2000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('eeeeeeee-2000-0000-0000-000000000005', 'dddddddd-2000-0000-0000-000000000004', 'aaaaaaaa-2000-0000-0000-000000000001', 'cccccccc-2000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'eeeeeeee-2000-0000-0000-000000000005' where id = 'cccccccc-2000-0000-0000-000000000003';

-- ---------- Test 1: User A inserts a format_recommendations row for their own project ----------
\echo '=== TEST 1: User A inserts a recommendation (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

insert into format_recommendations
  (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status)
values
  ('ffffffff-2000-0000-0000-000000000006', 'aaaaaaaa-2000-0000-0000-000000000001', 'cccccccc-2000-0000-0000-000000000003', 'eeeeeeee-2000-0000-0000-000000000005', 'workbook', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded');

select 'inserted OK' as result;

-- ---------- Test 2: User A confirms it (first time — expect success) ----------
\echo ''
\echo '=== TEST 2: User A confirms (first time, expect success) ==='
update format_recommendations
set confirmed_format = 'workbook', confirmed_delivery_mode = 'fillable', is_override = false, confirmed_by = '33333333-3333-3333-3333-333333333333', confirmed_at = now()
where id = 'ffffffff-2000-0000-0000-000000000006';

select 'confirmed_at set' as result, confirmed_at is not null as confirmed from format_recommendations where id = 'ffffffff-2000-0000-0000-000000000006';

-- ---------- Test 3: User A tries to re-edit the confirmation (expect REJECTION by trigger) ----------
-- Wrapped in a DO block so the expected failure doesn't end the script (\set
-- ON_ERROR_STOP would otherwise halt here) — Tests 4-6 still need to run after this.
\echo ''
\echo '=== TEST 3: User A attempts a second confirm/edit (expect trigger rejection) ==='
do $$
begin
  update format_recommendations set confirmed_format = 'tracker' where id = 'ffffffff-2000-0000-0000-000000000006';
  raise exception 'TEST 3 FAILED: the second confirm/edit was NOT rejected — trigger is not enforcing "set once"';
exception
  when others then
    if sqlerrm like '%confirmation fields are immutable%' then
      raise notice 'TEST 3 PASSED: correctly rejected — %', sqlerrm;
    else
      raise exception 'TEST 3 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;

select 'confirmed_format unchanged after rejected edit' as result, confirmed_format from format_recommendations where id = 'ffffffff-2000-0000-0000-000000000006';

-- ---------- Test 4: User A supersedes the now-confirmed row (Change Format — expect success) ----------
\echo ''
\echo '=== TEST 4: User A supersedes the confirmed row via Change Format (expect success) ==='
update format_recommendations
set recommendation_status = 'superseded', superseded_at = now(), superseded_reason = 'user_requested_format_change'
where id = 'ffffffff-2000-0000-0000-000000000006';

select 'superseded OK, confirmation fields untouched' as result, recommendation_status, confirmed_format
from format_recommendations where id = 'ffffffff-2000-0000-0000-000000000006';

reset role;
reset request.jwt.claims;

-- ---------- Test 5: User B (different workspace) cannot see User A's recommendation ----------
\echo ''
\echo '=== TEST 5: User B queries format_recommendations (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select 'User B sees N recommendations (expect 0)' as result, count(*) as row_count from format_recommendations;

-- ---------- Test 6: User B attempts to INSERT into Workspace A's project (expect RLS rejection) ----------
\echo ''
\echo '=== TEST 6: User B attempts cross-workspace insert (expect RLS rejection) ==='
insert into format_recommendations
  (workspace_id, project_id, title_candidate_id, recommended_format, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status)
values
  ('aaaaaaaa-2000-0000-0000-000000000001', 'cccccccc-2000-0000-0000-000000000003', 'eeeeeeee-2000-0000-0000-000000000005', 'ebook', 'high', 'x', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded');
