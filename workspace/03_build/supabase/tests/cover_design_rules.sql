-- Behavioral test for cover_designs / cover_generations (migration 0007):
-- 1. Workspace isolation holds, same as every other table.
-- 2. cover_generations is insert-only (no update grant), same as prior generation logs.
-- 3. THE KEY NEW CLAIM: cover_designs INSERT is rejected when workspace_id is valid
--    for the caller but project_id points at a project belonging to a DIFFERENT
--    workspace — a genuinely new check this migration adds proactively (no prior
--    header table in this codebase has it), since a plain FK constraint only checks
--    referential integrity, not RLS-visibility of the referenced row.
-- 4. Cross-workspace spoofing on cover_generations, same shape migration 0005/0006
--    already closed for their own child tables.
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/cover_design_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('99999999-9999-9999-9999-999999999995', 'user-a-cd@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('99999999-9999-9999-9999-999999999996', 'user-b-cd@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-7000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999995', 'Workspace A'),
  ('bbbbbbbb-7000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999996', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-7000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999995', 'owner'),
  ('bbbbbbbb-7000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999996', 'owner');

-- Two projects, one per workspace — needed for the cross-workspace-spoofing proof.
insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-7000-0000-0000-000000000003', 'aaaaaaaa-7000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999995', 'content_confirmed'),
  ('dddddddd-7000-0000-0000-000000000009', 'bbbbbbbb-7000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999996', 'content_confirmed');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('eeeeeeee-7000-0000-0000-000000000004', 'cccccccc-7000-0000-0000-000000000003', 'aaaaaaaa-7000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('ffffffff-7000-0000-0000-000000000005', 'eeeeeeee-7000-0000-0000-000000000004', 'aaaaaaaa-7000-0000-0000-000000000001', 'cccccccc-7000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'ffffffff-7000-0000-0000-000000000005' where id = 'cccccccc-7000-0000-0000-000000000003';

insert into format_recommendations (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status, confirmed_format, confirmed_delivery_mode, is_override, confirmed_by, confirmed_at) values
  ('11111111-7000-0000-0000-000000000006', 'aaaaaaaa-7000-0000-0000-000000000001', 'cccccccc-7000-0000-0000-000000000003', 'ffffffff-7000-0000-0000-000000000005', 'tracker', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded', 'tracker', 'fillable', false, '99999999-9999-9999-9999-999999999995', now());

update projects set current_format_recommendation_id = '11111111-7000-0000-0000-000000000006' where id = 'cccccccc-7000-0000-0000-000000000003';

insert into content_builds (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, confirmed_format, status, confirmed_at, confirmed_by) values
  ('22222222-7000-0000-0000-000000000007', 'aaaaaaaa-7000-0000-0000-000000000001', 'cccccccc-7000-0000-0000-000000000003', 'ffffffff-7000-0000-0000-000000000005', '11111111-7000-0000-0000-000000000006', now(), now(), 'tracker', 'confirmed', now(), '99999999-9999-9999-9999-999999999995');

-- ---------- Test 1: User A inserts cover_designs (expect success) ----------
\echo '=== TEST 1: User A inserts cover_designs (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999995","role":"authenticated"}';

insert into cover_designs
  (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, content_build_confirmed_at, recommended_look_id, recommendation_reason, confirmed_look_id)
values
  ('33333333-7000-0000-0000-000000000008', 'aaaaaaaa-7000-0000-0000-000000000001', 'cccccccc-7000-0000-0000-000000000003', 'ffffffff-7000-0000-0000-000000000005', '11111111-7000-0000-0000-000000000006', now(), 'placeholder-look-01', 'Test reasoning', 'placeholder-look-01');

select 'cover_designs inserted OK, status' as result, status from cover_designs where id = '33333333-7000-0000-0000-000000000008';

-- ---------- Test 2: User A inserts a cover_generations row ----------
\echo ''
\echo '=== TEST 2: User A inserts cover_generations (expect success) ==='
insert into cover_generations
  (id, workspace_id, project_id, cover_design_id, generation_number, trigger_scope, look_id, prompt_sent, gemini_interaction_id, asset_storage_path, model, cost_usd, generation_status, completed_at)
values
  ('44444444-7000-0000-0000-00000000000a', 'aaaaaaaa-7000-0000-0000-000000000001', 'cccccccc-7000-0000-0000-000000000003', '33333333-7000-0000-0000-000000000008', 1, 'initial_candidate', 'placeholder-look-01', 'Test prompt', 'v1_test_interaction_id', 'aaaaaaaa-7000-0000-0000-000000000001/cccccccc-7000-0000-0000-000000000003/44444444-7000-0000-0000-00000000000a.jpg', 'gemini-3.1-flash-image', 0.0891, 'succeeded', now());

update cover_designs set current_cover_generation_id = '44444444-7000-0000-0000-00000000000a', candidate_count = 1 where id = '33333333-7000-0000-0000-000000000008';

select 'cover_generations inserted OK, current pointer set' as result, current_cover_generation_id from cover_designs where id = '33333333-7000-0000-0000-000000000008';

-- ---------- Test 3: THE KEY NEW CLAIM — cross-workspace spoofing on cover_designs' insert ----------
\echo ''
\echo '=== TEST 3: User A inserts cover_designs with OWN valid workspace_id but project_id pointing at Workspace B''s project (expect rejection) ==='
do $$
begin
  insert into cover_designs
    (workspace_id, project_id, title_candidate_id, format_recommendation_id, content_build_confirmed_at, recommended_look_id, recommendation_reason, confirmed_look_id)
  values
    ('aaaaaaaa-7000-0000-0000-000000000001', 'dddddddd-7000-0000-0000-000000000009', 'ffffffff-7000-0000-0000-000000000005', '11111111-7000-0000-0000-000000000006', now(), 'placeholder-look-01', 'Spoofed reasoning', 'placeholder-look-01');
  raise exception 'TEST 3 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 3 PASSED — %', sqlerrm;
    else raise exception 'TEST 3 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

reset role;
reset request.jwt.claims;

-- ---------- Test 4: User B isolation ----------
\echo ''
\echo '=== TEST 4: User B queries both tables (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999996","role":"authenticated"}';

select 'cover_designs' as t, count(*) from cover_designs
union all select 'cover_generations', count(*) from cover_generations;

-- ---------- Test 5: cross-workspace spoofing on cover_generations (same shape as migration 0005/0006's fix) ----------
\echo ''
\echo '=== TEST 5: User B inserts cover_generations with own workspace_id=B but cover_design_id pointing at Workspace A''s design (expect rejection) ==='
do $$
begin
  insert into cover_generations (workspace_id, project_id, cover_design_id, generation_number, trigger_scope, generation_status)
  values ('bbbbbbbb-7000-0000-0000-000000000002', 'dddddddd-7000-0000-0000-000000000009', '33333333-7000-0000-0000-000000000008', 2, 'initial_candidate', 'succeeded');
  raise exception 'TEST 5 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 5 PASSED — %', sqlerrm;
    else raise exception 'TEST 5 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 6: cover_generations has no update grant ----------
\echo ''
\echo '=== TEST 6: UPDATE on cover_generations (expect permission denied — no grant exists) ==='
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999995","role":"authenticated"}';
do $$
begin
  update cover_generations set generation_status = 'failed_blocked' where id = '44444444-7000-0000-0000-00000000000a';
  raise exception 'TEST 6 FAILED: update on cover_generations succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then raise notice 'TEST 6 PASSED — %', sqlerrm;
    else raise exception 'TEST 6 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 7: Approve — atomic status + approval_status update (draft only) ----------
\echo ''
\echo '=== TEST 7: User A approves the cover (expect success, both fields set atomically) ==='
update cover_designs set status = 'confirmed', approval_status = 'approved', approved_at = now(), approved_by = '99999999-9999-9999-9999-999999999995' where id = '33333333-7000-0000-0000-000000000008';
select 'approved OK' as result, status, approval_status from cover_designs where id = '33333333-7000-0000-0000-000000000008';

reset role;
reset request.jwt.claims;
