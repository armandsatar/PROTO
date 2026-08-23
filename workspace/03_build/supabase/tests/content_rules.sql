-- Behavioral test for content_builds / content_generations / subtopic_contents /
-- content_compliance_changes (migration 0006):
-- 1. Workspace isolation holds, same as every other table.
-- 2. content_generations and content_compliance_changes are insert-only (no update
--    grant), same as prior generation logs.
-- 3. subtopic_contents insert/update are locked once the PARENT content_builds row is
--    confirmed, via the same plain RLS subquery pattern migration 0005 proved needs no
--    trigger.
-- 4. THE KEY NEW CLAIM: subtopic_contents DELETE stays workspace-gated only, NOT
--    draft-status-gated — proven by cascading a delete from `subtopics` (Step 7) while
--    `content_builds` (Step 8) is independently CONFIRMED, and confirming the cascade
--    still succeeds rather than failing with an opaque RLS error.
-- 5. The same cross-workspace spoofing case migration 0005 closed, re-verified here for
--    subtopic_contents' insert policy.
--
-- Run with:
--   supabase start   (or: supabase db reset, if already running)
--   cat supabase/tests/content_rules.sql | \
--     docker exec -i supabase_db_03_build psql -U postgres -d postgres

\set ON_ERROR_STOP on

-- ---------- Fixture setup (as superuser) ----------

insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
values
  ('99999999-9999-9999-9999-999999999993', 'user-a-ct@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated'),
  ('99999999-9999-9999-9999-999999999994', 'user-b-ct@test.local', 'x', now(), now(), now(), 'authenticated', 'authenticated');

insert into workspaces (id, owner_user_id, name) values
  ('aaaaaaaa-6000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999993', 'Workspace A'),
  ('bbbbbbbb-6000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999994', 'Workspace B');

insert into workspace_members (workspace_id, user_id, role) values
  ('aaaaaaaa-6000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999993', 'owner'),
  ('bbbbbbbb-6000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999994', 'owner');

insert into projects (id, workspace_id, created_by, status) values
  ('cccccccc-6000-0000-0000-000000000003', 'aaaaaaaa-6000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999993', 'subtopics_confirmed');

insert into research_runs (id, project_id, workspace_id, run_number, idea_title_snapshot, idea_rationale_snapshot, ai_connector_used, status, completed_at) values
  ('dddddddd-6000-0000-0000-000000000004', 'cccccccc-6000-0000-0000-000000000003', 'aaaaaaaa-6000-0000-0000-000000000001', 1, 'Notion Budget Tracker for Freelancers', 'Rising demand', 'openai/gpt-oss-120b', 'completed', now());

insert into title_candidates (id, research_run_id, workspace_id, project_id, candidate_text, is_original, generation_axis, demand_score, demand_color, demand_signal_detail, competition_score, competition_color, competition_signal_detail, display_order) values
  ('eeeeeeee-6000-0000-0000-000000000005', 'dddddddd-6000-0000-0000-000000000004', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', 'Notion Budget Tracker for Freelancers', true, 'original', 8, 'green', '{}', 8, 'green', '{}', 1);

update projects set selected_candidate_id = 'eeeeeeee-6000-0000-0000-000000000005' where id = 'cccccccc-6000-0000-0000-000000000003';

insert into format_recommendations (id, workspace_id, project_id, title_candidate_id, recommended_format, recommended_delivery_mode, confidence, reasoning_summary, reasoning_signals, inputs_snapshot, model, generation_status, confirmed_format, confirmed_delivery_mode, is_override, confirmed_by, confirmed_at) values
  ('ffffffff-6000-0000-0000-000000000006', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', 'eeeeeeee-6000-0000-0000-000000000005', 'tracker', 'fillable', 'high', 'Test reasoning', '[]', '{}', 'openai/gpt-oss-120b', 'succeeded', 'tracker', 'fillable', false, '99999999-9999-9999-9999-999999999993', now());

update projects set current_format_recommendation_id = 'ffffffff-6000-0000-0000-000000000006' where id = 'cccccccc-6000-0000-0000-000000000003';

insert into subtopic_lists (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, confirmed_format, target_count_min, target_count_max, status, confirmed_at, confirmed_by) values
  ('11111111-6000-0000-0000-000000000007', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', 'eeeeeeee-6000-0000-0000-000000000005', 'ffffffff-6000-0000-0000-000000000006', now(), 'tracker', 5, 8, 'confirmed', now(), '99999999-9999-9999-9999-999999999993');

insert into subtopics (id, workspace_id, project_id, subtopic_list_id, title, description, display_order, depth, source) values
  ('22222222-6000-0000-0000-000000000008', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '11111111-6000-0000-0000-000000000007', 'Setting Up Your Weekly Budget', 'Covers the baseline setup.', 1, 'medium', 'ai_generated'),
  ('33333333-6000-0000-0000-000000000009', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '11111111-6000-0000-0000-000000000007', 'Automating Bill Reminders', 'Covers recurring bill tracking.', 2, 'shallow', 'ai_generated');

-- ---------- Test 1: User A inserts content_builds ----------
\echo '=== TEST 1: User A inserts content_builds (expect success) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999993","role":"authenticated"}';

insert into content_builds
  (id, workspace_id, project_id, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, confirmed_format)
values
  ('44444444-6000-0000-0000-00000000000a', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', 'eeeeeeee-6000-0000-0000-000000000005', 'ffffffff-6000-0000-0000-000000000006', now(), now(), 'tracker');

select 'content_builds inserted OK, status' as result, status from content_builds where id = '44444444-6000-0000-0000-00000000000a';

-- ---------- Test 2: User A inserts a content_generations row ----------
\echo ''
\echo '=== TEST 2: User A inserts content_generations (expect success) ==='
insert into content_generations
  (id, workspace_id, project_id, content_build_id, subtopic_id, generation_number, trigger_scope, title_candidate_id, format_recommendation_id, transformation_map_snapshot_at, subtopic_list_confirmed_at, subtopic_snapshot, inputs_snapshot, draft_content_snapshot, output_snapshot, specificity_score, compliance_status, model, generation_status, completed_at)
values
  ('55555555-6000-0000-0000-00000000000b', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '44444444-6000-0000-0000-00000000000a', '22222222-6000-0000-0000-000000000008', 1, 'initial', 'eeeeeeee-6000-0000-0000-000000000005', 'ffffffff-6000-0000-0000-000000000006', now(), now(), '{}', '{}', 'Draft text.', 'Draft text.', 8, 'no_changes_needed', 'openai/gpt-oss-120b', 'succeeded', now()),
  ('55555555-6000-0000-0000-00000000000f', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '44444444-6000-0000-0000-00000000000a', '33333333-6000-0000-0000-000000000009', 1, 'initial', 'eeeeeeee-6000-0000-0000-000000000005', 'ffffffff-6000-0000-0000-000000000006', now(), now(), '{}', '{}', 'More draft text.', 'More draft text.', 8, 'no_changes_needed', 'openai/gpt-oss-120b', 'succeeded', now());

select 'content_generations inserted OK' as result;

-- ---------- Test 3: User A inserts subtopic_contents while draft ----------
\echo ''
\echo '=== TEST 3: User A inserts 2 subtopic_contents while draft (expect success) ==='
insert into subtopic_contents (id, workspace_id, project_id, content_build_id, subtopic_id, body, word_count, target_word_min, target_word_max, content_status, source_generation_id) values
  ('66666666-6000-0000-0000-00000000000c', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '44444444-6000-0000-0000-00000000000a', '22222222-6000-0000-0000-000000000008', 'Draft text.', 2, 50, 150, 'generated', '55555555-6000-0000-0000-00000000000b'),
  ('77777777-6000-0000-0000-00000000000d', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '44444444-6000-0000-0000-00000000000a', '33333333-6000-0000-0000-000000000009', 'More draft text.', 3, 50, 150, 'generated', '55555555-6000-0000-0000-00000000000f');

select 'subtopic_contents inserted OK, count' as result, count(*) from subtopic_contents where content_build_id = '44444444-6000-0000-0000-00000000000a';

-- ---------- Test 4: User A inserts a compliance-change row, edits content while draft ----------
\echo ''
\echo '=== TEST 4: User A inserts content_compliance_changes and edits subtopic_contents while draft (expect success) ==='
insert into content_compliance_changes (id, workspace_id, project_id, content_generation_id, subtopic_content_id, original_text, rewritten_text, reason, risk_category, detected_by) values
  ('88888888-6000-0000-0000-00000000000e', 'aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '55555555-6000-0000-0000-00000000000b', '66666666-6000-0000-0000-00000000000c', 'This cures everything.', 'This may help with some things.', 'Original implied a guaranteed cure.', 'unsupported_claim', 'ai_judgment');

update subtopic_contents set body = 'Hand-edited draft text.', is_edited = true where id = '66666666-6000-0000-0000-00000000000c';

select 'compliance change + edit OK, body' as result, body from subtopic_contents where id = '66666666-6000-0000-0000-00000000000c';

-- ---------- Test 5: confirm the content build ----------
\echo ''
\echo '=== TEST 5: User A confirms content_builds (expect success) ==='
update content_builds set status = 'confirmed', confirmed_at = now(), confirmed_by = '99999999-9999-9999-9999-999999999993' where id = '44444444-6000-0000-0000-00000000000a';
select 'confirmed OK' as result, status from content_builds where id = '44444444-6000-0000-0000-00000000000a';

-- ---------- Test 6: insert/update on subtopic_contents rejected while confirmed ----------
\echo ''
\echo '=== TEST 6: insert/update on subtopic_contents rejected while content_builds is confirmed (no trigger, RLS subquery only) ==='
do $$
begin
  insert into subtopic_contents (workspace_id, project_id, content_build_id, subtopic_id, body, target_word_min, target_word_max)
  values ('aaaaaaaa-6000-0000-0000-000000000001', 'cccccccc-6000-0000-0000-000000000003', '44444444-6000-0000-0000-00000000000a', '22222222-6000-0000-0000-000000000008', 'Sneaky insert', 50, 150);
  raise exception 'TEST 6a FAILED: insert while confirmed was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 6a PASSED (insert rejected) — %', sqlerrm;
    else raise exception 'TEST 6a FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- Blocked UPDATE's USING clause silently filters the row out (no exception) — same
-- reasoning already established and fixed for migration 0005's equivalent test.
update subtopic_contents set body = 'Sneaky edit' where id = '66666666-6000-0000-0000-00000000000c';
select
  case when body = 'Hand-edited draft text.' then 'TEST 6b PASSED (update silently blocked, body unchanged)'
       else 'TEST 6b FAILED: body = ' || body
  end as result
from subtopic_contents where id = '66666666-6000-0000-0000-00000000000c';

-- ---------- Test 7: THE KEY NEW CLAIM — delete cascades even while content_builds is confirmed ----------
\echo ''
\echo '=== TEST 7: subtopics DELETE (Step 7, list unlocked) cascades to subtopic_contents even though content_builds (Step 8) is independently CONFIRMED ==='
-- Unlock the subtopic_lists row (Step 7's own lock) so its own delete policy allows
-- this — content_builds stays CONFIRMED throughout, that's the point being tested.
update subtopic_lists set status = 'draft', confirmed_at = null, confirmed_by = null where id = '11111111-6000-0000-0000-000000000007';

delete from subtopics where id = '33333333-6000-0000-0000-000000000009';

select
  case when count(*) = 0 then 'TEST 7 PASSED (cascade succeeded — subtopic_contents workspace-gated delete policy allowed it despite content_builds being confirmed)'
       else 'TEST 7 FAILED: orphaned subtopic_contents row still present, count = ' || count(*)
  end as result
from subtopic_contents where id = '77777777-6000-0000-0000-00000000000d';

-- The generation log row for the DELETED subtopic must SURVIVE (subtopic_id -> on
-- delete set null), same precedent as subtopic_generations.target_subtopic_id.
select
  case when count(*) = 1 and (select subtopic_id from content_generations where id = '55555555-6000-0000-0000-00000000000f') is null
       then 'TEST 7b PASSED (generation log row survives, subtopic_id nulled out)'
       else 'TEST 7b FAILED'
  end as result
from content_generations where id = '55555555-6000-0000-0000-00000000000f';

-- ---------- Test 8: unlock content_builds, then the same edit succeeds ----------
\echo ''
\echo '=== TEST 8: User A unlocks content_builds, then an edit succeeds (lock is reversible) ==='
update content_builds set status = 'draft', confirmed_at = null, confirmed_by = null where id = '44444444-6000-0000-0000-00000000000a';
update subtopic_contents set body = 'Now editable again.' where id = '66666666-6000-0000-0000-00000000000c';
select 'post-unlock edit OK' as result, body from subtopic_contents where id = '66666666-6000-0000-0000-00000000000c';

reset role;
reset request.jwt.claims;

-- ---------- Test 9: User B isolation ----------
\echo ''
\echo '=== TEST 9: User B queries all four tables (expect ZERO rows) ==='
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999994","role":"authenticated"}';

select 'content_builds' as t, count(*) from content_builds
union all select 'content_generations', count(*) from content_generations
union all select 'subtopic_contents', count(*) from subtopic_contents
union all select 'content_compliance_changes', count(*) from content_compliance_changes;

-- ---------- Test 10: cross-workspace spoofing — own workspace_id, foreign content_build_id ----------
\echo ''
\echo '=== TEST 10: User B inserts subtopic_contents with workspace_id=B but content_build_id pointing at Workspace A''s build (expect rejection) ==='
do $$
begin
  insert into subtopic_contents (workspace_id, project_id, content_build_id, subtopic_id, body, target_word_min, target_word_max)
  values ('bbbbbbbb-6000-0000-0000-000000000002', 'cccccccc-6000-0000-0000-000000000003', '44444444-6000-0000-0000-00000000000a', '22222222-6000-0000-0000-000000000008', 'Spoofed insert', 50, 150);
  raise exception 'TEST 10 FAILED: cross-workspace spoofed insert was NOT rejected';
exception
  when others then
    if sqlerrm like '%row-level security policy%' then raise notice 'TEST 10 PASSED — %', sqlerrm;
    else raise exception 'TEST 10 FAILED unexpectedly: %', sqlerrm; end if;
end $$;

-- ---------- Test 11: content_generations / content_compliance_changes have no update grant ----------
\echo ''
\echo '=== TEST 11: UPDATE on content_generations and content_compliance_changes (expect permission denied — no grant exists) ==='
reset role;
reset request.jwt.claims;
set role authenticated;
set request.jwt.claims to '{"sub":"99999999-9999-9999-9999-999999999993","role":"authenticated"}';
do $$
begin
  update content_generations set generation_status = 'failed_blocked' where id = '55555555-6000-0000-0000-00000000000b';
  raise exception 'TEST 11a FAILED: update on content_generations succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then raise notice 'TEST 11a PASSED — %', sqlerrm;
    else raise exception 'TEST 11a FAILED unexpectedly: %', sqlerrm; end if;
end $$;

do $$
begin
  update content_compliance_changes set reason = 'sneaky' where id = '88888888-6000-0000-0000-00000000000e';
  raise exception 'TEST 11b FAILED: update on content_compliance_changes succeeded but should have been denied at the grant level';
exception
  when others then
    if sqlerrm like '%permission denied for table%' then raise notice 'TEST 11b PASSED — %', sqlerrm;
    else raise exception 'TEST 11b FAILED unexpectedly: %', sqlerrm; end if;
end $$;
