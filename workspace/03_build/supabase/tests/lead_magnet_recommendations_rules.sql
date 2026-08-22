-- Behavioral test for lead_magnet_recommendations (migration 0003):
-- 1. Workspace isolation holds, same as every other table.
-- 2. The confirm-once trigger rejects re-editing confirmation fields (own instance,
--    same pattern as format_recommendations_rules.sql).
-- 3. Superseding an already-confirmed row (Change) still works.
-- 4. NEW: the recommended_suitable=false -> recommended_type must be null CHECK
--    constraint actually fires (decision 8, enforced at the DB layer this time, not
--    just a guardrail in application code).
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/lead_magnet_recommendations_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('55555555-5555-5555-5555-555555555555', 'user-a-lm@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'user-b-lm@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-3000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Workspace A'),
  ('bbbbbbbb-3000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-3000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'owner'),
  ('bbbbbbbb-3000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-3000-0000-0000-000000000003', 'aaaaaaaa-3000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'format_selected');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('dddddddd-3000-0000-0000-000000000004', 'cccccccc-3000-0000-0000-000000000003', 'aaaaaaaa-3000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('eeeeeeee-3000-0000-0000-000000000005', 'dddddddd-3000-0000-0000-000000000004', 'aaaaaaaa-3000-0000-0000-000000000001', 'cccccccc-3000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'eeeeeeee-3000-0000-0000-000000000005' where id = 'cccccccc-3000-0000-0000-000000000003';

insert into format_recommendations (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status, confirmed_format, confirmed_delivery_mode, is_override, confirmed_by, confirmed_at) values
  ('ffffffff-3000-0000-0000-000000000006', 'aaaaaaaa-3000-0000-0000-000000000001', 'cccccccc-3000-0000-0000-000000000003', 'eeeeeeee-3000-0000-0000-000000000005', 'tracker', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded', 'tracker', 'fillable', false, '55555555-5555-5555-5555-555555555555', now());

update projects set current_format_recommendation_id = 'ffffffff-3000-0000-0000-000000000006' where id = 'cccccccc-3000-0000-0000-000000000003';

-- ---------- Test 1: User A inserts a lead_magnet_recommendations row ----------
\echo '=== TEST 1: User A inserts a lead magnet recommendation (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

insert into lead_magnet_recommendations
  (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, recommended_suitable, recommended_type, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status)
values
  ('11111111-3000-0000-0000-000000000007', 'aaaaaaaa-3000-0000-0000-000000000001', 'cccccccc-3000-0000-0000-000000000003', 'eeeeeeee-3000-0000-0000-000000000005', 'ffffffff-3000-0000-0000-000000000006', true, 'standalone_funnel', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded');

select 'inserted OK' as result;

-- ---------- Test 2: User A confirms it (first time — expect success) ----------
\echo ''
\echo '=== TEST 2: User A confirms (first time, expect success) ==='
update lead_magnet_recommendations
set confirmed_suitable = true, confirmed_type = 'standalone_funnel', is_override = false, confirmed_by = '55555555-5555-5555-5555-555555555555', confirmed_at = now()
where id = '11111111-3000-0000-0000-000000000007';

select 'confirmed_at set' as result, confirmed_at is not null as confirmed from lead_magnet_recommendations where id = '11111111-3000-0000-0000-000000000007';

-- ---------- Test 3: User A tries to re-edit the confirmation (expect REJECTION) ----------
\echo ''
\echo '=== TEST 3: User A attempts a second confirm/edit (expect trigger rejection) ==='
do $$
begin
  update lead_magnet_recommendations set confirmed_type = 'stripped_sample' where id = '11111111-3000-0000-0000-000000000007';
  raise exception 'TEST 3 FAILED: the second confirm/edit was NOT rejected';
exception
  when others then
    if sqlerrm like '%confirmation fields are immutable%' then
      raise notice 'TEST 3 PASSED: correctly rejected — %', sqlerrm;
    else
      raise exception 'TEST 3 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;

-- ---------- Test 4: User A supersedes the confirmed row (Change — expect success) ----------
\echo ''
\echo '=== TEST 4: User A supersedes the confirmed row via Change (expect success) ==='
update lead_magnet_recommendations
set recommendation_status = 'superseded', superseded_at = now(), superseded_reason = 'user_requested_change'
where id = '11111111-3000-0000-0000-000000000007';

select 'superseded OK, confirmation fields untouched' as result, recommendation_status, confirmed_type
from lead_magnet_recommendations where id = '11111111-3000-0000-0000-000000000007';

reset role;
reset request.jwt.claims;

-- ---------- Test 5: User B (different workspace) cannot see User A's recommendation ----------
\echo ''
\echo '=== TEST 5: User B queries lead_magnet_recommendations (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select 'User B sees N recommendations (expect 0)' as result, count(*) as row_count from lead_magnet_recommendations;

-- ---------- Test 6: User B attempts cross-workspace insert (expect RLS rejection) ----------
\echo ''
\echo '=== TEST 6: User B attempts cross-workspace insert (expect RLS rejection) ==='
do $$
begin
  insert into lead_magnet_recommendations
    (workspace_id, project_id, title_candidate_id, format_recommendation_id, recommended_suitable, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status)
  values
    ('aaaaaaaa-3000-0000-0000-000000000001', 'cccccccc-3000-0000-0000-000000000003', 'eeeeeeee-3000-0000-0000-000000000005', 'ffffffff-3000-0000-0000-000000000006', false, 'high', 'x', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded');
  raise exception 'TEST 6 FAILED: cross-workspace insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then
      raise notice 'TEST 6 PASSED: correctly rejected — %', sqlerrm;
    else
      raise exception 'TEST 6 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;

reset role;
reset request.jwt.claims;

-- ---------- Test 7 (superuser): decision 8's CHECK constraint fires at the DB layer ----------
\echo ''
\echo '=== TEST 7: recommended_suitable=false with a non-null recommended_type (expect CHECK violation) ==='
do $$
begin
  insert into lead_magnet_recommendations
    (workspace_id, project_id, title_candidate_id, format_recommendation_id, recommended_suitable, recommended_type, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status)
  values
    ('aaaaaaaa-3000-0000-0000-000000000001', 'cccccccc-3000-0000-0000-000000000003', 'eeeeeeee-3000-0000-0000-000000000005', 'ffffffff-3000-0000-0000-000000000006', false, 'stripped_sample', 'high', 'x', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded');
  raise exception 'TEST 7 FAILED: the CHECK constraint did NOT reject suitable=false with a non-null type';
exception
  when others then
    if sqlerrm like '%violates check constraint%' then
      raise notice 'TEST 7 PASSED: correctly rejected — %', sqlerrm;
    else
      raise exception 'TEST 7 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;
