-- Behavioral test for export_builds / export_generations / export_format_states /
-- export_field_maps (migration 0009):
-- 1. Workspace isolation holds, same as every other table.
-- 2. export_generations and export_field_maps are insert-only (no update grant),
--    same as every prior generation log.
-- 3. Cross-workspace spoofing is rejected on ALL FOUR insert-gated tables — applied
--    proactively from the start (the Step 9/10 lesson), not discovered via a failing test.
-- 4. export_builds and export_format_states both accept real UPDATEs (the recommend/
--    confirm cycle and the approve/staleness-revert cycle respectively).
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/export_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('99999999-9999-9999-9999-999999999999', 'user-a-ex@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('88888888-8888-8888-8888-888888888888', 'user-b-ex@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-9000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'Workspace A'),
  ('bbbbbbbb-9000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-9000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'owner'),
  ('bbbbbbbb-9000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-9000-0000-0000-000000000003', 'aaaaaaaa-9000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999', 'copy_confirmed'),
  ('dddddddd-9000-0000-0000-000000000009', 'bbbbbbbb-9000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888', 'copy_confirmed');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('eeeeeeee-9000-0000-0000-000000000004', 'cccccccc-9000-0000-0000-000000000003', 'aaaaaaaa-9000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('ffffffff-9000-0000-0000-000000000005', 'eeeeeeee-9000-0000-0000-000000000004', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'ffffffff-9000-0000-0000-000000000005' where id = 'cccccccc-9000-0000-0000-000000000003';

insert into format_recommendations (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status, confirmed_format, confirmed_delivery_mode, is_override, confirmed_by, confirmed_at) values
  ('11111111-9000-0000-0000-000000000006', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'ffffffff-9000-0000-0000-000000000005', 'tracker', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded', 'tracker', 'fillable', false, '99999999-9999-9999-9999-999999999999', now());

update projects set current_format_recommendation_id = '11111111-9000-0000-0000-000000000006' where id = 'cccccccc-9000-0000-0000-000000000003';

insert into content_builds (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, confirmed_format, status, confirmed_at, confirmed_by) values
  ('22222222-9000-0000-0000-000000000007', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', now(), now(), 'tracker', 'confirmed', now(), '99999999-9999-9999-9999-999999999999');

insert into cover_designs (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, content_build_confirmed_at, recommended_look_id, recommendation_reason, confirmed_look_id, status, approval_status, approved_at, approved_by) values
  ('33333333-9000-0000-0000-000000000008', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', now(), 'placeholder-editorial-01', 'Test reasoning', 'placeholder-editorial-01', 'confirmed', 'approved', now(), '99999999-9999-9999-9999-999999999999');

insert into cover_generations (id, workspace_id, project_id, cover_design_id, generation_number, trigger_scope, look_id, asset_storage_path, model, generation_status, completed_at) values
  ('44444444-9000-0000-0000-00000000000a', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', '33333333-9000-0000-0000-000000000008', 1, 'initial_candidate', 'placeholder-editorial-01', 'aaaaaaaa-9000-0000-0000-000000000001/cccccccc-9000-0000-0000-000000000003/44444444-9000-0000-0000-00000000000a.jpg', 'gemini-3.1-flash-image', 'succeeded', now());

update cover_designs set current_cover_generation_id = '44444444-9000-0000-0000-00000000000a', candidate_count = 1 where id = '33333333-9000-0000-0000-000000000008';

-- ---------- Test 1: User A inserts export_builds (expect success) ----------
\echo '=== TEST 1: User A inserts export_builds (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

insert into export_builds
  (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, recommended_output_format, reasoning_summary, inputs_snapshot, model, generation_status)
values
  ('55555555-9000-0000-0000-00000000000b', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', 'pdf', 'Fillable tracker needs a real PDF form.', '{}', 'openai/gpt-oss-120b', 'succeeded');

update projects set current_export_build_id = '55555555-9000-0000-0000-00000000000b' where id = 'cccccccc-9000-0000-0000-000000000003';

select 'export_builds inserted OK, recommendation_status' as result, recommendation_status from export_builds where id = '55555555-9000-0000-0000-00000000000b';

-- ---------- Test 2: User A inserts export_generations, export_format_states, export_field_maps ----------
\echo ''
\echo '=== TEST 2: User A inserts export_generations + export_format_states + export_field_maps (expect success) ==='
insert into export_generations
  (id, workspace_id, project_id, output_format, generation_number, trigger_scope, title_candidate_id, format_recommendation_id, content_build_confirmed_at, cover_generation_id, asset_storage_path, model, page_count, generation_status, completed_at)
values
  ('66666666-9000-0000-0000-00000000000c', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'pdf', 1, 'initial', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', now(), '44444444-9000-0000-0000-00000000000a', 'aaaaaaaa-9000-0000-0000-000000000001/cccccccc-9000-0000-0000-000000000003/66666666-9000-0000-0000-00000000000c.pdf', '@react-pdf/renderer', 12, 'succeeded', now());

insert into export_format_states
  (id, workspace_id, project_id, output_format, title_candidate_id, format_recommendation_id, content_build_confirmed_at, cover_generation_id, current_export_generation_id)
values
  ('77777777-9000-0000-0000-00000000000d', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', 'pdf', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', now(), '44444444-9000-0000-0000-00000000000a', '66666666-9000-0000-0000-00000000000c');

insert into export_field_maps
  (id, workspace_id, project_id, export_generation_id, subtopic_id, field_order, field_type, source_text)
values
  ('88888888-9000-0000-0000-00000000000e', 'aaaaaaaa-9000-0000-0000-000000000001', 'cccccccc-9000-0000-0000-000000000003', '66666666-9000-0000-0000-00000000000c', null, 1, 'checklist_item', 'Log today''s income');

select 'export_format_states inserted OK, status' as result, status, approval_status from export_format_states where id = '77777777-9000-0000-0000-00000000000d';

-- ---------- Test 3: cross-workspace spoofing on export_builds' insert ----------
\echo ''
\echo '=== TEST 3: User A inserts export_builds with OWN valid workspace_id but project_id pointing at Workspace B''s project (expect rejection) ==='
do $$
begin
  insert into export_builds (workspace_id, project_id, title_candidate_id, format_recommendation_id, recommended_output_format, reasoning_summary, inputs_snapshot, model, generation_status)
  values ('aaaaaaaa-9000-0000-0000-000000000001', 'dddddddd-9000-0000-0000-000000000009', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', 'docx', 'Spoofed', '{}', 'openai/gpt-oss-120b', 'succeeded');
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
set request.jwt.claims to '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}';

select 'export_builds' as t, count(*) from export_builds
union all select 'export_generations', count(*) from export_generations
union all select 'export_format_states', count(*) from export_format_states
union all select 'export_field_maps', count(*) from export_field_maps;

-- ---------- Test 5: cross-workspace spoofing on export_generations' insert ----------
\echo ''
\echo '=== TEST 5: User B inserts export_generations with own workspace_id=B but project_id pointing at Workspace A''s project (expect rejection) ==='
do $$
begin
  insert into export_generations (workspace_id, project_id, output_format, generation_number, trigger_scope, title_candidate_id, format_recommendation_id, content_build_confirmed_at, generation_status)
  values ('bbbbbbbb-9000-0000-0000-000000000002', 'cccccccc-9000-0000-0000-000000000003', 'docx', 99, 'initial', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', now(), 'succeeded');
  raise exception 'TEST 5 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 5 PASSED — %', sqlerrm;
    else raise exception 'TEST 5 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 6: cross-workspace spoofing on export_format_states' insert ----------
\echo ''
\echo '=== TEST 6: User B inserts export_format_states with own workspace_id=B but project_id pointing at Workspace A''s project (expect rejection) ==='
do $$
begin
  insert into export_format_states (workspace_id, project_id, output_format, title_candidate_id, format_recommendation_id, content_build_confirmed_at)
  values ('bbbbbbbb-9000-0000-0000-000000000002', 'cccccccc-9000-0000-0000-000000000003', 'notion_markdown', 'ffffffff-9000-0000-0000-000000000005', '11111111-9000-0000-0000-000000000006', now());
  raise exception 'TEST 6 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 6 PASSED — %', sqlerrm;
    else raise exception 'TEST 6 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 7: cross-workspace spoofing on export_field_maps' insert ----------
\echo ''
\echo '=== TEST 7: User B inserts export_field_maps with own workspace_id=B but export_generation_id pointing at Workspace A''s generation (expect rejection) ==='
do $$
begin
  insert into export_field_maps (workspace_id, project_id, export_generation_id, field_order, field_type, source_text)
  values ('bbbbbbbb-9000-0000-0000-000000000002', 'dddddddd-9000-0000-0000-000000000009', '66666666-9000-0000-0000-00000000000c', 2, 'heading', 'Spoofed');
  raise exception 'TEST 7 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 7 PASSED — %', sqlerrm;
    else raise exception 'TEST 7 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 8: export_generations has no update grant ----------
\echo ''
\echo '=== TEST 8: UPDATE on export_generations (expect permission denied — no grant exists) ==='
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
do $$
begin
  update export_generations set generation_status = 'failed_blocked' where id = '66666666-9000-0000-0000-00000000000c';
  raise exception 'TEST 8 FAILED: update on export_generations succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then raise notice 'TEST 8 PASSED — %', sqlerrm;
    else raise exception 'TEST 8 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 9: Approve — export_format_states atomic status + approval_status update ----------
\echo ''
\echo '=== TEST 9: User A approves the pdf export_format_states row (expect success) ==='
update export_format_states set status = 'confirmed', approval_status = 'approved', approved_at = now(), approved_by = '99999999-9999-9999-9999-999999999999' where id = '77777777-9000-0000-0000-00000000000d';
select 'approved OK' as result, status, approval_status from export_format_states where id = '77777777-9000-0000-0000-00000000000d';

-- ---------- Test 10: Confirm output format on export_builds ----------
\echo ''
\echo '=== TEST 10: User A confirms the recommended output format on export_builds (expect success) ==='
update export_builds set confirmed_output_format = 'pdf', is_override = false, confirmed_by = '99999999-9999-9999-9999-999999999999', confirmed_at = now() where id = '55555555-9000-0000-0000-00000000000b';
select 'export_builds confirmed OK' as result, confirmed_output_format, is_override from export_builds where id = '55555555-9000-0000-0000-00000000000b';

reset role;
reset request.jwt.claims;
