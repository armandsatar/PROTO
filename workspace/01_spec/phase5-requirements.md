# PROTO — Phase 5 Technical Requirements: Step 7 (Subtopic Generation)

**Scope:** Spec Step 7 only — PROTO generates a list of subtopics for the confirmed title, sized and shaped by the confirmed format and the confirmed transformation map, which the user can reorder, edit, delete, add to, and regenerate before confirming it as a stable input. Consumes the confirmed title (Steps 1–3), confirmed format (Step 4), and confirmed transformation map (Step 6). Does **not** cover Step 8 (Content Builder) or anything downstream (Design, Copywriting, Export, Pricing, Bundles) — those are future phases and are intentionally absent from this document. Lead magnet suitability (Step 5) is consumed nowhere in this document — see §3.1 for why.

**Status: DRAFT — under review, partially confirmed.** Items (b) and 11 (target-count table, and the workbook+tracker reinterpretation) were confirmed by Arman on 2026-08-23 after a closer look, including a real-research follow-up on the quiz range specifically. The remaining items in §5 are still proposed defaults, not yet reviewed. This document mirrors the structure of `phase4-requirements.md` (explicit shape determination in §0 before any schema is committed to) more than `phase2/3-requirements.md`, because — as with Step 6 — Step 7's actual shape turned out not to be the recommend/confirm pattern. It also introduces a genuinely fourth shape not seen in Phases 1–4 — see §0.

---

## 0. Shape Determination — Why This Is Neither Recommend/Confirm Nor a Single Editable Record

### 0.1 What the user needs to be able to do

Before Step 8 can trust a subtopic list as a stable input (it will fetch/write real researched content per subtopic — an expensive operation not worth doing against a list that's still being shaped), the user needs to:

| Capability | Required? | Why |
|---|---|---|
| View the AI-generated list | Yes | Baseline |
| Reorder subtopics | **Yes** | Sequence is the table of contents — a tracker's categories, a workbook's worksheet order, an ebook's chapter order all carry real meaning the AI's first-pass ordering may not get right |
| Delete an individual subtopic | **Yes** | AI may over-generate, generate an off-angle subtopic, or generate something redundant with another item |
| Add a manual subtopic | **Yes** | User may want to cover something specific to their expertise/audience that the AI didn't surface |
| Edit an individual subtopic's title/description | **Yes** | Same rationale as Step 6's field-level editing — a user who dislikes the AI's wording rewrites it, they don't pick a different enum value |
| Regenerate the whole list | **Yes** | Direct analog of Step 6's Regenerate — start over with a fresh AI pass |
| Regenerate just one subtopic in place | **Proposed, in scope — see §5(c)** | Not strictly required (delete + manual re-add covers the same functional ground) but materially better UX once the per-row shape below is chosen anyway, since it's a small marginal addition, not a new shape |

### 0.2 Comparing against the three shapes already in this codebase

| Property | Phase 2/3 (recommend/confirm) | Phase 4 (editable single record) | Step 7 |
|---|---|---|---|
| Output space | Small fixed enum | Fixed ~10 named fields | **Variable-length list, count itself AI-determined within a range** |
| What "override" / "edit" means | Pick a different point in the same finite space | Rewrite one of ~10 known fields | Rewrite, reorder, delete, or add items **in an unbounded collection** |
| Cardinality of the thing being edited | 1 recommendation row | 1 content row | **N independent items, N variable** |
| Natural granular action | Accept / pick-alternate | Field-by-field rewrite | **Item-by-item add/remove/reorder/rewrite** |

Step 7 fails the Phase 2/3 test for the same reason Step 6 did (no enumerable option space to pick among). It also fails the Phase 4 test on a new axis: Phase 4's 10 fields are a **fixed, known set of named slots** — `dim_emotional_before` is always exactly one field, editable via one UPDATE on one row. Step 7's content is a **collection whose membership itself changes** (items added, removed, reordered) — there is no fixed slot named "subtopic 7" that reliably means the same thing across edits the way `dim_emotional_before` always does.

### 0.3 The concrete data-layer tradeoff: JSON blob array vs. real per-row table

The brief's own framing is correct and is worked through explicitly here, not assumed:

| Concern | Single row, `subtopics jsonb` array column | Real child table (`subtopics`, 1 row per item) |
|---|---|---|
| Reorder one item | Read-modify-write the entire array; no atomic single-item update | Single `UPDATE ... SET display_order` on one row |
| Delete one item | Read-modify-write the entire array minus one element | Single `DELETE` on one row |
| Add a manual item | Read-modify-write the entire array plus one element | Single `INSERT` |
| Edit one item's title/description | `jsonb_set` path update is *possible* but awkward, and concurrent edits to two different array elements can silently clobber each other on a naive read-modify-write | Native row-level `UPDATE`, no clobbering risk |
| Per-item provenance (`is_edited`, `source`, who/when) | Must nest a metadata object inside every array element — at which point each element is already a mini-record, and the blob design has given up its only real simplicity advantage | Native columns, first-class |
| Validating a single item (non-empty title, valid depth enum) via a trigger | The BEFORE UPDATE trigger pattern Step 6 used (OLD vs. NEW row comparison) has no clean way to validate *one array element* without the trigger re-implementing JSON diffing itself | Trigger/RLS operates on one row = one item, exactly the case Postgres triggers are built for |
| "Lock the whole list when confirmed" | Easy — it's one row | Still easy — an RLS policy or trigger on the child table checks the parent list's `status`, the same join-based pattern already needed for every other child-table permission check in this app (e.g. `title_candidates` scoped to a `research_run`) |

The blob's one theoretical advantage (whole-thing locking is a one-row operation) is not actually an advantage once compared to the child-table equivalent, which is a standard join-based RLS check PROTO already relies on elsewhere. Every other row in this table — which is every row that matters, given reorder/delete/add-individual-items is an explicit, stated requirement — favors a real per-row table.

**Conclusion: `subtopics` is a real child table, one row per item.** This is a genuinely new shape for this codebase: a **live, mutable, ordered collection**, not a single recommendation row and not a single content row. It borrows Phase 4's *conceptual* split (an append-only generation log + a live mutable content surface) but implements the "live content" side as N rows instead of 1, because that's what individual-item operations structurally require. It also needs a small **header/metadata row** (§1.2) to hold list-level state (status, staleness snapshots, regenerate count) that has no natural home on either the log table (append-only, not the current state) or the N-row collection (there's no single row to hang list-level status on without duplicating it N times). This three-table shape is new — flagged in §5(a) as the load-bearing call this whole document depends on, same as Phase 4's §0 conclusion was for that document.

---

## 1. Data Model

### 1.1 Three tables

| Table | Cardinality | Mutability | Role |
|---|---|---|---|
| `subtopic_generations` | Many per project (one per AI generation attempt — whole-list or single-item) | **Immutable once completed** — append-only, direct analog of `research_runs` / `transformation_map_generations` | Audit/cost-tracking log of every AI attempt and exactly what it produced |
| `subtopic_lists` | Exactly 1 per project (1:1) | Mutable header only — holds no subtopic content itself | List-level status, lock state, staleness snapshots, regenerate count. New shape — no Phase 1–4 table plays this exact role |
| `subtopics` | Many per project (0..N, N variable), children of `subtopic_lists` | **Mutable per row** — the live, user-editable collection | What Step 8 will eventually read. The new shape this whole document is built around |

All three carry `workspace_id` per the established multi-tenancy pattern (§1.1 of `phase1-requirements.md`) — RLS gates every read/write on workspace membership, no table-specific exception.

### 1.2 `subtopic_lists` (header/metadata, 1:1 with `projects`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects, **unique**) | no | 1:1, same shape as `title_ideas.project_id` / `transformation_maps.project_id` |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Staleness snapshot #1 — see §4 |
| `format_recommendation_id` | uuid (fk → format_recommendations) | no | Snapshot of the **confirmed** Step 4 row — staleness snapshot #2, direct analog of Step 5's pattern (Phase 3 §1.2) |
| `transformation_map_snapshot_at` | timestamptz | no | Snapshot of `transformation_maps.updated_at` at generation time — staleness snapshot #3. **New detection mechanism vs. Phases 2–4**: title/format staleness compares FK pointers (a superseded-row model), but `transformation_maps` is a single mutable row with no version/pointer to compare — a timestamp snapshot is the natural analog. See §4. |
| `confirmed_format` | enum `format_type` | no | Denormalized copy of the format at generation time — avoids a join every time the target-count range needs re-displaying |
| `target_count_min` / `target_count_max` | int | no | The computed target range at generation time, per §2's table — persisted so the guardrail (§3.4) and the UI ("aim for 8–12") both reference the same frozen values, not a value that could silently drift if §2's table is later retuned |
| `status` | enum `transformation_map_status` (**reused** — see §1.6) | no | `draft` / `confirmed` |
| `confirmed_at` / `confirmed_by` | timestamptz / uuid (fk → users) | yes | Null until confirmed |
| `regenerate_count` | int | no | default 0 — drives the soft cap (§1.7), whole-list regenerations only, not single-item ones (see §1.7) |
| `current_generation_id` | uuid (fk → subtopic_generations) | yes | Points at the latest **whole-list** generation attempt, for "Attempt N of 5" UI |
| `created_at` / `updated_at` | timestamptz | no | |

### 1.3 `subtopics` (the live collection — the new shape)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects) | no | Denormalized for simpler RLS/query, alongside... |
| `subtopic_list_id` | uuid (fk → subtopic_lists) | no | ...the real parent relationship |
| `title` | text | no | Subtopic title (chapter/module/category name — meaning varies by format, see §2) |
| `description` | text | no | Short description of what this subtopic covers — the brief Step 8 will eventually expand into full content |
| `display_order` | int | no | 1..N, unique per `subtopic_list_id`. Drag-reorder mutates this directly |
| `depth` | enum `subtopic_depth` | no | `shallow` / `medium` / `deep` — see §2.3 for what this means and why it's persisted here rather than left to Step 8 |
| `source` | enum `subtopic_source` | no | `ai_generated` / `manual` / `ai_regenerated` — provenance |
| `source_generation_id` | uuid (fk → subtopic_generations) | yes | Which generation attempt produced this row's current content. Null for `manual` rows (never AI-originated) |
| `is_edited` | boolean | no | default `false`. Set `true` on any manual title/description/depth edit since the row's last (re)generation. **Only meaningful for `ai_generated`/`ai_regenerated` rows** — a `manual` row has no "original AI content" to have diverged from, so it stays `false` permanently by definition, not tracked as an edit |
| `last_edited_at` / `last_edited_by` | timestamptz / uuid (fk → users) | yes | Null until first manual edit |
| `created_at` / `updated_at` | timestamptz | no | |

**No `dimension_tag` column** — deliberately not modeling which of Step 6's four transformation-map dimensions a given subtopic addresses. Worked through explicitly: the map is a real generation *input* (§3.1) and does shape subtopic coverage, but forcing a per-subtopic 1:1 tag to one of 4 dimensions would misrepresent reality (a tracker category like "Water Intake" often maps cleanly to none of emotional/practical/identity/pain-point — it's simply a functional bucket; an ebook chapter might legitimately touch two dimensions at once). The map's influence is holistic ("shape the overall arc and framing of subtopics to service this transformation"), not a per-item checklist crosswalk, and Step 8 can read the transformation map directly rather than needing it pre-summarized per subtopic. Modeling the tag would add guardrail validation surface (enforcing valid tag values, handling multi-tag or no-tag cases) for a field with no clear downstream consumer. Flagged in §5 as a considered-and-rejected addition, same treatment Phase 4 gave its rejected 5th dimension.

### 1.4 `subtopic_generations` (append-only log)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | |
| `project_id` | uuid (fk → projects) | no | |
| `subtopic_list_id` | uuid (fk → subtopic_lists) | no | |
| `generation_number` | int | no | Sequential per list (1, 2, 3…), whole-list attempts only — for "Attempt N of 5" display |
| `generation_type` | enum `subtopic_generation_type` | no | `full_list` / `single_item` — new enum, see §1.6 |
| `target_subtopic_id` | uuid (fk → subtopics) | yes | Set only when `generation_type = 'single_item'` — identifies which row this attempt regenerated |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Snapshot, same value as the parent list's at time of this attempt |
| `format_recommendation_id` | uuid (fk → format_recommendations) | no | Snapshot |
| `transformation_map_snapshot_at` | timestamptz | no | Snapshot |
| `inputs_snapshot` | jsonb | no | Full frozen inputs: title text, Step 1 rationale, confirmed format + delivery mode, transformation map's 10 fields, demand/competition signal detail, target count range (§3.1) |
| `output_snapshot` | jsonb | no (on success) | The AI's returned array (`full_list`) or single object (`single_item`), **after guardrail correction, before any subsequent user hand-editing** — the frozen "what the AI actually said" record, distinct from the live `subtopics` rows which can diverge from it via edits |
| `model` | text | no | e.g. `openai/gpt-oss-120b` |
| `generation_status` | enum `subtopic_generation_status` | no | `succeeded` / `succeeded_below_target` / `failed_fallback` / `failed_blocked` — **new enum, one more value than precedent's `generation_status`**, see §3.4 |
| `error_detail` | text | yes | Sanitized only, per Section 2's no-secrets-in-errors rule |
| `created_at` / `completed_at` | timestamptz | created_at no, completed_at yes | |

### 1.5 `projects` Table Extension

No new pointer column needed on `projects` — `subtopic_lists` is 1:1 via `project_id unique`, same reasoning Phase 4 used for `transformation_maps` (§1.4 of that document). Only `project_status` is extended:

| Status | Meaning |
|---|---|
| `transformation_map_confirmed` | (existing) Step 6 done, Step 7 not yet started |
| `subtopic_generating` | **New.** Step 7 in progress — `subtopic_lists` row exists in `draft` status, `subtopics` rows editable, awaiting explicit confirm. Mirrors `transformation_mapping`'s open-ended-editing transient state, not the brief accept-or-override window of Steps 4/5. |
| `subtopics_confirmed` | **New.** Terminal state for this phase — user explicitly confirmed the list is ready. |

Confirmation is explicit and required to leave `subtopic_generating`, same "no silent auto-accept" principle carried through every phase.

### 1.6 Enums

| Enum | Values | Status |
|---|---|---|
| `subtopic_depth` | `shallow`, `medium`, `deep` | New |
| `subtopic_source` | `ai_generated`, `manual`, `ai_regenerated` | New |
| `subtopic_generation_type` | `full_list`, `single_item` | New |
| `subtopic_generation_status` | `succeeded`, `succeeded_below_target`, `failed_fallback`, `failed_blocked` | New — extends the precedent 3-value set with `succeeded_below_target`, a real outcome that only a variable-length list can hit (§3.4) |
| `transformation_map_status` | `draft`, `confirmed` | **Reused from Phase 4** — `subtopic_lists.status` uses the identical value set, no new type needed, same "reuse across phases when values match" convention Phase 3 established for `confidence_level`/`generation_status`/`recommendation_status` |
| `format_type` | (existing) | Reused, for `subtopic_lists.confirmed_format` |

### 1.7 Action Behaviors — Explicit, Mirrors Phase 4 §1.6

| Action | What happens | Which table(s) change |
|---|---|---|
| **First entry** (project reaches `transformation_map_confirmed`) | Auto-fires the AI call (no manual "Generate" button — mirrors Steps 4/5/6). Computes `target_count_min/max` deterministically (§3.2) from confirmed format, then generates. Inserts `subtopic_generations` row #1 (`generation_type='full_list'`). Inserts `subtopic_lists` row (`status='draft'`). Inserts N `subtopics` rows (`source='ai_generated'`, `is_edited=false`, `display_order` 1..N). `projects.status` → `subtopic_generating`. | All three, insert |
| **Reorder** (drag, `draft` status only) | `UPDATE subtopics SET display_order = ...` for affected rows. No `is_edited` change — reordering is not content editing. | `subtopics` only |
| **Delete one subtopic** (`draft` status only) | `DELETE` the row. Remaining rows' `display_order` re-sequenced (or left with gaps and re-sequenced at render time — implementation detail, not a requirements question). | `subtopics` only |
| **Manual add** (`draft` status only) | `INSERT` new row: `source='manual'`, `source_generation_id=null`, `is_edited=false`, `display_order = max+1` (appended, then draggable). No `subtopic_generations` row — no AI call involved. | `subtopics` only |
| **Edit title/description/depth** (`draft` status only) | Direct `UPDATE` on the row. Sets `is_edited=true` (unless `source='manual'`, which stays `false` per §1.3), `last_edited_at`/`last_edited_by`. | `subtopics` only |
| **Regenerate one subtopic in place** (`draft` status only — **proposed in-scope, §5(c)**) | If the target row's `is_edited=true` or `source='manual'`, requires the explicit-acknowledgment orchestration pattern (Section 2's precedent, direct analog of Phase 4's Regenerate-over-hand-edits gate) before overwriting. Fires a narrower AI call (§3.3) scoped to one item, informed by the full current list (to avoid duplicating a sibling). Inserts `subtopic_generations` row (`generation_type='single_item'`, `target_subtopic_id` set). On success: overwrites the row's `title`/`description`/`depth`, `source='ai_regenerated'`, `source_generation_id` = new log row, `is_edited` reset `false`. **Does not** touch `regenerate_count` (§1.7's list-level cap is whole-list only) and does not require unlocking the whole list. | Both `subtopics` and `subtopic_generations` |
| **Regenerate whole list** (`draft` status only) | If **any** row has `is_edited=true` or `source` in (`manual`, `ai_regenerated`), requires the explicit-acknowledgment orchestration pattern before proceeding (this action is destructive across the entire collection, a strictly bigger blast radius than Phase 4's single-record Regenerate). Fires a fresh full-list AI call. Inserts `subtopic_generations` row (`generation_type='full_list'`, `generation_number`+1). **Deletes all current `subtopics` rows for this list**, inserts N new ones from the new output (`source='ai_generated'`, `is_edited=false`). Recomputes `target_count_min/max` (safety refresh in case format changed since last run — though that would already have surfaced as a staleness banner, §4). `subtopic_lists.current_generation_id` updated, `regenerate_count`+1. **Soft cap: 5 whole-list regenerations per project** — same number as every prior phase, for consistency. Old row content is not preserved in the live table (mirrors Phase 4: overwritten in place), but is fully recoverable from `subtopic_generations.output_snapshot` for audit. | All three |
| **Confirm** (`draft` status only) | Sets `subtopic_lists.status='confirmed'`, `confirmed_at`/`confirmed_by`. `projects.status` → `subtopics_confirmed`. All `subtopics` rows become read-only in the UI, enforced via RLS/trigger checking the parent list's status (§0.3) — not schema-immutable at the column level. | `subtopic_lists` only |
| **Unlock / "Edit List"** (only available in `subtopics_confirmed`) | Sets `subtopic_lists.status` back to `draft`, clears `confirmed_at`/`confirmed_by`. `projects.status` reverts `subtopics_confirmed` → `subtopic_generating`. **Content preserved**, not cleared — direct analog of Phase 4's Unlock behavior, same justification (the locked content is worth keeping, the user is resuming, not restarting). | `subtopic_lists` only |
| **Upstream title / format / transformation-map change** | Soft staleness flag only — see §4. No table is force-mutated. | None (UI-level flag, computed at read time) |

---

## 2. What "Count and Depth Driven by Format + Map" Concretely Means

### 2.1 No authoritative doctrine exists for exact counts — flagged, not hidden

Unlike Step 6's schema, which could be grounded in an established framework (StoryBrand, BAB), a targeted check for a real "correct number of chapters/modules/tracker categories" doctrine turned up none — published guidance on digital-workbook and ebook structure explicitly says there is no fixed ideal count, it depends on scope and audience, and Notion tracker/dashboard best-practice sources actively warn *against* over-categorizing (simpler trackers have better follow-through than complex ones). See sources at the end of this document. **The table below is therefore a proposed heuristic default informed by that general direction (trackers stay lean; workbooks/ebooks scale with scope), not a research-grounded fact the way Step 6's dimension schema was** — flagged explicitly in §5(b) as needing Arman's judgment call more than his confirmation of a researched fact.

### 2.2 What a "subtopic" concretely represents, per format

The unit of a "subtopic" is not the same thing across formats — defined explicitly here since the source spec doesn't:

| Format | Subtopic unit | Target count range | Rationale |
|---|---|---|---|
| **Tracker** | One trackable category/section (a sheet, tab, database view, or log category) | **5–8** | Tracker research above warns that too many categories hurts real-world follow-through; a tracker's value is its narrowness |
| **Workbook** | One worksheet / exercise module covering a distinct sub-skill or process step | **10–15** | Most modular, most scalable format — this range is where the spec's own "~15-ish" anchor lands (reinterpreted, see §2.4) |
| **Ebook** | One chapter/section of the narrative or reference arc | **8–12** | Enough for a full arc without becoming unwieldy; slightly lower ceiling than workbook since ebook "sections" typically carry more prose per unit than a worksheet |
| **Quiz** | One possible outcome/result type the quiz sorts the taker into (which questions will later group under, Step 8's concern) | **4–6** | Confirmed with real, cited sources (2026-08-23 follow-up — the other three ranges' sources address structure/length generally; this range originally had none). Real quiz-building practice (Interact, ProProfs) designs outcomes-first and builds questions backward from them, not the other way around — which is why the subtopic unit here is redefined from "dimension/theme being assessed" to "outcome/result type," matching how these products actually get built. Multiple sources converge on 3–6 result categories as "manageable for both builder and participant," and on 6–10 total questions for engagement-focused quizzes (as opposed to 15–30+ for hiring/coaching-style deep assessments, which is not PROTO's use case). 4–6 sits inside the 3–6 finding — the original heuristic held up under real research, not overturned by it. |

`delivery_mode` (printable/fillable) does **not** modulate the count target — it's a delivery-mechanism choice, not a content-scope choice, and changing it doesn't change how many distinct things the product covers. **Proposed:** it also does not modulate `depth` in v1, despite a plausible argument that fillable/interactive formats could carry more of the "work" per item and need shallower written content — kept out for v1 to avoid a formula with more variables than there's real signal to justify. Flagged for Arman's call in §5.

Demand/competition signals are **not** used to modulate count in v1, for the same reason — they're included as generation context (§3.1) to flavor *which* angles get covered, not to change *how many* subtopics are generated.

### 2.3 Depth — persisted as a coarse per-subtopic tag, not left emergent to Step 8

**Considered and rejected: depth as purely an emergent Step 8 property** (i.e., Step 7 persists nothing, Step 8 decides how much to write per subtopic when it gets there). Rejected because it discards real signal: the AI generating the subtopic list already has a view on which items are the core deep-dive vs. a brief aside (e.g. an ebook's introduction and conclusion chapters are legitimately shallower than its core "how-to" chapters) — if Step 7 doesn't capture that judgment, Step 8 is forced to either treat every subtopic within a format identically (losing real nuance the AI already computed once) or re-derive it from scratch with no more context than Step 7 had.

**Considered and rejected: a raw estimated-word-count integer per subtopic**, instead of a 3-tier tag. Rejected as false precision — Step 7 doesn't know Step 8's eventual writing voice/style, so a specific number ("847 words") implies a commitment neither this step nor Step 8 can actually honor. A coarse tag is enough signal for relative prioritization without overcommitting to a figure that's really a guess.

**Decision: `depth` is a per-subtopic enum (`shallow`/`medium`/`deep`), assigned by the AI at generation time, user-editable like any other field (editing it sets `is_edited=true`).** Its meaning is documented here for Step 8's future benefit — Step 7 itself does not consume or enforce these ranges, they're purely informational:

| Tag | Rough word-count guidance (for Step 8, not enforced here) |
|---|---|
| `shallow` | ~100–250 words |
| `medium` | ~250–600 words |
| `deep` | ~600–1200 words |

### 2.4 Note on the spec's "~15-ish for workbook+tracker combos" line

**Resolved by Arman 2026-08-23.** This was not loose phrasing — "workbook + tracker combo" was one of Arman's original example format types from the pre-build spec discussion, named alongside tracker/workbook/ebook as a distinct product type. It did not carry forward into Step 4's four locked formats (tracker/workbook/ebook/quiz); this appears to have been an oversight during Phase 2, not a deliberate cut.

**Decision, confirmed, not just proposed:** Step 7 proceeds with **Reading A** — the "~15-ish" anchor is reassigned to **workbook alone**, and the "combo" wording is dropped from this document, so as not to block Step 7 on a Step 4 schema change. This is a deliberate, acknowledged simplification, not a claim that "combo" was always meant to mean "workbook."

**Logged as a future-phase open item, not decided or built here:** whether a combo/bundled format type (e.g. workbook + tracker shipped as one product) should be added as a fifth `format_type` option belongs to Step 4, not Step 7, and is out of scope for this build. See `docs/PROTO-product-spec.md` §6 (Open Items / Not Yet Decided) for the durable entry. If added later, a combo format would need its own Step 4 build work and its own subtopic-count research — the workbook range above should **not** be assumed to transfer to it; a bundled product's subtopic structure (workbook modules + tracker categories, likely in two distinct sub-collections) is a different shape question than either format alone.

---

## 3. Generation Logic Requirements

### 3.1 Inputs

| Input | Source | Included? | Why |
|---|---|---|---|
| Selected title text | `title_candidates.candidate_text` | Yes | Same anchor role as every prior phase |
| Step 1 rationale | `title_ideas.rationale` | Yes | Audience/intent context that shapes which subtopics matter most |
| **Confirmed format + confirmed delivery mode** | `format_recommendations` (confirmed row) | **Yes — genuinely required, unlike Step 6** | Format directly determines the target count range (§2.2) and the *unit* a subtopic represents (chapter vs. worksheet vs. tracker category vs. quiz dimension) — this is the one input Step 6 excluded but Step 7 cannot, since format-driven sizing is the spec's explicit instruction for this step |
| **Transformation map content** (all 10 fields) | `transformation_maps` (live row) | **Yes — genuinely required, unlike Step 5** | The spec states the map "shapes what the subtopics need to cover" — Step 7 is the actual consumer of that shaping, not a sibling input like it was for Step 6 (which only consumed the title). The map's before/after content (emotional, practical, identity, pain-point) informs which angles the subtopic list should hit to service that specific transformation, not a generic treatment of the topic |
| Demand score + `demand_signal_detail` | `title_candidates` | Yes — secondary | Same low-weight treatment as Steps 4–6: can flavor which angles feel highest-value, doesn't change structure |
| Competition score + `competition_signal_detail` | `title_candidates` | Yes — secondary | A crowded niche can push toward subtopics that differentiate rather than cover the obvious basics, consistent with Steps 4–6's treatment |
| **Confirmed lead magnet decision** (`lead_magnet_recommendations`) | — | **No — deliberately excluded** | The lead magnet, if any, is a *separate* product with its own (unscoped, future) subtopic/structure needs. Whether a lead magnet exists or what type it is has no bearing on how the *paid* product's own subtopics should be structured — same class of exclusion Step 6 applied to format/lead-magnet, applied here in the mirror direction |
| Other unselected title candidates | `title_candidates` (not selected) | No | Same exclusion logic as every prior phase |

### 3.2 Deterministic Target-Count Computation — Not Left to the AI to Decide From Scratch

Per §2.2's table, `target_count_min`/`target_count_max` are computed **in code, deterministically, before the AI call fires** — the AI is not asked "how many subtopics should this have," it is told "generate between X and Y." This mirrors the "deterministic rule, not a judgment call" posture Phases 2/3 applied to hard business rules (ebook→null delivery mode, not-suitable→null type), applied here to the one part of this step's output that has an actual hard constraint: the count range.

### 3.3 Generation Approach — Two Call Shapes

**Whole-list generation (`full_list`)** — single Groq structured JSON-mode call (`openai/gpt-oss-120b`, same connector/pattern as every prior phase), receiving the §3.1 inputs plus the computed target range, returning a JSON array of `{title, description, depth}` objects.

**Single-item regeneration (`single_item`)** — **proposed in scope, §5(c)** — a second, narrower Groq call, receiving the same §3.1 inputs **plus the full current list of sibling subtopic titles** (so the model can avoid re-generating something that duplicates or near-duplicates an existing item) and an optional free-text hint field (e.g. "make this one more beginner-friendly" — proposed, low priority, mirrors the optional `override_reason` treatment prior phases gave low-priority optional fields). Returns a single `{title, description, depth}` object. This is a distinct, smaller prompt — not the whole-list prompt called with N=1 — because the "don't duplicate a sibling" constraint only exists in this call shape.

### 3.4 Guardrail Layer

**Whole-list guardrail (`full_list`)** — deterministic checks before persisting, same "never trust AI blindly on hard rules" posture as Phases 2/3, but here the hard rule is the count range rather than a taxonomy value:

| # | Rule | On failure |
|---|---|---|
| 1 | Response must be a JSON array; every item must have non-empty `title`, non-empty `description` (min length **proposed 20 characters**, mirroring Step 6's min-length rule at a smaller number since these are shorter fields), and a valid `depth` enum value | Reject/retry once |
| 2 | Array length must fall within `[target_count_min, target_count_max]` | Reject/retry once. If still over-max after retry: **truncate to `target_count_max`**, dropping the tail of the returned order (the model's own ordering is treated as roughly priority-descending, so the tail is the most defensible thing to drop). If still under-min after retry: **accept as-is**, persist with `generation_status = 'succeeded_below_target'` — see rationale below, this is not force-fixable |
| 3 | No duplicate or near-duplicate titles (exact match after normalizing case/whitespace/punctuation; near-duplicate via a simple similarity threshold — **proposed word-overlap ratio > 0.8**, a tunable default in the same spirit as Phase 1's scoring bucket thresholds) | Reject/retry once. If duplicates persist after retry, drop the later duplicate and accept — not worth a third call over one redundant item |

**Single-item guardrail (`single_item`)** — same non-empty/min-length/valid-enum check (rule 1), plus: the returned title must not duplicate or near-duplicate **any existing sibling subtopic's title** (checked against the live current list at call time, not just the original generation's output) — reject/retry once, same duplicate-detection logic as rule 3 above, applied against a different comparison set.

**Why `succeeded_below_target` exists as its own outcome, not folded into `failed_fallback`:** this is a genuinely new outcome variable-length lists can hit that fixed-schema phases never could — the call didn't fail, the model just couldn't (or didn't) hit the floor. Treating it as a failure would be dishonest (there's real, valid content); treating it identically to a clean success hides a real gap the user should know about (a UI note: "PROTO generated fewer subtopics than the target range — consider adding a few more").

### 3.5 AI-Failure Fallback — Structural Honesty, Not a Fabricated Placeholder Count

Phase 6's fallback (labeled placeholder scaffolding across a *known, fixed* 10 fields) has no clean analog here, for the reason the brief anticipates: a fallback for a variable-length list would have to invent how many placeholder items to produce, with no basis for that number beyond "somewhere in the target range" — which is not actually knowable without the AI call that just failed.

**Proposed fallback, on retry-once also failing (`full_list` only — single-item failures are lower-stakes, see below):** persist the `subtopic_generations` row with `generation_status = 'failed_fallback'`, `output_snapshot = []`. **Insert zero `subtopics` rows.** `subtopic_lists` still enters `draft` status normally, still shows the computed `target_count_min`/`target_count_max` in the UI, with a banner: "PROTO couldn't generate subtopics automatically — add [target_count_min]–[target_count_max] manually using the + button below." The user is not blocked; they build the list entirely via the manual-add action (§1.7), same escape hatch that exists for every other action. This was weighed against inventing a small fixed placeholder count (e.g. always 3 generic stubs) and **rejected** — a fabricated count with no basis is a worse signal than an honest empty state with a clear target range to hand-fill toward, and avoids the awkwardness of the user having to first delete fake placeholders before adding real ones.

**Single-item failure fallback:** if a `single_item` regenerate call fails outright (retry-once exhausted), the target row's content is **left untouched** — no destructive effect, since nothing was overwritten. A toast/error surfaces; the user can retry, hand-edit instead, or leave it as-is. No `failed_fallback` scaffolding needed here since there's always pre-existing content on the row to fall back to by simply not changing it.

### 3.6 Output Contract (JSON)

```json
{
  "generation_type": "full_list",
  "target_count_min": 10,
  "target_count_max": 15,
  "subtopics": [
    {
      "title": "Setting Up Your Weekly Budget Foundation",
      "description": "Walks the reader through defining fixed vs. variable expenses and setting a baseline weekly number before any tracking begins.",
      "depth": "medium"
    },
    {
      "title": "Automating Recurring Bill Reminders",
      "description": "Covers how to flag recurring bills inside the workbook so nothing gets missed without manual re-checking every week.",
      "depth": "shallow"
    }
  ]
}
```

```json
{
  "generation_type": "single_item",
  "target_subtopic_id": "a1b2c3d4-...",
  "subtopic": {
    "title": "Building a 3-Month Emergency Buffer, Realistically",
    "description": "Reframes 'emergency fund' from an intimidating lump sum into a specific weekly buffer target sized to the reader's actual expenses.",
    "depth": "deep"
  }
}
```

- No `confidence`/`reasoning_signals` fields — same call as Phase 4 (§3.5 of that document): this output *is* the content, there's nothing to cite evidence for.

---

## 4. Staleness

**Three upstream dependencies — title, confirmed format, transformation map content — each justified independently, per the brief's ask not to assume uniform treatment.**

### 4.1 Does Step 7 actually depend on all three?

| Dependency | Does Step 7's *content* depend on it? | Why |
|---|---|---|
| Confirmed title | Yes | Baseline — every phase depends on this |
| Confirmed format | **Yes — new class of dependency vs. Step 6** | Format is a direct, deterministic input to the target count range (§2.2/§3.2) and the unit-meaning of a subtopic. A format change doesn't just change tone (as it might for the map); it changes the *correct number and kind* of items in the list |
| Transformation map content | **Yes — new class of dependency vs. Step 5** | The map "shapes what subtopics need to cover" and Step 7 is its actual consumer (not a sibling input the way it was for Step 5's format-only dependency) — a materially rewritten map means the existing subtopic list may no longer service the transformation it was generated against |

All three are real dependencies, not candidates for exclusion the way format/lead-magnet were excluded from Step 6 (§4 of `phase4-requirements.md`).

### 4.2 Hard vs. soft, per dependency

| Dependency | Treatment | Justification |
|---|---|---|
| Title change | **Soft** | By the time Step 7 exists, the subtopic list can represent substantial hand-curation — manual adds, deletions, reordering, rewritten descriptions across potentially 15 items. That's a materially larger authored-effort surface than Step 6's 10 fields, so the same "expensive to lose" argument Phase 4 made applies at least as strongly here. Hard cascade (Phase 2/3's default) would discard real user work for what's often a minor title wording change. |
| Confirmed format change | **Soft** | Even though format directly drives the *target count range*, an existing subtopic's individual content (its title/description) is often still conceptually portable across a format change — e.g. a tracker category and an ebook chapter can describe the same underlying concept at different granularity. Hard-clearing the whole list because the target range shifted from 5–8 to 8–12 would be a disproportionate response to what's fixable by the user adding a few more items. Soft treatment: banner shows the new target range, current count, and lets the user reconcile via the existing add/delete/regenerate actions — no forced redo. |
| Transformation map content change | **Soft** | Same authored-effort argument as title. A map edit (even a substantial one) doesn't necessarily invalidate every individual subtopic — many are functionally anchored to the topic itself, not to the specific wording of the map. Forcing a full redo on every map tweak (which, per Phase 4 §1.6, can happen freely and often during open-ended editing) would make hand-curating the subtopic list fragile against unrelated upstream editing. |

**All three land on soft, but for related-not-identical reasons** — title and map staleness both hinge on the authored-effort argument; format staleness hinges additionally on the "count range shift is user-fixable, not existentially content-invalidating" argument. This is a deliberate, full divergence from Phase 2/3's default-hard posture, extending Phase 4's precedent (which established soft treatment for one dependency) to three.

### 4.3 Detection and effect

| | Title / format | Transformation map |
|---|---|---|
| Detection | Lazy, on load/action — compare `subtopic_lists.title_candidate_id` vs. `projects.selected_candidate_id`, and `subtopic_lists.format_recommendation_id` vs. `projects.current_format_recommendation_id` | Lazy, on load/action — compare `subtopic_lists.transformation_map_snapshot_at` vs. `transformation_maps.updated_at`. **New comparison mechanism** — a timestamp, not an FK pointer, since `transformation_maps` has no supersede/versioning model to point at |
| Effect on stored content | None — `subtopics` rows untouched | None — `subtopics` rows untouched |
| Effect on `projects.status` | If `subtopics_confirmed`: reverts to `subtopic_generating` (re-confirmation required). If already `subtopic_generating`: no status change, banner only | Same |
| User's next step | Banner + choice: whole-list Regenerate, single-item Regenerate on affected items, or hand-edit | Same |

No eager push from Steps 4/6 into Step 7's code — same lazy, decoupled detection pattern established across every prior phase.

---

## 5. Decisions Locked / Open Questions

| # | Item | Status |
|---|---|---|
| **(a)** | **Shape: three-table live-collection model (`subtopic_generations` log + `subtopic_lists` header + `subtopics` child rows), not recommend/confirm, not a single editable record.** The load-bearing call this entire document depends on. See §0. | **PROPOSED — needs Arman's explicit confirmation before build starts** |
| **(b)** | **Target-count table per format (§2.2: tracker 5–8, workbook 10–15, ebook 8–12, quiz 4–6).** | **CONFIRMED by Arman 2026-08-23.** Quiz range was re-researched with real citations at his request (previously the only uncited number in the table — see §2.2) and held up under that research rather than changing. |
| **(c)** | **Single-item regenerate-in-place is proposed in scope for v1** (§0.1, §1.7, §3.3), on the reasoning that it's a small marginal addition once the per-row shape exists, not a new shape of its own — but it is not strictly required (delete + manual re-add covers the same ground). | **PROPOSED — needs Arman's confirmation whether in scope now or deferred** |
| **(d)** | **Staleness dependency set (title, confirmed format, transformation map — all three) and all three treated as soft**, not hard (§4). Full divergence from Phase 2/3's default-hard posture, extending Phase 4's precedent from one dependency to three. | **PROPOSED — needs Arman's explicit confirmation, most debatable on the format-change row** |
| 1 | Depth persisted as a per-subtopic 3-tier enum (`shallow`/`medium`/`deep`), not a raw word-count estimate and not left emergent to Step 8. §2.3. | Proposed |
| 2 | No `dimension_tag` column linking subtopics back to specific transformation-map dimensions — considered and rejected as over-engineering with no clear downstream consumer. §1.3. | Proposed |
| 3 | `delivery_mode` and demand/competition signals do not modulate the target count range in v1 — kept out to avoid an under-justified multi-variable formula. §2.2. | Proposed |
| 4 | Guardrail truncates over-max output (drop tail) but does not pad under-min output — persists `succeeded_below_target` instead of fabricating content. §3.4. | Proposed |
| 5 | New `subtopic_generation_status` enum adds `succeeded_below_target` as a fourth, genuinely new outcome vs. precedent's 3-value set. §3.4. | Proposed |
| 6 | AI-failure fallback for whole-list generation is an **empty list**, not a fabricated placeholder count — rejected the alternative of inventing a fixed stub count with no basis. §3.5. | Proposed |
| 7 | Single-item regenerate failure leaves the target row untouched (no destructive fallback needed, since nothing was overwritten). §3.5. | Proposed |
| 8 | Whole-list Regenerate requires the explicit-acknowledgment orchestration gate whenever any row is edited/manual/ai_regenerated — direct extension of Phase 4's precedent, larger blast radius than Phase 4's single-record case. §1.7. | Proposed |
| 9 | Single-item Regenerate requires the same acknowledgment gate, scoped to just that row, when that row specifically is edited/manual. §1.7. | Proposed |
| 10 | Whole-list regenerate soft cap: 5 per project, consistent with every prior phase. Single-item regenerate is **not** capped by the same counter (proposed uncapped, or a separate looser cap — not decided, low priority). §1.7. | Proposed — cap-or-not for single-item flagged as unresolved, low priority |
| 11 | Reinterpretation of "workbook+tracker combos" against the finalized single-value `format_type` enum (§2.4). | **CONFIRMED by Arman 2026-08-23 — Reading A** (reassign "~15-ish" to workbook alone, drop "combo" wording for Step 7). Combo/bundled format type logged as a genuine future-phase open item in `docs/PROTO-product-spec.md` §6, not decided or built here — see §2.4 for full context. |
| 12 | Auto-fire generation on reaching `transformation_map_confirmed` (no manual "Generate" click) — mirrors Steps 4/5/6. | Proposed |
| 13 | `transformation_map_status` enum reused verbatim for `subtopic_lists.status` (both are `draft`/`confirmed`) rather than a duplicate new type — same reuse convention Phase 3 established. | Proposed |
| 14 | Guardrail min-length for `description`: proposed 20 characters (shorter than Step 6's 30, since these are meant to be brief). Near-duplicate title threshold: proposed word-overlap ratio > 0.8. Both tunable defaults, approve-now/tune-later treatment. §3.4. | Proposed |

**Status: Step 7 requirements are a first-draft proposal, not yet locked.** Every item above needs Arman's explicit pass before DEV work starts — unlike Phases 2–4, this document has not yet been through a confirmation round.

---

Sources consulted for §2.1 (target-count grounding — confirming no fixed doctrine exists, not asserting one):
- [How Do You Structure an eBook — Designrr](https://designrr.io/how-do-you-structure-an-ebook/)
- [How to Write a Workbook Step-by-Step — Atmosphere Press](https://atmospherepress.com/how-to-write-a-workbook/)
- [How to Create Digital Workbook: Complete Guide — Publuu](https://publuu.com/knowledge-base/how-to-create-digital-workbook/)
- [7 Notion Life Dashboard Design Best Practices — Clarity Mastery](https://www.claritymastery.co/blog/how-to-organize-notion-dashboard-for-personal-life-goals-habits-daily-planning)
- [10 Best Notion Habit Tracker Templates in 2026 — 2sync](https://2sync.com/blog/best-notion-habit-tracker-templates)

Sources consulted for the quiz range follow-up (2026-08-23, at Arman's request — the only range in §2.2 with no citation before this pass):
- [How to make a personality quiz — Jotform Blog](https://www.jotform.com/blog/how-to-make-a-personality-quiz/) — completion-rate data by question count
- [20 Personality Questions You Should Ask for Your Business — Interact Blog](https://www.tryinteract.com/blog/20-personality-questions-you-should-ask-for-your-business/) — 6-10 question recommendation for business/engagement quizzes
- [How To Make a Personality Quiz in 5 Easy Steps — Second Street](https://uplandsoftware.com/secondstreet/resources/blog/building-personality-quizzes/)
- [75 Top-Performing Personality Quiz Questions — Interact Blog](https://www.tryinteract.com/blog/50-quiz-questions-you-should-be-using/) — outcomes-first, questions-built-backward methodology; long-form (15-30+ question) ranges are for hiring/coaching assessments, not engagement quizzes
