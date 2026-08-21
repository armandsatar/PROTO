# PROTO — Phase 2 Requirements: Step 4 (Format Recommendation)

**Scope:** Spec Step 4 only — PROTO recommends a product format (tracker / workbook / ebook / quiz) and a delivery mode (printable / fillable), states a reason, and lets the user override. Consumes the locked title from Steps 1–3. Does **not** cover Step 5 (Lead Magnet Check) or anything downstream — those are future phases and are intentionally absent from this document.

This document mirrors the structure and conventions of `phase1-requirements.md` (Data Model → domain logic → Output/UI → Decisions Locked). All decisions below were reviewed and confirmed by Arman on 2026-08-21; two of the original draft's proposals were corrected in that pass, not just rubber-stamped — see decisions 4 and 5.

---

## 1. Data Model

### 1.1 Format Taxonomy (the core cross-product)

Two axes: **format** (4 values, given) and **delivery_mode** (printable / fillable, given as "a separate axis"). Not every combination is sensible — this is defined explicitly here because the source spec leaves it open.

| Format | Printable | Fillable | Notes |
|---|---|---|---|
| **Tracker** | Valid | Valid | Printable = paper habit/goal tracker to fill by hand. Fillable = interactive PDF checkboxes or Notion database with rollups/dates. |
| **Workbook** | Valid | Valid | Printable = worksheets printed and handwritten. Fillable = PDF form fields or Notion interactive pages. Most format-agnostic of the four. |
| **Ebook** | **N/A** | **Invalid** | Ebook is a read-only reference/narrative format — it has no input fields under either delivery mode, so the axis doesn't meaningfully apply. `delivery_mode` is forced to `null` for this format (see §1.4). The UI must hide the printable/fillable toggle entirely when format = ebook, not just disable it. |
| **Quiz** | Valid | Valid (default-leaning) | Fillable = interactive, typically auto-scored (Notion formulas, PDF calculated fields) — this is the stronger default per market pattern, since interactivity is what differentiates a quiz product. Printable = self-scored paper assessment ("add up your points") — valid, secondary. |

**Confirmed:** ebook is the only format excluded from the printable/fillable axis, as proposed. If a real "printable ebook" use case (e.g. a recipe ebook meant to be printed) shows up later, that's a distinct product decision to make explicitly then, not something this taxonomy needs to anticipate now.

### 1.2 Single Table: `format_recommendations`

**Confirmed: single-table design, not the two-table `format_recommendations` + `format_selections` pattern originally proposed** (decision 4). One row is both an AI/fallback-generated suggestion *and*, once the user acts on it, the record of what they confirmed — audit history is preserved by superseding rows rather than by a second append-only log table, mirroring the "never overwritten, superseded rows stay queryable" principle from Phase 1 without needing Phase 1's exact two-table shape (that shape fit Step 2's 4-candidates-to-choose-among cardinality; Step 4 is 1-recommendation-to-accept-or-override, a different shape that doesn't need it).

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects) | no | |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Snapshot of which locked title this was generated against — used to detect staleness if the title later changes |
| **Recommendation fields (set at generation time, never edited after):** |
| `recommended_format` | enum `format_type` | no | tracker / workbook / ebook / quiz |
| `recommended_delivery_mode` | enum `delivery_mode` | yes | printable / fillable / null (null only when format = ebook) |
| `confidence` | enum `confidence_level` | no | high / medium / low |
| `reasoning_summary` | text | no | Plain-English 1–2 sentence explanation, for direct UI display |
| `reasoning_signals` | jsonb | no | Array of `{source, detail}` — structured evidence trail (see §2.3) |
| `alternate_format_considered` | enum `format_type` | yes | Populated when confidence is medium/low and a second format was a close call |
| `inputs_snapshot` | jsonb | no | Full snapshot of title text, Step 1 rationale, demand/competition scores + signal detail at generation time |
| `model` | text | no | e.g. `openai/gpt-oss-120b` |
| `generation_status` | enum `generation_status` | no | `succeeded` / `failed_fallback` / `failed_blocked` (see decision 1) |
| **Confirmation fields (null until the user acts, set once, then immutable):** |
| `confirmed_format` | enum `format_type` | yes | Null until user confirms. What was actually chosen. |
| `confirmed_delivery_mode` | enum `delivery_mode` | yes | Null until confirmed; null forever if confirmed_format = ebook |
| `is_override` | boolean | yes | Null until confirmed. True if confirmed values differ from recommended values. |
| `override_reason` | text | yes | **Optional, low priority** — quick-tag or free-text, shown only after an override |
| `confirmed_by` | uuid (fk → users) | yes | |
| `confirmed_at` | timestamptz | yes | |
| **Row lifecycle:** |
| `recommendation_status` | enum `recommendation_status` | no | `active` / `superseded` — only one `active` row per project at a time |
| `superseded_at` | timestamptz | yes | |
| `superseded_reason` | enum `supersede_reason` | yes | `title_changed` / `user_requested_reconsider` / `user_requested_format_change` / null |
| `created_at` | timestamptz | no | default now() |

**Row lifecycle, explicit (this is the part a single table has to get right that two tables got "for free"):**
- **Generation** (first entry, or Reconsider): inserts a new row with recommendation fields populated, confirmation fields null, `recommendation_status = 'active'`. If a prior active row exists, it's marked `superseded` first (`superseded_reason = 'user_requested_reconsider'`).
- **Confirmation** (accept-as-is or override): **updates the existing active row in place** — fills in the confirmation fields, does *not* supersede it. This is the one intentional mutation this table allows; everything else is insert-only. It's safe because confirmation fields start `null` and are only ever set once per row (enforced at the application layer — see decision 4's open follow-up below).
- **"Change Format" after confirmation**: the existing confirmed row is marked `superseded` (`superseded_reason = 'user_requested_format_change'`), and a **new row is inserted copying the same recommendation fields forward** (no new AI call needed — the underlying inputs haven't changed) with confirmation fields reset to null. This is what preserves audit history in a single-table design: the old confirmation is frozen in a superseded row rather than overwritten. A user who wants fresh AI reasoning too can additionally hit Reconsider from there.
- **Title change** (cascading invalidation): see §1.6, unchanged in spirit from the original draft.

**Follow-up flagged, not blocking:** enforcing "confirmation fields are set exactly once" is an application-layer rule with this design (an UPDATE policy analogous to Phase 1's `research_runs` "only while `status = 'pending'`" trick would work here too — gate the UPDATE policy on `confirmed_at is null`). Worth doing when this gets built, not deciding further now.

### 1.3 `projects` Table Extensions

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `current_format_recommendation_id` | uuid (fk → format_recommendations) | yes | Points at the currently active (non-superseded) row — whether or not it's confirmed yet |
| `status` | enum `project_status` | no | **Extended** — see §1.5 |

(No separate `selected_format_selection_id` — with the single-table design, "the current active row" and "the confirmed selection" are the same row once confirmed, so one pointer covers both states.)

### 1.4 Enums

| Enum | Values |
|---|---|
| `format_type` | `tracker`, `workbook`, `ebook`, `quiz` |
| `delivery_mode` | `printable`, `fillable` (nullable column — null = not applicable) |
| `confidence_level` | `high`, `medium`, `low` |
| `generation_status` | `succeeded`, `failed_fallback`, `failed_blocked` |
| `recommendation_status` | `active`, `superseded` |
| `supersede_reason` | `title_changed`, `user_requested_reconsider`, `user_requested_format_change` |

**Deterministic rule (not left to the AI):** if `recommended_format = 'ebook'`, `recommended_delivery_mode` is force-set to `null` at write time regardless of what any upstream generation step returns. Same rule applies to `confirmed_delivery_mode` when `confirmed_format = 'ebook'`. Hard business rule, not a judgment call — see §2.4.

### 1.5 `project_status` Extension

Phase 1 flow: `draft` → `researching` → `title_selected`.

**Confirmed:** extend with two new values, mirroring the existing in-progress/locked pattern:

| Status | Meaning |
|---|---|
| `title_selected` | (existing) Title locked, Step 4 not yet started |
| `format_recommending` | **New.** Step 4 in progress — recommendation generated (or being generated/regenerated), awaiting user confirm or override. Mirrors `researching` as the transient/working state. |
| `format_selected` | **New.** Terminal state for this phase — user has explicitly confirmed a format + delivery mode (accepting PROTO's suggestion or overriding it). |

Confirmation is **explicit and required** even when the user accepts PROTO's default with zero changes — no silent auto-accept. Matches the Step 3 pattern where the user must actively pick a candidate.

### 1.6 Re-recommendation & Locking Rules

| Trigger | Behavior |
|---|---|
| First entry into Step 4 (project just reached `title_selected`) | **Confirmed:** auto-fire the recommendation generation call immediately (no manual "Generate" button) — status moves `title_selected` → `format_recommending` (decision 6). |
| User clicks "Reconsider" while in `format_recommending` (pre-confirm) | New row inserted (recommendation fields regenerated via a fresh AI call); previous row marked `superseded`, `superseded_reason = 'user_requested_reconsider'`. **Confirmed soft cap: 5 reconsiders per project** (decision 7), to bound Groq call volume from casual re-rolling. |
| User confirms (accept or override) | Confirmation fields filled in on the existing active row (§1.2) — no new row, no status-table update elsewhere. `projects.status` → `format_selected`. |
| User clicks "Change Format" after `format_selected` | Existing row superseded (`superseded_reason = 'user_requested_format_change'`); new row inserted copying recommendation fields forward, confirmation fields reset to null (§1.2). `projects.status` reverts `format_selected` → `format_recommending`. |
| User changes the **selected title** via Phase 1's "Change Selection" (title unlock) while status is `format_recommending` or `format_selected` | **Confirmed cascading invalidation** (decision 2): active row marked `superseded` (`superseded_reason = 'title_changed'`); `projects.current_format_recommendation_id` cleared; `projects.status` follows the title's own revert to `researching`. Step 4 must be fully redone once a title is re-locked — recommendation is **not** carried over even if the same title text is re-selected. |

---

## 2. Recommendation Logic Requirements

### 2.1 Inputs

| Input | Source | Included? | Why |
|---|---|---|---|
| Selected title text | `title_candidates.candidate_text` (via `projects.selected_candidate_id`) | Yes — primary signal | Linguistic pattern is the strongest format indicator ("Tracker," "The Complete Guide to," "Which X Are You") |
| Step 1 rationale | **`title_ideas.rationale`**, joined via `title_ideas.project_id = projects.id` (1:1, `project_id unique` in the live migration) | Yes | Captures *intent* the title alone may not ("I want something my audience fills in daily" vs "a reference doc"). **Corrected from the original draft's assumed `projects.input_description`** — verified against the actual `0001_init_schema.sql` migration, not just the requirements doc prose (decision 5). There is no rationale/description field on `projects` at all; it lives on the separate `title_ideas` table alongside `original_title`. |
| Demand score + `demand_signal_detail` | `title_candidates` | Yes | Search-intent shape (e.g. "how to" queries lean ebook/guide; "template"/"planner" queries lean tracker/workbook) is diagnostic of format-market-fit |
| Competition score + `competition_signal_detail` | `title_candidates` | Yes | A saturated ebook niche with a demand gap in interactive tools is a legitimate reason to steer toward tracker/workbook/quiz instead of ebook — this is the kind of evidence-backed reasoning the spec's "stated reason" requirement implies |
| Other unselected title candidates | `title_candidates` (not selected) | **No** | Out of scope — the format decision is about the *chosen* title only, not the discarded alternatives |

### 2.2 Generation Approach — Hybrid (AI classification + deterministic guardrail)

**Confirmed approach:**

- **Primary:** a single Groq structured JSON-mode call (same connector/pattern as Step 2's classification calls — `openai/gpt-oss-120b`, no new provider work needed), receiving the four inputs above and returning `recommended_format`, `recommended_delivery_mode`, `confidence`, `reasoning_summary`, `reasoning_signals`, `alternate_format_considered` in one shot. One call, not two.
- **Why AI over pure rule-based:** title phrasing is too varied for reliable keyword matching alone ("The Ultimate Guide to Meal Planning" could plausibly be ebook or workbook depending on nuance the words alone don't resolve). An LLM call is cheap and fast on Groq, so the marginal cost of semantic judgment is worth it.
- **Why not pure AI (the guardrail layer):** the AI's classification must never be trusted blindly on hard taxonomy rules. A deterministic post-processing step validates/coerces every AI response before persisting:
  1. `recommended_format` must be one of the 4 enum values — reject/retry once on malformed output.
  2. If `recommended_format = 'ebook'`, force `recommended_delivery_mode = null` regardless of what the model returned.
  3. If `recommended_format` ≠ ebook and the model returned `delivery_mode = null`, default to `'fillable'` and downgrade `confidence` to `low`.
  4. `reasoning_signals` must be non-empty; if empty, still persist but downgrade `confidence` to `low`.

### 2.3 "Stated Reason" Output Contract

Structured, evidence-tagged JSON, mirroring the `demand_signal_detail` jsonb pattern already established in Phase 1 — not free prose:

```json
{
  "recommended_format": "workbook",
  "recommended_delivery_mode": "fillable",
  "confidence": "high",
  "reasoning_summary": "The title's action-oriented framing (\"Plan Your...\") and demand signals showing planning/organization search intent point to a hands-on workbook rather than a reference ebook.",
  "reasoning_signals": [
    { "source": "title", "detail": "Title uses imperative planning language typical of guided worksheets" },
    { "source": "demand_signal_detail", "detail": "Top queries include 'template' and 'worksheet' modifiers" },
    { "source": "competition_signal_detail", "detail": "Ebook competition in this niche is saturated; workbook/interactive competition is thin" }
  ],
  "alternate_format_considered": "tracker"
}
```

- `reasoning_summary` is the only field rendered by default in the UI (§3.1); `reasoning_signals` is expandable detail.
- Every signal must reference which input it came from (`title` / `rationale` / `demand_signal_detail` / `competition_signal_detail`) — free-floating unattributed claims are not acceptable output.

### 2.4 Printable vs Fillable — Separate Decision, Same Call

| Format chosen | Delivery mode logic |
|---|---|
| Ebook | Deterministic override to `null` — never asked of the model as a live decision (see §2.2 rule 2) |
| Tracker / Workbook / Quiz | Model decides `printable` vs `fillable` based on: whether the title/rationale imply daily/ongoing interaction (favors fillable — e.g. recurring habit tracking) vs one-time worksheet use (either works) vs a preference toward calculation/auto-scoring (quiz → fillable strongly favored, per §1.1) |

---

## 3. Output / Override Requirements

### 3.1 Object Exposed to UI

| Field | Source | Purpose |
|---|---|---|
| `recommended_format` | `format_recommendations` (active row) | Headline recommendation |
| `recommended_delivery_mode` | `format_recommendations` (active row) | Headline recommendation, hidden entirely if format = ebook |
| `reasoning_summary` | `format_recommendations` (active row) | Default-visible "why" |
| `reasoning_signals` | `format_recommendations` (active row) | Expandable "show evidence" detail |
| `confidence` | `format_recommendations` (active row) | Drives whether `alternate_format_considered` is surfaced |
| `alternate_format_considered` | `format_recommendations` (active row) | **Surfaced only when `confidence` is `medium` or `low`** |

### 3.2 Override Mechanism

- A 4-way format picker (tracker / workbook / ebook / quiz) plus a printable/fillable toggle that is **hidden**, not just disabled, when the selected format is ebook.
- PROTO's original recommendation and its reasoning must remain visible and legible at the moment of override and afterward — the recommendation panel stays rendered (e.g. "PROTO suggested: Workbook / Fillable — [reason]") alongside the override control, not replaced by it.
- On confirm, the active row's `confirmed_format`/`confirmed_delivery_mode` are set, with `is_override = true` if they differ from `recommended_format`/`recommended_delivery_mode`, else `false`.
- `override_reason` capture: **optional, low priority, not required for MVP.**

### 3.3 Status on Completion

`projects.status = 'format_selected'` once the user explicitly confirms (accept-as-is or override) — no auto-completion on generation alone.

---

## 4. Decisions Locked (2026-08-21)

| # | Decision |
|---|---|
| 1 | AI classification failure/timeout: deterministic keyword-heuristic fallback (rule table: "tracker/log/habit" → tracker, "workbook/planner/worksheet" → workbook, "guide/handbook/complete/everything you need" → ebook, "quiz/which...are you/find your/what's your" → quiz, else default `workbook` + `fillable`). Persisted with `generation_status = 'failed_fallback'`, `confidence = 'low'`, and an auto-generated `reasoning_summary` telling the user the AI step was unavailable. Mirrors Phase 1's partial/degrade pattern. |
| 2 | Changing the selected title after Step 4 invalidates the format choice — cascading supersede/reset per §1.6, not carried forward even to the same title text re-selected later. |
| 3 | Cost/latency: one additional Groq call per project at Step 4 (up to ~5 more on reconsider). Not expected to be a meaningful cost/UX concern at this volume on the zero-setup Groq default. No action needed — informational only, revisit only if a higher-cost BYOK provider is used for this step specifically. |
| 4 | **Single-table design** (`format_recommendations` only, no separate `format_selections`) — overrides the original draft's proposed two-table pattern. Audit history preserved via superseded rows, not a second log table; see §1.2 for the full row-lifecycle design this requires (confirmation-in-place, supersede-and-copy-forward on Change Format). |
| 5 | **Step 1 rationale field is `title_ideas.rationale`** (joined via `title_ideas.project_id → projects.id`, 1:1) — verified directly against the live `0001_init_schema.sql` migration, not assumed. The original draft's `projects.input_description` guess was wrong on both the table and the column name. |
| 6 | Printable quiz's downstream content-structure implications (manual point-tally vs. auto-scored logic): out of scope for Step 4, which only needs to persist the printable/fillable choice correctly. Informational flag for the future Content Builder phase — no action needed now. |
| 7 | Step 4 auto-fires on reaching `title_selected` (no manual "Generate" click), mirroring Step 2's pattern. |
| 8 | Reconsider soft cap: 5 regenerations per project. |

**Status: Step 4 requirements are locked. Not yet built** — DEV work hasn't started on this phase. The one flagged follow-up (enforcing "confirmation fields set exactly once" at the RLS layer, decision 4's row-lifecycle note) is a build-time detail, not an open requirements question.
