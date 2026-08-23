# PROTO — Phase 6 Technical Requirements: Step 8 (Content Builder)

**Scope:** Spec Step 8 only — PROTO researches and writes fresh, credible-source-informed, cautiously-framed content per confirmed subtopic, runs an automated compliance pass that detects and auto-rewrites risky/unsupported claims (with a visible plain-English change log), and runs an automated specificity/anti-genericness quality gate (Section 4's Quality Gate requirement — "handled entirely by PROTO, no manual review required"). Consumes the confirmed title (Steps 1–3), confirmed format (Step 4), the transformation map (Step 6 — see §2.5 for why this document treats it as a genuine input rather than assuming either way), and the confirmed subtopics list (Step 7). Does **not** cover Step 9 (Design), Step 10 (Copywriting), Step 11 (Export), Step 12 (Pricing), or the Bundle Engine — those are future phases and are intentionally absent from this document.

**Connector correction, flagged explicitly (same treatment as `phase1-requirements.md` decision 16):** Section 5 of the source spec names "Claude API" for reasoning/writing tasks including content, compliance, and scoring. That is BYOK-model, aspirational language — BYOK and the natural-language router are **not built**, and are listed as open items in spec §6. Every phase built so far (Steps 2–7) actually calls the zero-setup Groq default (`lib/ai/groq.ts`, model `openai/gpt-oss-120b`, confirmed live per phase1 decision 16). **Step 8 follows the same precedent: every AI call in this document is a Groq call, not a Claude API call.** This is not a downgrade decision made here — it is the existing, already-live connector being carried forward, exactly as it was for Steps 4–7. If/when BYOK ships, Step 8's calls become BYOK-routable like every other phase's; nothing in this document should be read as blocking on Claude API access.

**Status: Decisions Locked (2026-08-23).** All 25 items in §9 confirmed by Arman on 2026-08-23, including the 10 items originally raised as open questions in this draft — each carries a note on what's settled now vs. flagged for a later tuning pass once Step 8 has real generated content to test against (§10 is now a follow-up list, not an open-decision list). DEV work starts now.

---

## 0. Shape Determination

### 0.1 Is this a new shape, or does an existing one fit?

Per the four shapes established across Steps 1–7 (recommend/confirm; single editable record + log; live variable-length collection; and now this), Step 8's shape is evaluated against each:

| Property | Phase 2/3 (recommend/confirm) | Phase 4/6 (editable single record) | Phase 5 (live variable-length collection) | Step 8 |
|---|---|---|---|---|
| Cardinality of the thing edited | 1 recommendation row | 1 content row | N rows, **N itself AI-determined and user-mutable** (add/delete/reorder) | **N rows, but N is fixed by an upstream table Step 8 does not own** |
| Can Step 8 add/delete/reorder its own rows? | n/a | n/a | Yes — that's the defining property | **No** — membership and order are entirely inherited from `subtopics` (Step 7). Step 8 only ever has exactly one content row per live `subtopics` row, never more, never fewer by its own action |
| What "edit" means | Pick a different enum value | Rewrite a named field | Rewrite/reorder/delete/add a list item | Rewrite prose in one field on one row (closest to Phase 4's per-field edit, just repeated N times) |

**Conclusion: Step 8 is Phase 4/6's editable-content shape (generation log + live mutable content row), multiplied by N — where N and the ordering are fully inherited from Step 7's `subtopics` table, not independently managed.** It is *not* a second live collection with its own add/delete/reorder actions — that would duplicate Step 7's job and create two sources of truth for "what subtopics exist." This is the load-bearing call this document depends on: **Step 8 never inserts or deletes a `subtopics` row, and never changes `display_order`.** It only ever inserts/updates rows in its own content table, one per existing `subtopics.id`.

### 0.2 A genuinely new element: a compliance/change-log child table

No prior phase auto-rewrote its own AI output for a *business/safety* reason and needed to show the user what changed and why. Steps 2/3's guardrails reject-and-retry or force a deterministic value — they never produce "keep this, but with the following spans changed" as a user-facing artifact. This requires one new table beyond the log+header+content three-table pattern (§1.1). It is scoped narrowly (child of the generation log and the content row), not a reinvention of the shape.

---

## 1. Data Model

### 1.1 Four tables

| Table | Cardinality | Mutability | Role |
|---|---|---|---|
| `content_generations` | Many per project (one row per subtopic per AI attempt) | **Immutable once completed** — append-only, direct analog of `subtopic_generations` / `transformation_map_generations` | Audit/cost-tracking log of every writer-pass + review-pass attempt |
| `content_builds` | Exactly 1 per project (1:1) | Mutable header only — holds no prose itself | Document-level status, lock state, staleness snapshots, whole-document regenerate count. Direct analog of `subtopic_lists` |
| `subtopic_contents` | Exactly 1 per `subtopics` row (1:1, **not** 1:N — see §0.1) | **Mutable per row** — the live, user-editable prose | What Step 9 will eventually read |
| `content_compliance_changes` | Many per `subtopic_contents` row (0..N) | **Immutable once written** — append-only | The plain-English "Original → Rewritten, reason" change log entries (§5) |

All four carry `workspace_id` per the established multi-tenancy pattern — RLS gates every read/write on workspace membership via `is_workspace_member()`, no table-specific exception, no new authorization mechanism.

### 1.2 `content_builds` (header, 1:1 with `projects`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects, **unique**) | no | 1:1, same shape as `subtopic_lists.project_id` |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Staleness snapshot #1 — §7 |
| `format_recommendation_id` | uuid (fk → format_recommendations) | no | Staleness snapshot #2 — §7 |
| `transformation_map_snapshot_at` | timestamptz | no | Staleness snapshot #3 — same timestamp-snapshot mechanism Step 7 introduced for the same reason (`transformation_maps` has no version pointer) |
| `subtopic_list_confirmed_at` | timestamptz | no | Staleness snapshot #4 — **new dependency, not present in any prior phase's header table.** Snapshots `subtopic_lists.confirmed_at` at generation time. Chosen over a raw `updated_at`-style snapshot because `subtopics` rows are only editable while `subtopic_lists.status='draft'` (per migration 0005's RLS) — by construction, the confirmed subtopics list Step 8 trusts as input cannot change without an explicit unlock-and-reconfirm cycle, which always produces a fresh `confirmed_at`. This makes `confirmed_at` a real version marker, not just a timestamp of convenience. See §7.4 for the more important **per-row** subtopic staleness this snapshot does not replace. |
| `confirmed_format` | enum `format_type` | no | Denormalized, avoids a join for word-count-table lookups (§2) and prompt-building |
| `status` | enum `transformation_map_status` (**reused**) | no | `draft` / `confirmed` |
| `confirmed_at` / `confirmed_by` | timestamptz / uuid (fk → users) | yes | Null until confirmed |
| `regenerate_count` | int | no | default 0 — whole-document Regenerate-All soft cap only (§1.6) |
| `created_at` / `updated_at` | timestamptz | no | |

No per-document `current_generation_id` pointer, unlike `subtopic_lists`/`transformation_maps` — there is no single "latest generation" for a document made of N independent subtopic content rows; "latest generation" is a per-row concept (`subtopic_contents.source_generation_id`), not a document-level one. Document-wide completion state (how many of N subtopics have real content) is computed at read time from `subtopic_contents`, not stored redundantly — same "don't store cheaply-derivable state" posture as every prior phase.

### 1.3 `subtopic_contents` (the live content — 1:1 with `subtopics`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects) | no | Denormalized, same pattern as `subtopics.project_id` |
| `content_build_id` | uuid (fk → content_builds) | no | Denormalized parent pointer |
| `subtopic_id` | uuid (fk → subtopics, **unique**, `on delete cascade`) | no | The real 1:1 relationship. Cascades on delete — see §7.4 for why this is the only physically consistent option, and how the generation log survives it anyway |
| `body` | text | no (default `''`) | The live prose. Empty string is a real, honest state (`content_status='failed_empty'`), not an error condition to hide |
| `word_count` | int | no (default 0) | Recomputed on every write (generation or manual edit) — UI display + guardrail reference |
| `target_word_min` / `target_word_max` | int | no | Frozen from the depth×format table (§2.1) at generation time — same "persist the computed target so it can't silently drift" reasoning as `subtopic_lists.target_count_min/max` |
| `content_status` | enum `content_status` | no | `generated` / `manual` / `failed_empty` — see §1.6 and §6.5. **Deliberately a new enum, not a reuse of `subtopic_source`** — see §1.7 for why the value sets don't actually match |
| `source_generation_id` | uuid (fk → content_generations, `on delete set null`) | yes | Which attempt produced the current `body`. Null for `manual`/`failed_empty` |
| `is_edited` | boolean | no | default `false`. Set `true` on any manual edit to `body` since the row's last (re)generation. Same semantics as `subtopics.is_edited` / `transformation_maps.is_edited` |
| `compliance_reviewed` | boolean | no | default `false`. **True only if the *current* `body` is exactly what the compliance/review pass last produced.** Set back to `false` on any manual edit (§6.5) — a hand-edit after review can reintroduce an unreviewed claim, and PROTO does not silently re-run an AI call on every keystroke to compensate. Surfaced as a non-blocking UI flag, not a lock |
| `quality_flag` | enum `content_quality_flag` | no | default `clean`. `below_specificity_threshold` if the specificity gate (§4) never cleared even after retry. Non-blocking, visible |
| `last_edited_at` / `last_edited_by` | timestamptz / uuid (fk → users) | yes | Null until first manual edit |
| `created_at` / `updated_at` | timestamptz | no | |

### 1.4 `content_generations` (append-only log, one row per subtopic per attempt)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | |
| `project_id` | uuid (fk → projects) | no | |
| `content_build_id` | uuid (fk → content_builds) | no | |
| `subtopic_id` | uuid (fk → subtopics, `on delete set null`) | **yes** | Nullable specifically so this log row **survives** its subtopic being deleted (§7.4) — direct precedent match to `subtopic_generations.target_subtopic_id`'s identical `on delete set null` treatment (migration 0005 line 111). Always populated at insert time; only becomes null retroactively |
| `generation_number` | int | no | Sequential **per subtopic**, not per document — "Attempt N of 5" is a per-subtopic concept here, unlike Step 7 where it was per-list |
| `trigger_scope` | enum `content_trigger_scope` | no | `initial` / `regenerate_one` / `regenerate_all` / `new_subtopic_backfill` — **metadata only, not a different prompt shape.** See §6.3 for why Step 8, unlike Step 7, has exactly one call shape regardless of trigger |
| `title_candidate_id` / `format_recommendation_id` / `transformation_map_snapshot_at` / `subtopic_list_confirmed_at` | (matching FK/timestamp types) | no | Snapshots, frozen per attempt, same values as the parent `content_builds` row at the time this attempt fired |
| `subtopic_snapshot` | jsonb | no | Frozen copy of the specific subtopic's `title`/`description`/`depth` at generation time — the per-row staleness comparison basis (§7.4) |
| `inputs_snapshot` | jsonb | no | Full frozen inputs — title text, Step 1 rationale, confirmed format + delivery mode, transformation map content (§2.5), computed word-count target range, tone/voice instructions |
| `draft_content_snapshot` | text | yes (on success) | The writer pass's raw output, **before** the review pass touches it |
| `output_snapshot` | text | yes (on success) | The final content after the review pass — what gets copied into `subtopic_contents.body` on acceptance. Distinct from `draft_content_snapshot` so "what did compliance/specificity actually change" is always reconstructable from the log alone, without relying on `content_compliance_changes` rows existing |
| `specificity_score` | int (1–10) | yes | Null if the review pass itself failed outright (§6.5) |
| `compliance_status` | enum `content_compliance_status` | no | `no_changes_needed` / `changes_applied` / `review_pass_failed` |
| `model` | text | no | e.g. `openai/gpt-oss-120b` |
| `generation_status` | enum `content_generation_status` | no | `succeeded` / `succeeded_outside_length_target` / `failed_fallback` / `failed_blocked` — direct structural analog of `subtopic_generation_status`, same reasoning (§6.4) applied to length instead of count |
| `error_detail` | text | yes | Sanitized only |
| `created_at` / `completed_at` | timestamptz | created_at no, completed_at yes | |

### 1.5 `content_compliance_changes` (append-only, child log)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | |
| `project_id` | uuid (fk → projects) | no | |
| `content_generation_id` | uuid (fk → content_generations) | no | Which attempt produced this change |
| `subtopic_content_id` | uuid (fk → subtopic_contents) | no | Denormalized direct query path — "show this subtopic's change history" without joining through the log |
| `original_text` | text | no | The specific flagged span (a sentence or short passage), **not** the whole document body — see §5.2 for why span-level, not field-level |
| `rewritten_text` | text | no | The corrected span |
| `reason` | text | no | Plain-English, e.g. "Original implied a guaranteed outcome with no supporting evidence; rewritten to general-information framing with a cautious qualifier." — this is the literal string the UI renders per the spec's "Original → Rewritten, reason" requirement |
| `risk_category` | enum `content_risk_category` | no | `unsupported_claim` / `absolute_language` / `missing_disclaimer` / `diagnostic_language` / `other` — proposed, gives the (future, out-of-scope-here) UI a filterable/taggable view |
| `detected_by` | enum `content_change_detector` | no | `ai_judgment` / `deterministic_keyword_catch` — records which layer caught it (§3.3), makes the guardrail's real effect auditable in the data itself, not just asserted in this document |
| `created_at` | timestamptz | no | |

**Only actual changes get a row** — a compliance/review pass that finds nothing risky produces zero `content_compliance_changes` rows and `content_generations.compliance_status='no_changes_needed'`, not an empty-array placeholder row. Mirrors the "don't log a no-op" instinct already implicit in every prior phase's edit-tracking (`is_edited` only flips on a real change).

### 1.6 `projects.status` Extension

| Status | Meaning |
|---|---|
| `subtopics_confirmed` | (existing) Step 7 done, Step 8 not yet started |
| `content_generating` | **New.** Step 8 in progress — `content_builds` row exists in `draft` status, `subtopic_contents` rows editable, awaiting explicit confirm |
| `content_confirmed` | **New.** Terminal state for this phase — user explicitly confirmed the document is ready for Step 9 |

Confirmation is explicit and required to leave `content_generating`, same "no silent auto-accept" principle carried through every phase.

### 1.7 Enums

| Enum | Values | Status |
|---|---|---|
| `content_status` | `generated`, `manual`, `failed_empty` | New — **not a reuse of `subtopic_source`**, despite 3 of 4 possible labels overlapping in spirit. `subtopic_source` never needed a "failed" value because Step 7's whole-list failure fallback is "insert zero rows" (nothing to label) — Step 8's failure unit is a single row that must still exist (to hold the target word range, the staleness snapshot, the UI's "write this by hand" prompt), so it needs a real failed state a sibling table never had to represent. Direct precedent for this kind of deliberate non-reuse: Step 7 added `succeeded_below_target` instead of reusing the 3-value `generation_status` for the identical reason (a genuinely new outcome the value set didn't cover) |
| `content_quality_flag` | `clean`, `below_specificity_threshold` | New |
| `content_trigger_scope` | `initial`, `regenerate_one`, `regenerate_all`, `new_subtopic_backfill` | New |
| `content_compliance_status` | `no_changes_needed`, `changes_applied`, `review_pass_failed` | New |
| `content_generation_status` | `succeeded`, `succeeded_outside_length_target`, `failed_fallback`, `failed_blocked` | New — structural analog of `subtopic_generation_status`, same 4-value shape, different second value |
| `content_risk_category` | `unsupported_claim`, `absolute_language`, `missing_disclaimer`, `diagnostic_language`, `other` | New |
| `content_change_detector` | `ai_judgment`, `deterministic_keyword_catch` | New |
| `transformation_map_status` | `draft`, `confirmed` | **Reused** for `content_builds.status` — same reuse convention Phase 3/5 established |
| `format_type` | (existing) | Reused, for `content_builds.confirmed_format` |

### 1.8 Action Behaviors

| Action | What happens | Which table(s) change |
|---|---|---|
| **Explicit Generate** (available once project reaches `subtopics_confirmed` — **no auto-fire**, confirmed decision 18, §8) | User explicitly triggers generation (e.g. a "Generate Content" action) — `projects.status` stays `subtopics_confirmed` until this fires, a genuine resting state unlike every prior phase. Inserts `content_builds` (`status='draft'`). For **every** row in the confirmed `subtopics` list: computes the word-count target (§2.1), fires the writer + review call pair (§6.3, `trigger_scope='initial'`), inserts one `content_generations` row and one `subtopic_contents` row. `projects.status` → `content_generating`. | All, insert |
| **New subtopic added** (only possible if the subtopics list is unlocked post-confirm — an edge case flagged in §7.4/§10) | Auto-fires content generation for **that row only** (`trigger_scope='new_subtopic_backfill'`) — not a whole-document regenerate | `content_generations`, `subtopic_contents`, insert |
| **Manual edit** (`content_builds.status='draft'` only) | Direct `UPDATE` on `subtopic_contents.body`. Recomputes `word_count`. Sets `is_edited=true`, `compliance_reviewed=false` (§1.3), `last_edited_at`/`last_edited_by` | `subtopic_contents` only |
| **Regenerate one subtopic's content** (`draft` only) | If `is_edited=true`, requires the explicit-acknowledgment orchestration gate (Section 2's precedent) before overwriting. Fires the same writer+review call pair (§6.3, `trigger_scope='regenerate_one'`), scoped to just that subtopic. Inserts a `content_generations` row. On success: overwrites `body`, resets `is_edited=false`, `compliance_reviewed=true`, updates `content_status`/`quality_flag`. **No duplicate-avoidance check against sibling content** — see §6.3 for why this genuinely does not apply here, unlike Step 7's per-item regenerate | `content_generations`, `subtopic_contents` |
| **Regenerate whole document** (`draft` only) | If **any** row has `is_edited=true`, requires the acknowledgment gate. Loops the exact same per-subtopic call pair across every row (`trigger_scope='regenerate_all'`) — not a distinct call shape, just a bulk trigger (§6.3). Soft cap: **5 whole-document regenerations per project**, same number as every prior phase. `content_builds.regenerate_count`+1 | `content_generations`, `subtopic_contents` (many rows), `content_builds` |
| **Confirm** (`draft` only) | Sets `content_builds.status='confirmed'`, `confirmed_at`/`confirmed_by`. `projects.status` → `content_confirmed`. `subtopic_contents` rows become read-only via RLS (same subquery-on-parent-status pattern as migration 0005's `subtopics_update`/`subtopics_delete` policies — proven pattern, not a new mechanism). **Allowed even with content gaps** (some rows `failed_empty`) — confirmed as proposed, decision 20 | `content_builds` only |
| **Unlock / "Edit Content"** (only from `content_confirmed`) | Reverts `content_builds.status` to `draft`, `projects.status` to `content_generating`. Content preserved, not cleared — same justification as every prior phase's unlock | `content_builds` only |
| **Upstream title/format/map/subtopics change** | Soft staleness flag only — §7. No table force-mutated | None (UI-level flag) |

---

## 2. What "Content Per Subtopic" Concretely Means

### 2.1 Length — Step 7's depth tags become real per-format targets, not a single shared scale

**Considered and rejected: treating Step 7's `shallow`/`medium`/`deep` word-count guidance (§2.3 of `phase5-requirements.md`: ~100–250 / ~250–600 / ~600–1200 words) as one shared scale across all four formats, unmodified.** Rejected on real evidence, not just intuition: researched nonfiction chapter-length practice shows even *short-form* digital ebooks/guides (the closer analog to PROTO's products than traditionally-published books) run **1,000–2,000 words per chapter**, and chapters under ~800 words "feel insubstantial" — meaning Step 7's original `deep` ceiling of 1,200 words is roughly the *floor* of what a real "deep" ebook chapter should be. Applying Step 7's single scale literally would systematically undershoot ebook content while probably overshooting a tracker category's blurb.

**Decision: reinterpret Step 7's 3-tier tag into a per-format word-count table**, mirroring exactly the treatment Step 7 itself gave to target *counts* (§2.2 of that document) rather than inventing a new mechanism. Step 7's `depth` enum column is unchanged — this is purely a Step 8-side interpretation table, no migration to Step 7's schema needed.

| Format | Content unit | shallow | medium | deep | Grounding |
|---|---|---|---|---|---|
| **Tracker** | Explanatory/how-to-use copy for one category | 50–150 | 150–300 | 300–450 | **Heuristic default, no doctrine found** (same "no fixed doctrine" finding Step 7 hit for tracker/workbook counts) |
| **Workbook** | Worksheet framing text + prompts/exercises for one module | 100–200 | 200–400 | 400–700 | **Heuristic default** |
| **Ebook** | One chapter's narrative/reference prose | 250–500 | 500–1,000 | **1,000–2,000** | **Deep tier grounded**: short-format-ebook chapter-length research (1,000–2,000 words/chapter for a ~15k-word ebook; sub-800-word chapters read as insubstantial). Shallow/medium tiers are heuristic scaling from that grounded anchor, not independently researched |
| **Quiz** | One outcome/result-type description | 75–150 | 150–300 | 300–500 | **Heuristic default** — Step 7's own quiz research (result-count, question-count) didn't cover per-result description length, and no further doctrine was found on it |

**Confirmed by Arman as a working default (decision 22), same "approve now, tune later" treatment Step 7 gave its own count table** — flagged for follow-up research in §10, not silently asserted as fact. Only the ebook `deep` cell carries a real citation.

**Guardrail treatment (§6.4):** these are soft targets fed to the model as an instruction ("write approximately N–M words"), with a tolerance-band deterministic check afterward — not a hard word-count enforcement, since LLM prose generation cannot reliably hit an exact count and treating it as a hard gate would produce the same kind of dishonest padding/truncation risk Step 7 explicitly rejected for its own count guardrail.

### 2.2 What content *type* varies by format, not just length

The prompt must vary in *kind*, not just target length, since a "subtopic" means something structurally different per format (Step 7 §2.2): a tracker category needs short instructional/explanatory copy (how to use this section), a workbook module needs framing text plus actual worksheet prompts/questions (not just prose about the topic), an ebook chapter needs continuous narrative/reference prose, and a quiz outcome needs second-person result-description copy. This is a prompt-engineering requirement, not a schema one — noted here so it isn't lost, no new column needed since `content_builds.confirmed_format` already carries the signal into the prompt-builder.

### 2.3 Fresh, not sourced from Arman's own material

Per the spec, content is freshly researched/written per subtopic — Step 8 does not ingest or excerpt any of Arman's pre-existing source material. This is a prompt-instruction requirement (the model is told to write original content informed by general credible-source knowledge, not asked to summarize an input document), not a data-model requirement — there is no "source material" table anywhere upstream to exclude, so this is stated here for completeness rather than modeled as an explicit exclusion the way lead-magnet exclusions were in Steps 6/7.

### 2.4 "Credible sources + cautious framing" — an honest limitation, acknowledged and accepted (decision 19)

The spec names NIH/Mayo Clinic-style sourcing. **Step 8 does not perform live web verification or fetch real citable URLs in v1** — the Groq call is prompted to write with the tone and general-consensus framing of credible institutional sources (and may name them, e.g. "according to general guidance from organizations like the NIH...") but nothing in this pipeline confirms such a claim is factually accurate or that a named source actually says what's claimed. This mirrors the honesty Step 6 gave "visceral" tone (§3.3 of `phase4-requirements.md`: prompt-engineering responsibility, not a verifiable guarantee) — arguably higher stakes here given health-adjacent content is explicitly in scope. `content_generations.output_snapshot`/`draft_content_snapshot` retain whatever the model wrote for audit, but no independent fact-check layer exists in v1.

**Resolved by Arman, 2026-08-23: not a Step 8 build task.** Arman will manually review any gut-health-adjacent content before publishing until a real fact-check/source-verification layer exists — a standing manual-review commitment on his end, not a gap PROTO's build needs to close. See decision 19.

### 2.5 Does Step 8 need the transformation map? — worked through explicitly, not assumed

Step 7 read the map to decide **what** subtopics to cover, then deliberately did *not* persist a per-subtopic dimension tag (`phase5-requirements.md` §1.3) because the map's influence was "holistic," and noted Step 8 "can read the transformation map directly rather than needing it pre-summarized per subtopic." That leaves the actual question open rather than answered — worked through here:

- **Does a subtopic's title+description alone carry enough of the map's content for Step 8 to write well?** Partially. Title/description are compressed, structural summaries ("what this section covers"), not written in the reader's felt experience. The map's `dim_emotional_*`/`dim_identity_*`/`dim_pain_point_*` fields are the one artifact in the whole pipeline that captures gut-level, sensory, "care not clout" language (the Quality Gate's own tone bar) — closer to *how* to write than *what* to cover.
- **Conclusion: Yes, Step 8 reads the transformation map — as secondary/tone context, not a primary structural input**, same weight class as demand/competition signals in Steps 4–7 (flavor, not structure). The writer-pass prompt includes the map's headline + 4 dimension pairs specifically to inform voice/tone, not to redetermine subtopic coverage (that's already locked in by the confirmed `subtopics` rows). This makes the map a real staleness dependency for Step 8 (§7.3) — it was already a dependency for Step 7 for a different reason (structural), and remains one for Step 8 for a different reason again (tonal).

### 2.6 Lead magnet — excluded, same reasoning as Steps 6/7

Not consumed. The lead magnet (if any) is a separate product with its own unscoped future content needs; it has no bearing on how the *paid* product's subtopic content should be written.

---

## 3. The Compliance Pass — Mechanism (confirmed 2026-08-23)

### 3.1 Separate pass, not folded into the writer prompt — grounded, not just asserted

The spec names two distinct things: "writing rule baked into generation" (cautious framing as a generation-time instruction) **and** "compliance pass: auto-detects ... and auto-rewrites" (a scan-and-correct operation over already-produced text). Read literally, these are two different mechanisms, and real multi-stage LLM pipeline practice supports keeping them separate: research on multi-instruction prompting documents **"instruction drift"** — a single call given several simultaneous objectives (write well *and* self-police its own claims) tends to satisfy a subset of the instructions at the expense of others, whereas decoupled, single-objective passes produce more consistent results per objective. This is the same class of reasoning Step 6 used implicitly (prompt carries "visceral," a guardrail cannot) — extended here to justify an actual second AI call rather than one prompt trying to do both jobs well.

**Two Groq calls per subtopic per generation attempt** — a writer pass (produces draft content, cautious framing is a generation-time instruction within this call) and a review pass (reads the draft, performs both the compliance check/rewrite **and** the specificity check, §4, in one combined structured response). Folding compliance + specificity into the *same* review call (rather than three fully separate calls) is a deliberate cost tradeoff, not a hidden assumption — flagged explicitly:

| Option | AI calls per subtopic | Risk |
|---|---|---|
| 3 fully separate passes (write / compliance / specificity) | 3 | Cleanest per-objective isolation (least instruction drift), highest cost — 3N calls for an N-subtopic document |
| **2 passes, review pass combines compliance + specificity (proposed)** | **2** | Some residual instruction-drift risk between compliance and specificity within the one review call, but both are "read this text and flag/fix issues" tasks (closer in kind to each other than either is to fresh writing), and cost is half of the 3-pass option |
| 1 pass, everything folded into the writer prompt | 1 | Rejected — the exact instruction-drift failure mode above, applied to the highest-stakes objective (safety) |

**Resolved by Arman, 2026-08-23: the 2-call option, confirmed.** Cheaper and manageable at current scale. Explicitly revisit (move to 3 separate passes) if content quality suffers once real output is seen — not on a fixed schedule, a quality-triggered reconsideration. See decision 16.

### 3.2 What triggers a "risky claim" — AI judgment, with a real deterministic catch-net

Per every prior phase's "never trust AI blindly on a hard rule" posture, the review pass's compliance judgment is backstopped by a deterministic layer, not left as AI-judgment-only:

- **AI judgment (primary):** the review pass is prompted with the specific failure modes to look for — unsupported/absolute claims ("cures," "eliminates," "guaranteed," "proven to treat [condition]"), diagnostic-implying language ("if you have these symptoms, you have X"), and missing cautious framing — and returns a structured list of `{original_text, rewritten_text, reason, risk_category}` objects (§1.5).
- **Deterministic catch-net (backstop):** a fixed keyword/phrase list of known absolutist-claim markers (`cures`, `guaranteed`, `100% effective`, `eliminates`, `treats [disease]`, `clinically proven to`, etc. — grounded in FTC health-claims guidance, which specifically warns that vague qualifiers like "may help" are *not* sufficient softening on their own, meaning absolutist language is the correct, checkable target for a keyword net) is scanned against `output_snapshot` after the review pass runs. Any hit **not already covered by an existing `content_compliance_changes` row for that span** is treated as a review-pass miss: the guardrail force-flags it (`detected_by='deterministic_keyword_catch'`), and — for `full_list`-equivalent severity — triggers one retry of the review pass with the missed phrase explicitly named in the retry prompt. This directly mirrors the "AI judgment + deterministic backstop" pattern every prior phase used for its riskiest decision, applied here to prose instead of a taxonomy value.
- **Guardrail validation on every returned change:** `original_text` must be an actual substring of `draft_content_snapshot` (case/whitespace-normalized) — a returned change whose "original" text doesn't actually appear in the draft is dropped, not trusted, per the same "never fabricate" posture as every guardrail layer in this codebase.

### 3.3 Scope — niche-agnostic, not gated on a "health-adjacent" classification

**Is "health-adjacent" knowable at this point in the pipeline?** No — there is no niche-taxonomy field anywhere in the data model built so far (Steps 1–7 never classify a product into a niche category). Building a gate on that classification would require inventing a new upstream classification step not scoped anywhere in this pipeline. **Decision, confirmed by Arman 2026-08-23: run the compliance pass on every product, regardless of niche.** Cost asymmetry justifies it: a false negative (skipping the pass on something that *is* health-adjacent because a niche-classifier missed it) is a real safety/liability gap; a false positive (running the pass on a plainly non-health tracker product) just costs one extra Groq call that returns `no_changes_needed`. See decision 21.

---

## 4. The Specificity / Anti-Genericness Quality Gate

Section 4's Quality Gate requires this to be fully automated ("no manual review required"). Per the brief's explicit instruction, this cannot be hand-waved as "the AI will be good at this" — a real, buildable mechanism is required, mirroring the AI-judgment + deterministic-backstop shape used everywhere else in this codebase.

### 4.1 Two distinct failure modes, two distinct mechanisms

The Anti-Slop Rules name two related but different things: "no genericness ... matches 'care not clout' tone" (voice) and "content must reference real, concrete details of the niche; fails if a sentence could paste unchanged into any other niche's product" (niche-specificity). These get different treatment because only one is mechanically catchable:

| Failure mode | Mechanism | Why |
|---|---|---|
| **Known AI-writing "tells"** — generic filler vocabulary/phrasing that reads as templated regardless of niche (e.g. "delve," "tapestry," "crucial," "leverage," "elevate," "seamless," "robust," "foster," "ever-evolving," "in today's fast-paced world," "it's important to note," the "not just X, but Y" construction) | **Deterministic keyword/phrase blocklist**, real and buildable — grounded in documented AI-writing-tell research, not invented. Reject/retry once if hit-count exceeds a proposed threshold (**3+ distinct hits**, heuristic, tunable) | These are mechanically detectable string matches — a real backstop, not an assertion |
| **Niche-genericness** — "could this sentence paste unchanged into any other niche's product" | **AI judgment only**, part of the review pass's `specificity_score` (1–10) + `specificity_issues` list | This is fundamentally a semantic judgment about *this specific niche's* concrete details, which no fixed keyword list can evaluate — **same honesty Step 6 gave "is this visceral enough"** (§3.3 of `phase4-requirements.md`): no deterministic check can replace AI judgment here, only backstop the more mechanical AI-slop-phrase case above |

### 4.2 Threshold and retry behavior

`specificity_score >= 7/10` (confirmed as a starting point, heuristic, tunable — decision 17, revisit once real content exists to test against, §10) is the pass bar. Below threshold, or 3+ blocklist hits: reject/retry once, feeding the specific flagged phrases/issues back into a re-run of the writer pass, then re-running the review pass on the new draft. **If still failing after retry: accept as-is, set `subtopic_contents.quality_flag='below_specificity_threshold'`, non-blocking** — same "honest gap flagged, not force-fixed, not hidden" posture as Step 7's `succeeded_below_target`. An unbounded retry-until-perfect loop is not buildable against a fuzzy judgment score; a visible, non-blocking flag is the honest alternative to either infinite retries or silent pass-through.

---

## 5. The Change Log — Data Shape

### 5.1 Granularity: per rewritten span, not per document or per whole field

"Original → Rewritten, reason" only satisfies the spec's "plain-English, non-blocking, gives visibility without needing code review" bar if it's readable at a glance. Logging the entire subtopic body before/after (a deep ebook chapter can be 2,000 words) would be unreadable as a change log — the useful unit is the specific sentence/span that changed, with its own reason. This is why `content_compliance_changes` is a real child table with `original_text`/`rewritten_text` scoped to spans (§1.5), not a document-level blob diff.

### 5.2 Scope: per subtopic, rolled up to project level for viewing

Each `content_compliance_changes` row belongs to exactly one `subtopic_content_id`. A project-level "change log" view (out of scope to design here — this is a data-shape question, not a UI one) is simply every `content_compliance_changes` row for the project's subtopics, joinable and orderable by `created_at` or by subtopic — the data already supports both a per-section view and a whole-document rollup without needing a separate aggregation table.

### 5.3 Only real changes are logged

No-op reviews produce zero rows (§1.5). This keeps the log meaningful — a document with zero compliance issues shows an empty, reassuring log, not N rows all saying "no change."

---

## 6. Generation Logic Requirements

### 6.1 Inputs

| Input | Source | Included? | Why |
|---|---|---|---|
| This subtopic's title/description/depth | `subtopics` (one row) | Yes — primary | The direct brief for what this piece of content covers |
| Selected title text + Step 1 rationale | `title_candidates.candidate_text`, `title_ideas.rationale` | Yes | Same anchor role as every prior phase |
| Confirmed format + delivery mode | `format_recommendations` (confirmed row) | Yes — genuinely required | Determines the content *type* (§2.2) and word-count table (§2.1) |
| Transformation map (headline + 4 dimensions) | `transformation_maps` (live row) | **Yes — secondary/tone context, see §2.5** | Informs voice ("care not clout"), not structure — structure is already fixed by the confirmed subtopic |
| Computed word-count target range | Derived, §2.1 | Yes | Deterministic, not left to the AI to decide (same posture as Step 7's count range) |
| Sibling subtopic titles (full list) | `subtopics` (all rows for the project) | **Yes — light context only, not a duplicate-avoidance mechanism** | Helps the model avoid literally repeating another section's content, but — unlike Step 7 — this is not enforced by a guardrail (§6.3), since prose sections aren't competing for a shared namespace the way list-item titles were |
| Demand/competition signals | `title_candidates` | No — excluded | Unlike Steps 4–7, these flavor *which angles matter*, a decision already locked in by the confirmed subtopic; re-introducing them at the prose-writing stage adds no new signal Step 7 hasn't already acted on |
| Confirmed lead magnet decision | `lead_magnet_recommendations` | No — deliberately excluded | Same reasoning as Steps 6/7 (§2.6) |
| Arman's own source material | — | **No — never exists as an input.** Per spec, content is fresh | See §2.3 |

### 6.2 Deterministic Target Computation

`target_word_min`/`target_word_max` are computed in code from the format×depth table (§2.1) before either AI call fires — same "deterministic rule feeding the prompt, not asked of the AI" posture Step 7 applied to its count range.

### 6.3 Call Shape — One Shape, Not Two (a genuine divergence from Step 7)

Step 7 needed two distinct prompt shapes (`full_list` vs `single_item`) because `full_list` had to solve a namespace problem (N items must not duplicate each other) that `single_item` uniquely needed extra context for. **Step 8 has no equivalent problem**: every subtopic's content call was already independently scoped from the moment auto-fire loops over the confirmed list — there was never a "generate all N pieces of content in one call" mode to begin with, since prose content doesn't need to be reasoned about jointly the way a list's internal ordering/uniqueness does. Therefore:

- **There is exactly one call pair shape: writer pass + review pass, scoped to a single subtopic.** `trigger_scope` (`initial`/`regenerate_one`/`regenerate_all`/`new_subtopic_backfill`) is purely metadata about *why* this attempt fired, recorded for audit/UI ("Attempt N of 5"), not a different prompt.
- **"Regenerate whole document" is a bulk *trigger*, not a distinct generation call** — it loops the same per-subtopic call pair across every row.
- **No duplicate-avoidance guardrail is needed for `regenerate_one`, unlike Step 7's single-item regenerate.** Worked through explicitly, not assumed: Step 7's guardrail existed because a regenerated *list item's title* could collide with a sibling's title in the same flat namespace. A regenerated subtopic's *content* is independent, self-contained prose about an already-fixed, already-unique topic (the subtopic itself is guaranteed non-duplicate by Step 7's own guardrail) — there is no shared namespace for two prose blocks to collide in. Sibling titles are still passed as light context (§6.1) purely to reduce redundant phrasing, but nothing rejects or retries on similarity.

### 6.4 Guardrail Layer

| # | Rule | On failure |
|---|---|---|
| 1 | `body` non-empty, `word_count` within a tolerance band around `[target_word_min, target_word_max]` (proposed: accept if within 50%–150% of the range's bounds) | Reject/retry once with the miss explicitly named. If still outside band after retry: **accept as-is**, `generation_status='succeeded_outside_length_target'` — not force-padded or truncated, same "real content over a fabricated fit" posture as Step 7's `succeeded_below_target` |
| 2 | Every `content_compliance_changes.original_text` must be a real substring of `draft_content_snapshot` | Drop the fabricated change record, don't persist it (§3.2) |
| 3 | Deterministic AI-slop blocklist scan (§4.1) — reject/retry once if 3+ distinct hits | If still 3+ after retry: accept as-is, `quality_flag='below_specificity_threshold'` |
| 4 | Deterministic absolutist-claim keyword scan (§3.2) against `output_snapshot`, independent of what the AI review pass caught | Any uncaught hit force-flags a `content_compliance_changes` row (`detected_by='deterministic_keyword_catch'`) and triggers one review-pass retry naming the missed phrase |
| 5 | `specificity_score >= 7` (§4.2) | Reject/retry once. If still below after retry: accept as-is, `quality_flag='below_specificity_threshold'` |

### 6.5 AI-Failure Fallback — Per-Subtopic, Not Whole-Document

**Writer-pass failure (retry-once exhausted):** `content_generations` row persists with `generation_status='failed_fallback'`, `draft_content_snapshot`/`output_snapshot` null. `subtopic_contents.body=''`, `content_status='failed_empty'`, `target_word_min/max` still populated so the UI can show "PROTO couldn't write this section — aim for roughly N–M words, add manually." Direct continuation of Step 7 decision 10's "honest empty state over fabricated content" — applied per-subtopic here rather than to a whole list, since a document-level empty state would be a much worse outcome for what could be an 11-of-12-subtopics-successful generation.

**Review-pass failure (retry-once exhausted, writer pass already succeeded):** the draft content is **not** discarded — `body` is set to `draft_content_snapshot` (source `ai_generated`), `content_status='generated'`, but `compliance_status='review_pass_failed'` and `compliance_reviewed=false`, surfaced as a clear, non-blocking banner ("compliance/specificity review didn't complete for this section — review before publishing"). This keeps the user unblocked with real content rather than an empty section, while being honest that the safety net didn't run — the same "don't over-block, but don't hide the gap" balance Step 7 struck for `succeeded_below_target`.

**Regenerate-one failure:** target row's existing `body` is left untouched (nothing was overwritten) — same as Step 7's single-item regenerate-failure treatment.

### 6.6 Output Contract (JSON)

```json
{
  "call": "writer_pass",
  "subtopic_id": "a1b2c3d4-...",
  "content": "Full prose for this subtopic..."
}
```

```json
{
  "call": "review_pass",
  "final_content": "The full prose, post-compliance/specificity rewrite...",
  "compliance_changes": [
    {
      "original_text": "This routine guarantees you'll eliminate stress within a week.",
      "rewritten_text": "Many people find routines like this helpful for managing day-to-day stress, though individual results vary — this isn't a substitute for professional guidance if stress is significantly affecting your life.",
      "reason": "Original implied a guaranteed outcome with no supporting evidence; rewritten to general-information framing with a cautious qualifier.",
      "risk_category": "unsupported_claim"
    }
  ],
  "specificity_score": 8,
  "specificity_issues": []
}
```

---

## 7. Staleness — Four Dependencies, Each Justified Independently

### 7.1 Does Step 8's content depend on each upstream artifact?

| Dependency | Does content depend on it? | Why |
|---|---|---|
| Confirmed title | Yes | Baseline |
| Confirmed format | Yes | Determines content type and length table (§2.1/§2.2) |
| Transformation map | **Yes — as tone context, per §2.5's explicit resolution** | Not a coin-flip inclusion — worked through and included for voice, not structure |
| Confirmed subtopics list | **Yes — new dependency, doesn't exist for any prior phase** | Content is written *for* a specific subtopic's title/description/depth; if that changes, the content it was written against may no longer match |

### 7.2 Does the Step 7 "expensive-to-lose hand-curation" argument apply more or less strongly here?

**More strongly.** Step 7's soft-staleness argument was: the subtopic list can represent real hand-curation (reorder/edit/add/delete across up to 15 items), so hard-cascading on an upstream nudge would discard real authored effort for a minor upstream change. Step 8's content is **the single most expensive-to-regenerate artifact in the pipeline so far** — it's freshly researched *and* written prose, passed through a compliance rewrite and a specificity check, potentially hand-edited afterward, across N subtopics. Losing it to a hard cascade would be strictly worse than losing a subtopic list. **All four dependencies below are soft, and the case for soft treatment is the strongest yet made in this codebase, not a routine repeat of precedent.**

### 7.3 Per-dependency treatment

| Dependency | Treatment | Justification |
|---|---|---|
| Title change | **Soft** | Same authored-effort argument as Step 7, now applied to a more expensive artifact |
| Format change | **Soft, with stronger UI warning language** | A format change this late implies the content's *type* (chapter prose vs. worksheet prompts vs. tracker copy) may now be structurally wrong, not just tonally stale — a more severe mismatch than a title wording change. The underlying mechanism stays soft (banner, no forced clear) because forcing a redo would be even more destructive than the staleness itself, but the banner copy should say more than "this may be out of date" |
| Transformation map change | **Soft** | Same authored-effort argument. Because the map is only tone context here (§2.5), a map edit is *less* likely to genuinely invalidate existing content than a title/format change — but still surfaced, not silently ignored, per the "if it's a real input, it's a real staleness dependency" principle Step 6 established |
| Confirmed subtopics list change | **Soft, and detected per-row, not per-document** — genuinely new detection granularity, see §7.4 | A subtopic edit only invalidates *that subtopic's* content, not the whole document — treating it as a document-wide flag (the pattern used for the other three, legitimately document-wide inputs) would over-warn on every unrelated subtopic |

### 7.4 Subtopics-list staleness — per-row detection, and the cross-phase delete/unlock interaction

**Detection:** on load/action, compare each `subtopics` row's live `title`/`description`/`depth` against the matching `content_generations.subtopic_snapshot` that produced the current `subtopic_contents.body` for that same `subtopic_id`. Mismatch → soft per-row flag ("this subtopic was edited after its content was generated"), not a document-wide banner.

**The genuinely tricky case: deleting a subtopic after its content already exists.** Step 7 supports unlocking a *confirmed* subtopics list and deleting/editing rows even after Step 8 has already generated (possibly hand-edited, compliance-reviewed) content against the old list. When a `subtopics` row is deleted, its `subtopic_contents` row **must** cascade-delete (§1.3) — there is no "soft" option for a hard foreign-key delete; the parent is simply gone. What *is* preserved: `content_generations.subtopic_id` is `on delete set null` (§1.4), so the generated prose is never permanently lost from the system, just detached from a live row — recoverable from the log the same way Step 7's whole-list regenerate keeps old content recoverable from `output_snapshot`.

This is a real cross-phase interaction, deliberately not resolved here: **Arman confirmed (2026-08-23) that whether Step 7's own UI should warn "Step 8 has already generated content for these subtopics — unlocking/editing may orphan that content" is deferred to a future Step 7 revision, not this document.** Noted here since it's the trigger for Step 8's data behavior, but explicitly out of scope for Step 8's build. See decision 25.

### 7.5 Detection and effect (mirrors §4.3 of `phase5-requirements.md`)

| | Title / format / map (document-level) | Subtopics list (per-row) |
|---|---|---|
| Detection | Lazy, on load/action — compare `content_builds`' snapshot FKs/timestamps against current pointers | Lazy, on load/action — compare `content_generations.subtopic_snapshot` per row |
| Effect on stored content | None — `subtopic_contents` rows untouched | None — that row untouched |
| Effect on `projects.status` | If `content_confirmed`: reverts to `content_generating` | Same, if any row is stale |
| User's next step | Banner + choice: Regenerate-All, Regenerate-one on affected sections, or hand-edit | Per-row flag + choice: Regenerate that section, or hand-edit |

---

## 8. Generation Trigger — Explicit, Not Auto-Fired (resolved 2026-08-23, breaks precedent)

Every phase 2–7 auto-fires on reaching the prior step's confirmed status with no manual "Generate" click. **Decision, confirmed by Arman 2026-08-23: Step 8 breaks this precedent — generation does NOT auto-fire on `subtopics_confirmed`.** Reaching `subtopics_confirmed` leaves `projects.status` unchanged and creates no `content_builds`/`content_generations`/`subtopic_contents` rows; the user must take an explicit action (e.g. a "Generate Content" button) before any AI call fires. See decision 18.

**Why this phase diverges from every prior phase's default:** the cost/blast-radius profile is categorically different.
- Every prior phase's auto-fire is **one AI call** (or, for Step 7, one call whose count target caps around 15).
- Step 8's generation is **2 AI calls × N subtopics** — for a 15-item workbook, that's up to 30 Groq calls, which auto-fire would have triggered automatically with no user action in between. Arman wants an explicit checkpoint before that volume of automatic calls fires, not an inherited UX habit carried over from cheaper phases.

This changes §1.8's first-entry row to "Explicit Generate," and means `subtopics_confirmed` is now a genuine resting state (unlike every prior phase's confirmed-status, which always immediately cascaded into the next phase's draft state) — a new state-machine shape worth DEV's attention, not just a UI nicety.

---

## 9. Decisions Locked (2026-08-23)

| # | Decision |
|---|---|
| 1 | **Shape: Phase 4/6's editable-content pattern (log + header + live content), multiplied by N rows inherited entirely from `subtopics` — not a second independent live collection.** Step 8 never adds/deletes/reorders its own rows. §0.1. |
| 2 | Four-table model: `content_builds` (header) + `content_generations` (log) + `subtopic_contents` (live, 1:1 with `subtopics`) + `content_compliance_changes` (append-only child log) — one new table beyond the established 3-table shape, justified by the genuinely new "visible change log" requirement. §0.2, §1.1. |
| 3 | `content_generations.subtopic_id` and `subtopic_contents.subtopic_id` FK cascade behaviors: `on delete set null` for the log (survives subtopic deletion, direct precedent match to `subtopic_generations.target_subtopic_id`), `on delete cascade` for the live content row (no other option for a hard FK delete). §1.3, §1.4, §7.4. |
| 4 | `content_status` is a new enum, deliberately not a reuse of `subtopic_source`, because the failure-state shape genuinely differs. §1.7. |
| 5 | Step 8 has **one** call shape (writer + review pass, per-subtopic), not two — `trigger_scope` is metadata only, not a distinct prompt. No duplicate-avoidance guardrail needed for regenerate-one, unlike Step 7. §6.3. |
| 6 | Word-count-by-format×depth table (§2.1) proposed as a heuristic default (ebook `deep` tier grounded in real research; all other cells unresearched heuristics) — approve-now/tune-later treatment, same as Step 7's count table. |
| 7 | Compliance-pass deterministic backstop: absolutist-claim keyword scan, grounded in FTC health-claims guidance's finding that vague qualifiers alone are insufficient. §3.2. |
| 8 | Specificity-gate deterministic backstop: AI-slop phrase blocklist (grounded in documented AI-writing-tell research), reject/retry on 3+ hits. Niche-specificity itself remains AI-judgment-only, explicitly not claimed to be deterministically checkable — same honesty class as Step 6's "visceral" call. §4.1. |
| 9 | Guardrail behavior on length/specificity misses: retry-once, then accept-as-is with a non-blocking flag (`succeeded_outside_length_target` / `below_specificity_threshold`) — never force-padded, truncated, or silently blocked. Direct continuation of Step 7's `succeeded_below_target` precedent. §6.4. |
| 10 | AI-failure fallback is per-subtopic, honest-empty (`failed_empty`, no fabricated placeholder content) for writer-pass failures; draft content is kept (not discarded) with a `review_pass_failed` flag if only the review pass fails. §6.5. |
| 11 | Staleness dependency set: title, format, transformation map (all document-level, soft), and confirmed subtopics list (new, soft, **detected per-row** not per-document). The "expensive-to-lose" argument applies more strongly here than in any prior phase. §7. |
| 12 | Change log granularity: span-level (`original_text`/`rewritten_text`/`reason` per rewritten sentence/passage), not per-document or per-field — the only shape that satisfies "plain-English, glance-readable" per the spec's own framing. §5. |
| 13 | Only actual changes get a `content_compliance_changes` row — no-op reviews log nothing. §1.5, §5.3. |
| 14 | Whole-document regenerate soft cap: 5 per project, consistent with every prior phase. §1.8. |
| 15 | `transformation_map_status` enum reused for `content_builds.status` — same reuse convention as Phase 3/5. §1.7. |
| 16 | Compliance pass call structure: **2 combined calls per subtopic** (review pass combines compliance + specificity, not 3 fully separate passes) — cheaper and manageable at current scale. Explicitly revisit (move to 3 separate passes) if content quality suffers once real output is seen, not on a fixed schedule. §3.1. |
| 17 | Specificity score threshold (`>= 7/10`) and AI-slop blocklist hit threshold (`3+` distinct hits): confirmed as starting points, not final — flagged for a tuning pass once Step 8 has real generated content to test against, same treatment Step 7 gave its quiz range. §4.1, §4.2. |
| 18 | **Generation trigger: no auto-fire.** Step 8 requires an explicit user action before generation runs — a deliberate break from every prior phase's auto-fire precedent, due to the cost/blast-radius jump (up to 30+ automatic Groq calls per document). §8. |
| 19 | No fact-check/source-verification layer in v1: acknowledged and accepted, not a Step 8 build task. Arman will manually review any gut-health-adjacent content before publishing until a real fact-check layer exists — a standing manual-review commitment on his end, not a PROTO mechanism. §2.4. |
| 20 | Confirm is allowed with content gaps (some subtopics `failed_empty`) — warning shown, not hard-blocked. Confirmed as proposed. §1.8. |
| 21 | Compliance pass runs on every product regardless of niche — confirmed, since no niche-classification field exists anywhere in the pipeline. §3.3. |
| 22 | Word-count-by-format×depth table (§2.1): confirmed now as a working default; three of four format rows remain unresearched heuristics, flagged for follow-up research once real model output exists — same treatment Step 7 gave its quiz range. |
| 23 | `content_compliance_changes.risk_category` taxonomy (§1.5): confirmed as a starting set, expected to be revised once real compliance flags start firing against actual generated content. |
| 24 | Length-tolerance band (50%–150% of target, §6.4): confirmed as a starting point, not empirically tuned. |
| 25 | Step 7/Step 8 unlock interaction (§7.4) — deleting/editing a confirmed subtopics row after Step 8 content already exists can orphan that content. Confirmed as a future Step 7 revision item, not Step 8's problem to solve — not fixed here. |

**Status: Step 8 requirements are locked. Not yet built** — DEV work starts now.

---

## 10. Follow-Up / Tuning Items — Not Blocking, Revisit Once Real Content Exists

Every item below was confirmed as a working default (§9), not left undecided — but each carries an explicit commitment to revisit once Step 8 has produced real generated content to evaluate against, same "approve-now/tune-later" treatment Step 7 gave its own count table and later followed through on for its quiz range specifically:

1. Specificity score threshold (`>= 7/10`) and AI-slop blocklist hit threshold (`3+`) — decision 17.
2. Word-count-by-format×depth table, specifically the three unresearched format rows (tracker/workbook/quiz) — decision 22.
3. `content_compliance_changes.risk_category` taxonomy — decision 23.
4. Compliance pass call structure (2 combined calls vs. 3 separate) — revisit specifically if content quality suffers, not on a fixed schedule — decision 16.
5. Length-tolerance band (50%–150% of target) — decision 24, not empirically tuned yet.

**Not a follow-up item — a standing commitment outside PROTO's build scope:** Arman will manually review gut-health-adjacent content before publishing until a real fact-check/source-verification layer exists (decision 19). This is not tracked as a PROTO feature gap to close; it's an acknowledged manual process on his end.
