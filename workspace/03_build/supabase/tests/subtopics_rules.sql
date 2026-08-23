-- Behavioral test for subtopic_lists / subtopic_generations / subtopics (migration 0005):
-- 1. Workspace isolation holds, same as every other table.
-- 2. subtopic_generations is insert-only (no update grant), same as prior generation logs.
-- 3. THE KEY NEW CLAIM: subtopics insert/update/delete are locked once the PARENT
--    subtopic_lists row is confirmed, via a plain RLS subquery — no trigger needed,
--    because status (on subtopic_lists) and content (on subtopics) live on different
--    rows, unlike migrations 0002/0003/0004's same-row confirm-once problem.
-- 4. A specific cross-workspace spoofing case: inserting a subtopics row with your own
--    (valid) workspace_id but pointing subtopic_list_id at a DIFFERENT workspace's list
--    — this must be rejected by the sl.workspace_id = subtopics.workspace_id check,
--    not just is_workspace_member() (which would pass on its own, since the workspace_id
--    on the row itself is genuinely yours).
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/subtopics_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('99999999-9999-9999-9999-999999999991', 'user-a-st@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('99999999-9999-9999-9999-999999999992', 'user-b-st@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-5000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999991', 'Workspace A'),
  ('bbbbbbbb-5000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999992', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-5000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999991', 'owner'),
  ('bbbbbbbb-5000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999992', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-5000-0000-0000-000000000003', 'aaaaaaaa-5000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999991', 'transformation_map_confirmed');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('dddddddd-5000-0000-0000-000000000004', 'cccccccc-5000-0000-0000-000000000003', 'aaaaaaaa-5000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('eeeeeeee-5000-0000-0000-000000000005', 'dddddddd-5000-0000-0000-000000000004', 'aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'eeeeeeee-5000-0000-0000-000000000005' where id = 'cccccccc-5000-0000-0000-000000000003';

insert into format_recommendations (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status, confirmed_format, confirmed_delivery_mode, is_override, confirmed_by, confirmed_at) values
  ('ffffffff-5000-0000-0000-000000000006', 'aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', 'eeeeeeee-5000-0000-0000-000000000005', 'tracker', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded', 'tracker', 'fillable', false, '99999999-9999-9999-9999-999999999991', now());

update projects set current_format_recommendation_id = 'ffffffff-5000-0000-0000-000000000006' where id = 'cccccccc-5000-0000-0000-000000000003';

-- ---------- Test 1: User A inserts subtopic_lists ----------
\echo '=== TEST 1: User A inserts subtopic_lists (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated"}';

insert into subtopic_lists
  (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, confirmed_format, target_count_min, target_count_max)
values
  ('11111111-5000-0000-0000-000000000007', 'aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', 'eeeeeeee-5000-0000-0000-000000000005', 'ffffffff-5000-0000-0000-000000000006', now(), 'tracker', 5, 8);

select 'list inserted OK, status' as result, status from subtopic_lists where id = '11111111-5000-0000-0000-000000000007';

-- ---------- Test 2: User A inserts a generation row ----------
\echo ''
\echo '=== TEST 2: User A inserts subtopic_generations (expect success) ==='
insert into subtopic_generations
  (id, workspace_id, project_id, subtopic_list_id, generation_number, generation_type, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, inputs_snapshot, output_snapshot, model, generation_status, completed_at)
values
  ('22222222-5000-0000-0000-000000000008', 'aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000007', 1, 'full_list', 'eeeeeeee-5000-0000-0000-000000000005', 'ffffffff-5000-0000-0000-000000000006', now(), '{}', '[]', 'openai/gpt-oss-120b', 'succeeded', now());

select 'generation inserted OK' as result;

-- ---------- Test 3: User A inserts subtopics while draft ----------
\echo ''
\echo '=== TEST 3: User A inserts 2 subtopics while draft (expect success) ==='
insert into subtopics (id, workspace_id, project_id, subtopic_list_id, title, description, display_order, depth, source, source_generation_id) values
  ('33333333-5000-0000-0000-000000000009', 'aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000007', 'Setting Up Your Weekly Budget', 'Covers the baseline setup.', 1, 'medium', 'ai_generated', '22222222-5000-0000-0000-000000000008'),
  ('44444444-5000-0000-0000-00000000000a', 'aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000007', 'Automating Bill Reminders', 'Covers recurring bill tracking.', 2, 'shallow', 'ai_generated', '22222222-5000-0000-0000-000000000008');

select 'subtopics inserted OK, count' as result, count(*) from subtopics where subtopic_list_id = '11111111-5000-0000-0000-000000000007';

-- ---------- Test 4: edit + delete while draft ----------
\echo ''
\echo '=== TEST 4: User A edits and deletes a subtopic while draft (expect success) ==='
update subtopics set title = 'Setting Up Your Weekly Budget Foundation', is_edited = true where id = '33333333-5000-0000-0000-000000000009';
delete from subtopics where id = '44444444-5000-0000-0000-00000000000a';
select 'edit+delete OK, remaining count' as result, count(*) from subtopics where subtopic_list_id = '11111111-5000-0000-0000-000000000007';

-- ---------- Test 5: confirm the list ----------
\echo ''
\echo '=== TEST 5: User A confirms the list (expect success) ==='
update subtopic_lists set status = 'confirmed', confirmed_at = now(), confirmed_by = '99999999-9999-9999-9999-999999999991' where id = '11111111-5000-0000-0000-000000000007';
select 'confirmed OK' as result, status from subtopic_lists where id = '11111111-5000-0000-0000-000000000007';

-- ---------- Test 6: insert/update/delete on subtopics all rejected while confirmed ----------
\echo ''
\echo '=== TEST 6: insert/update/delete on subtopics all rejected while list is confirmed (no trigger, RLS subquery only) ==='
do $$
begin
  insert into subtopics (workspace_id, project_id, subtopic_list_id, title, description, display_order, depth, source)
  values ('aaaaaaaa-5000-0000-0000-000000000001', 'cccccccc-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000007', 'Sneaky Insert', 'x', 3, 'medium', 'manual');
  raise exception 'TEST 6a FAILED: insert while confirmed was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 6a PASSED (insert rejected) — %', sqlerrm;
    else raise exception 'TEST 6a FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- NOTE: unlike INSERT (whose WITH CHECK failure raises a real exception), a blocked
-- UPDATE's USING clause just filters the row out of the match silently — Postgres
-- reports "UPDATE 0" and no error. So this is checked by row-state comparison, not
-- exception-catching (same reasoning already applied to the DELETE case below).
update subtopics set title = 'Sneaky Edit' where id = '33333333-5000-0000-0000-000000000009';
select
  case when title = 'Setting Up Your Weekly Budget Foundation' then 'TEST 6b PASSED (update silently blocked, title unchanged)'
       else 'TEST 6b FAILED: title = ' || title
  end as result
from subtopics where id = '33333333-5000-0000-0000-000000000009';

-- Same silent-block reasoning as 6b: a DELETE blocked by RLS's USING clause reports
-- "DELETE 0" with no error, it does not raise — checked by row survival, not exception.
delete from subtopics where id = '33333333-5000-0000-0000-000000000009';
select
  case when count(*) = 1 then 'TEST 6c PASSED (delete silently blocked, row still present)'
       else 'TEST 6c FAILED: row count = ' || count(*)
  end as result
from subtopics where id = '33333333-5000-0000-0000-000000000009';

-- ---------- Test 7: unlock, then the same edit succeeds ----------
\echo ''
\echo '=== TEST 7: User A unlocks, then the same edit succeeds (lock is reversible) ==='
update subtopic_lists set status = 'draft', confirmed_at = null, confirmed_by = null where id = '11111111-5000-0000-0000-000000000007';
update subtopics set title = 'Now Editable Again' where id = '33333333-5000-0000-0000-000000000009';
select 'post-unlock edit OK' as result, title from subtopics where id = '33333333-5000-0000-0000-000000000009';

reset role;
reset request.jwt.claims;

-- ---------- Test 8: User B isolation ----------
\echo ''
\echo '=== TEST 8: User B queries all three tables (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999992","role":"authenticated"}';

select 'lists' as t, count(*) from subtopic_lists
union all select 'generations', count(*) from subtopic_generations
union all select 'subtopics', count(*) from subtopics;

-- ---------- Test 9: cross-workspace spoofing — own workspace_id, foreign subtopic_list_id ----------
\echo ''
\echo '=== TEST 9: User B inserts a subtopic with workspace_id=B but subtopic_list_id pointing at Workspace A''s list (expect rejection via the workspace-match check) ==='
do $$
begin
  insert into subtopics (workspace_id, project_id, subtopic_list_id, title, description, display_order, depth, source)
  values ('bbbbbbbb-5000-0000-0000-000000000002', 'cccccccc-5000-0000-0000-000000000003', '11111111-5000-0000-0000-000000000007', 'Spoofed Insert', 'x', 99, 'medium', 'manual');
  raise exception 'TEST 9 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 9 PASSED — %', sqlerrm;
    else raise exception 'TEST 9 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 10: generations table has no update grant ----------
\echo ''
\echo '=== TEST 10: UPDATE on subtopic_generations (expect permission denied — no grant exists) ==='
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999991","role":"authenticated"}';
do $$
begin
  update subtopic_generations set generation_status = 'failed_blocked' where id = '22222222-5000-0000-0000-000000000008';
  raise exception 'TEST 10 FAILED: update on generations succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then raise notice 'TEST 10 PASSED — %', sqlerrm;
    else raise exception 'TEST 10 FAILED unexpectedly: %', sqlerrm; end if;
end $$;
