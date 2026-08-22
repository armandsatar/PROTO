-- Behavioral test for transformation_map_generations + transformation_maps (migration 0004):
-- 1. Workspace isolation holds, same as every other table.
-- 2. transformation_map_generations is truly insert-only — no UPDATE grant exists at
--    all, unlike every prior generation/recommendation table.
-- 3. transformation_maps' content-lock trigger: blocks a content edit while staying
--    confirmed, but allows both the confirm (draft->confirmed) and unlock
--    (confirmed->draft) transitions themselves, and allows editing again once back in draft.
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/transformation_maps_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('77777777-7777-7777-7777-777777777777', 'user-a-tm@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('88888888-8888-8888-8888-888888888888', 'user-b-tm@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-4000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Workspace A'),
  ('bbbbbbbb-4000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-4000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'owner'),
  ('bbbbbbbb-4000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-4000-0000-0000-000000000003', 'aaaaaaaa-4000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'lead_magnet_reviewed');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('dddddddd-4000-0000-0000-000000000004', 'cccccccc-4000-0000-0000-000000000003', 'aaaaaaaa-4000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('eeeeeeee-4000-0000-0000-000000000005', 'dddddddd-4000-0000-0000-000000000004', 'aaaaaaaa-4000-0000-0000-000000000001', 'cccccccc-4000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'eeeeeeee-4000-0000-0000-000000000005' where id = 'cccccccc-4000-0000-0000-000000000003';

-- ---------- Test 1: User A inserts a generation row ----------
\echo '=== TEST 1: User A inserts a transformation_map_generations row (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';

insert into transformation_map_generations
  (id, workspace_id, project_id, generation_number, title_candidate_id, inputs_snapshot, headline_before, headline_after, dim_emotional_before, dim_emotional_after, dim_practical_before, dim_practical_after, dim_identity_before, dim_identity_after, dim_pain_point_before, dim_pain_point_after, model, generation_status, completed_at)
values
  ('11111111-4000-0000-0000-000000000006', 'aaaaaaaa-4000-0000-0000-000000000001', 'cccccccc-4000-0000-0000-000000000003', 1, 'eeeeeeee-4000-0000-0000-000000000005', '{}', 'before headline', 'after headline', 'before emotional', 'after emotional', 'before practical', 'after practical', 'before identity', 'after identity', 'before pain', 'after pain', 'openai/gpt-oss-120b', 'succeeded', now());

select 'generation inserted OK' as result;

-- ---------- Test 2: User A inserts the transformation_maps row seeded from it ----------
\echo ''
\echo '=== TEST 2: User A inserts a transformation_maps row (expect success) ==='
insert into transformation_maps
  (id, workspace_id, project_id, source_generation_id, title_candidate_id, headline_before, headline_after, dim_emotional_before, dim_emotional_after, dim_practical_before, dim_practical_after, dim_identity_before, dim_identity_after, dim_pain_point_before, dim_pain_point_after)
values
  ('22222222-4000-0000-0000-000000000007', 'aaaaaaaa-4000-0000-0000-000000000001', 'cccccccc-4000-0000-0000-000000000003', '11111111-4000-0000-0000-000000000006', 'eeeeeeee-4000-0000-0000-000000000005', 'before headline', 'after headline', 'before emotional', 'after emotional', 'before practical', 'after practical', 'before identity', 'after identity', 'before pain', 'after pain');

select 'map inserted OK, status' as result, status from transformation_maps where id = '22222222-4000-0000-0000-000000000007';

-- ---------- Test 3: direct content edit while draft (expect success) ----------
\echo ''
\echo '=== TEST 3: User A edits a content field while draft (expect success) ==='
update transformation_maps set dim_emotional_before = 'edited before emotional', is_edited = true where id = '22222222-4000-0000-0000-000000000007';
select 'edited OK' as result, dim_emotional_before from transformation_maps where id = '22222222-4000-0000-0000-000000000007';

-- ---------- Test 4: confirm transition (draft->confirmed, expect success) ----------
\echo ''
\echo '=== TEST 4: User A confirms (draft->confirmed, expect success) ==='
update transformation_maps set status = 'confirmed', confirmed_at = now(), confirmed_by = '77777777-7777-7777-7777-777777777777' where id = '22222222-4000-0000-0000-000000000007';
select 'confirmed OK' as result, status from transformation_maps where id = '22222222-4000-0000-0000-000000000007';

-- ---------- Test 5: content edit while STAYING confirmed (expect REJECTION) ----------
\echo ''
\echo '=== TEST 5: User A attempts a content edit while staying confirmed (expect trigger rejection) ==='
do $$
begin
  update transformation_maps set dim_practical_before = 'sneaky edit' where id = '22222222-4000-0000-0000-000000000007';
  raise exception 'TEST 5 FAILED: content edit while confirmed was NOT rejected';
exception
  when others then
    if sqlerrm like '%content fields are locked while status is confirmed%' then
      raise notice 'TEST 5 PASSED: correctly rejected — %', sqlerrm;
    else
      raise exception 'TEST 5 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;

select 'content unchanged after rejected edit' as result, dim_practical_before from transformation_maps where id = '22222222-4000-0000-0000-000000000007';

-- ---------- Test 6: unlock transition (confirmed->draft, expect success) ----------
\echo ''
\echo '=== TEST 6: User A unlocks (confirmed->draft, expect success, content preserved) ==='
update transformation_maps set status = 'draft', confirmed_at = null, confirmed_by = null where id = '22222222-4000-0000-0000-000000000007';
select 'unlocked OK, content preserved' as result, status, dim_emotional_before from transformation_maps where id = '22222222-4000-0000-0000-000000000007';

-- ---------- Test 7: edit again now that it's back in draft (expect success) ----------
\echo ''
\echo '=== TEST 7: User A edits content again post-unlock (expect success) ==='
update transformation_maps set dim_practical_before = 'edited after unlock' where id = '22222222-4000-0000-0000-000000000007';
select 'edited post-unlock OK' as result, dim_practical_before from transformation_maps where id = '22222222-4000-0000-0000-000000000007';

reset role;
reset request.jwt.claims;

-- ---------- Test 8: User B isolation (expect ZERO rows on both tables) ----------
\echo ''
\echo '=== TEST 8: User B queries both tables (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';

select 'User B sees N generations (expect 0)' as result, count(*) as row_count from transformation_map_generations;
select 'User B sees N maps (expect 0)' as result, count(*) as row_count from transformation_maps;

-- ---------- Test 9: User B cross-workspace insert into generations (expect RLS rejection) ----------
\echo ''
\echo '=== TEST 9: User B attempts cross-workspace insert into generations (expect RLS rejection) ==='
do $$
begin
  insert into transformation_map_generations
    (workspace_id, project_id, generation_number, title_candidate_id, inputs_snapshot, headline_before, headline_after, dim_emotional_before, dim_emotional_after, dim_practical_before, dim_practical_after, dim_identity_before, dim_identity_after, dim_pain_point_before, dim_pain_point_after, model, generation_status, completed_at)
  values
    ('aaaaaaaa-4000-0000-0000-000000000001', 'cccccccc-4000-0000-0000-000000000003', 2, 'eeeeeeee-4000-0000-0000-000000000005', '{}', 'x','x','x','x','x','x','x','x','x','x', 'openai/gpt-oss-120b', 'succeeded', now());
  raise exception 'TEST 9 FAILED: cross-workspace insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then
      raise notice 'TEST 9 PASSED: correctly rejected — %', sqlerrm;
    else
      raise exception 'TEST 9 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;

reset role;
reset request.jwt.claims;

-- ---------- Test 10 (superuser): generations table has NO update grant at all ----------
\echo ''
\echo '=== TEST 10: attempting UPDATE on transformation_map_generations as authenticated (expect permission denied — no grant exists) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';
do $$
begin
  update transformation_map_generations set generation_status = 'failed_blocked' where id = '11111111-4000-0000-0000-000000000006';
  raise exception 'TEST 10 FAILED: update on generations succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then
      raise notice 'TEST 10 PASSED: correctly denied at grant level — %', sqlerrm;
    else
      raise exception 'TEST 10 FAILED with an unexpected error: %', sqlerrm;
    end if;
end $$;
