-- Behavioral test for copywriting_builds / copy_generations / platform_copies /
-- copy_compliance_changes (migration 0008):
-- 1. Workspace isolation holds, same as every other table.
-- 2. copy_generations is insert-only (no update grant), same as every prior generation log.
-- 3. Cross-workspace spoofing is rejected on ALL FOUR insert-gated tables — applied
--    proactively from the start this time (the Step 9 lesson from cover_generations'
--    self-caught gap), not discovered via a failing test.
-- 4. The 'narrative' sentinel value (decision 14) behaves like any other platform row
--    at the RLS layer — no special-casing needed, since RLS only ever checks
--    workspace_id/build ownership, never the platform value itself.
-- 5. platform_copies UPDATE succeeds while the build is draft (Step 8's precedent).
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/copywriting_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('99999999-9999-9999-9999-999999999997', 'user-a-cw@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('99999999-9999-9999-9999-999999999998', 'user-b-cw@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-8000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999997', 'Workspace A'),
  ('bbbbbbbb-8000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999998', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-8000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999997', 'owner'),
  ('bbbbbbbb-8000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999998', 'owner');

-- Two projects, one per workspace — needed for the cross-workspace-spoofing proofs.
insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-8000-0000-0000-000000000003', 'aaaaaaaa-8000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999997', 'cover_approved'),
  ('dddddddd-8000-0000-0000-000000000009', 'bbbbbbbb-8000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999998', 'cover_approved');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('eeeeeeee-8000-0000-0000-000000000004', 'cccccccc-8000-0000-0000-000000000003', 'aaaaaaaa-8000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('ffffffff-8000-0000-0000-000000000005', 'eeeeeeee-8000-0000-0000-000000000004', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'ffffffff-8000-0000-0000-000000000005' where id = 'cccccccc-8000-0000-0000-000000000003';

insert into format_recommendations (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status, confirmed_format, confirmed_delivery_mode, is_override, confirmed_by, confirmed_at) values
  ('11111111-8000-0000-0000-000000000006', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', 'ffffffff-8000-0000-0000-000000000005', 'tracker', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded', 'tracker', 'fillable', false, '99999999-9999-9999-9999-999999999997', now());

update projects set current_format_recommendation_id = '11111111-8000-0000-0000-000000000006' where id = 'cccccccc-8000-0000-0000-000000000003';

insert into content_builds (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, confirmed_format, status, confirmed_at, confirmed_by) values
  ('22222222-8000-0000-0000-000000000007', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), now(), 'tracker', 'confirmed', now(), '99999999-9999-9999-9999-999999999997');

insert into cover_designs (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, content_build_confirmed_at, recommended_look_id, recommendation_reason, confirmed_look_id, status, approval_status, approved_at, approved_by) values
  ('33333333-8000-0000-0000-000000000008', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), 'placeholder-editorial-01', 'Test reasoning', 'placeholder-editorial-01', 'confirmed', 'approved', now(), '99999999-9999-9999-9999-999999999997');

-- ---------- Test 1: User A inserts copywriting_builds (expect success) ----------
\echo '=== TEST 1: User A inserts copywriting_builds (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999997","role":"authenticated"}';

insert into copywriting_builds
  (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, content_build_confirmed_at, cover_look_snapshot, confirmed_format)
values
  ('44444444-8000-0000-0000-00000000000a', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), now(), now(), 'placeholder-editorial-01', 'tracker');

select 'copywriting_builds inserted OK, status' as result, status from copywriting_builds where id = '44444444-8000-0000-0000-00000000000a';

-- ---------- Test 2: User A inserts the 'narrative' sentinel generation + row, then a real platform's ----------
\echo ''
\echo '=== TEST 2: User A inserts a narrative copy_generations + platform_copies row, then an etsy row (expect success) ==='
insert into copy_generations
  (id, workspace_id, project_id, copywriting_build_id, platform, generation_number, trigger_scope, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, content_build_confirmed_at, cover_look_snapshot, inputs_snapshot, compliance_status, model, generation_status, completed_at)
values
  ('55555555-8000-0000-0000-00000000000b', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', '44444444-8000-0000-0000-00000000000a', 'narrative', 1, 'initial', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), now(), now(), 'placeholder-editorial-01', '{}', 'no_changes_needed', 'openai/gpt-oss-120b', 'succeeded', now());

insert into platform_copies
  (id, workspace_id, project_id, copywriting_build_id, platform, platform_fields, source_generation_id, content_status)
values
  ('66666666-8000-0000-0000-00000000000c', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', '44444444-8000-0000-0000-00000000000a', 'narrative', '{"hook":"test hook","transformation_story":"test story","cta":"test cta","summary":"test summary"}', '55555555-8000-0000-0000-00000000000b', 'generated');

insert into copy_generations
  (id, workspace_id, project_id, copywriting_build_id, platform, generation_number, trigger_scope, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, content_build_confirmed_at, cover_look_snapshot, inputs_snapshot, compliance_status, hard_limit_status, model, generation_status, completed_at)
values
  ('77777777-8000-0000-0000-00000000000d', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', '44444444-8000-0000-0000-00000000000a', 'etsy', 1, 'initial', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), now(), now(), 'placeholder-editorial-01', '{}', 'no_changes_needed', 'within_limit', 'openai/gpt-oss-120b', 'succeeded', now());

insert into platform_copies
  (id, workspace_id, project_id, copywriting_build_id, platform, title, body, platform_fields, source_generation_id, content_status, narrative_snapshot_at)
values
  ('88888888-8000-0000-0000-00000000000e', 'aaaaaaaa-8000-0000-0000-000000000001', 'cccccccc-8000-0000-0000-000000000003', '44444444-8000-0000-0000-00000000000a', 'etsy', 'Test Etsy Title', 'Test Etsy description', '{"tags":["budget","freelancer"]}', '77777777-8000-0000-0000-00000000000d', 'generated', now());

select platform, title, content_status from platform_copies where copywriting_build_id = '44444444-8000-0000-0000-00000000000a' order by platform;

-- ---------- Test 3: cross-workspace spoofing on copywriting_builds' insert ----------
\echo ''
\echo '=== TEST 3: User A inserts copywriting_builds with OWN valid workspace_id but project_id pointing at Workspace B''s project (expect rejection) ==='
do $$
begin
  insert into copywriting_builds
    (workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, content_build_confirmed_at, cover_look_snapshot, confirmed_format)
  values
    ('aaaaaaaa-8000-0000-0000-000000000001', 'dddddddd-8000-0000-0000-000000000009', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), now(), now(), 'placeholder-editorial-01', 'tracker');
  raise exception 'TEST 3 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 3 PASSED — %', sqlerrm;
    else raise exception 'TEST 3 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

reset role;
reset request.jwt.claims;

-- ---------- Test 4: User B isolation across all 4 tables ----------
\echo ''
\echo '=== TEST 4: User B queries all 4 tables (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999998","role":"authenticated"}';

select 'copywriting_builds' as t, count(*) from copywriting_builds
union all select 'copy_generations', count(*) from copy_generations
union all select 'platform_copies', count(*) from platform_copies
union all select 'copy_compliance_changes', count(*) from copy_compliance_changes;

-- ---------- Test 5: cross-workspace spoofing on copy_generations' insert ----------
\echo ''
\echo '=== TEST 5: User B inserts copy_generations with own workspace_id=B but copywriting_build_id pointing at Workspace A''s build (expect rejection) ==='
do $$
begin
  insert into copy_generations (workspace_id, project_id, copywriting_build_id, platform, generation_number, trigger_scope, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, content_build_confirmed_at, cover_look_snapshot, inputs_snapshot, compliance_status, model, generation_status)
  values ('bbbbbbbb-8000-0000-0000-000000000002', 'dddddddd-8000-0000-0000-000000000009', '44444444-8000-0000-0000-00000000000a', 'gumroad', 1, 'initial', 'ffffffff-8000-0000-0000-000000000005', '11111111-8000-0000-0000-000000000006', now(), now(), now(), 'placeholder-editorial-01', '{}', 'no_changes_needed', 'openai/gpt-oss-120b', 'succeeded');
  raise exception 'TEST 5 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 5 PASSED — %', sqlerrm;
    else raise exception 'TEST 5 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 6: cross-workspace spoofing on platform_copies' insert ----------
\echo ''
\echo '=== TEST 6: User B inserts platform_copies with own workspace_id=B but copywriting_build_id pointing at Workspace A''s build (expect rejection) ==='
do $$
begin
  insert into platform_copies (workspace_id, project_id, copywriting_build_id, platform, body)
  values ('bbbbbbbb-8000-0000-0000-000000000002', 'dddddddd-8000-0000-0000-000000000009', '44444444-8000-0000-0000-00000000000a', 'instagram', 'spoofed caption');
  raise exception 'TEST 6 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 6 PASSED — %', sqlerrm;
    else raise exception 'TEST 6 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 7: cross-workspace spoofing on copy_compliance_changes' insert ----------
\echo ''
\echo '=== TEST 7: User B inserts copy_compliance_changes with own workspace_id=B but copy_generation_id pointing at Workspace A''s generation (expect rejection) ==='
do $$
begin
  insert into copy_compliance_changes (workspace_id, project_id, copy_generation_id, platform_copy_id, original_text, rewritten_text, reason, risk_category, detected_by)
  values ('bbbbbbbb-8000-0000-0000-000000000002', 'dddddddd-8000-0000-0000-000000000009', '77777777-8000-0000-0000-00000000000d', '88888888-8000-0000-0000-00000000000e', 'guaranteed results', 'may support results', 'spoofed', 'unsupported_claim', 'ai_judgment');
  raise exception 'TEST 7 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 7 PASSED — %', sqlerrm;
    else raise exception 'TEST 7 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 8: copy_generations has no update grant ----------
\echo ''
\echo '=== TEST 8: UPDATE on copy_generations (expect permission denied — no grant exists) ==='
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999997","role":"authenticated"}';
do $$
begin
  update copy_generations set generation_status = 'failed_blocked' where id = '77777777-8000-0000-0000-00000000000d';
  raise exception 'TEST 8 FAILED: update on copy_generations succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then raise notice 'TEST 8 PASSED — %', sqlerrm;
    else raise exception 'TEST 8 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 9: platform_copies UPDATE succeeds while the build is draft ----------
\echo ''
\echo '=== TEST 9: User A updates platform_copies while copywriting_builds is draft (expect success) ==='
update platform_copies set title = 'Edited Etsy Title', is_edited = true where id = '88888888-8000-0000-0000-00000000000e';
select 'platform_copies updated OK' as result, title, is_edited from platform_copies where id = '88888888-8000-0000-0000-00000000000e';

-- ---------- Test 10: Confirm the build, then platform_copies UPDATE is rejected ----------
\echo ''
\echo '=== TEST 10: Confirm copywriting_builds, then UPDATE on platform_copies is silently blocked ==='
update copywriting_builds set status = 'confirmed', confirmed_at = now(), confirmed_by = '99999999-9999-9999-9999-999999999997' where id = '44444444-8000-0000-0000-00000000000a';

update platform_copies set title = 'SNEAKY POST-CONFIRM EDIT' where id = '88888888-8000-0000-0000-00000000000e';
select 'expected: title unchanged after confirm' as result, title from platform_copies where id = '88888888-8000-0000-0000-00000000000e';

reset role;
reset request.jwt.claims;
