# PROTO — Phase 3 Technical Requirements: Step 5 (Lead Magnet Check)

**Scope:** Spec Step 5 only — PROTO decides whether a free companion lead magnet is clearly suited to the title/niche, and if so, which of two types, with a stated reason. User can override in either direction. Consumes the confirmed title (Steps 1–3) and confirmed format (Step 4). Does **not** cover Step 6 (Visceral Transformation Map) or anything downstream (Subtopic Generation, Content Builder, Design, Copywriting, Export, Pricing, Bundles) — those are future phases and are intentionally absent from this document. Actual lead magnet *content* (its title, structure, subtopics) is also out of scope — Step 5 produces only the yes/no + type decision.

**Status:** All 16 items in §4 confirmed by Arman on 2026-08-22, as proposed — no corrections needed this pass (unlike Phase 2's first draft, which had two factual errors caught on review). This document mirrors the structure and conventions of `phase1-requirements.md` and `phase2-requirements.md` (Data Model → domain logic → Output/UI → Decisions Locked).

---

## 1. Data Model

### 1.1 Lead Magnet Type Taxonomy (given by spec, made precise here)

The source spec names two types but doesn't define what distinguishes them. Defined concretely so both the AI prompt and the guardrail have an unambiguous target:

| Type | Definition | Relationship to paid product | Example |
|---|---|---|---|
| `stripped_sample` | A subset of the *same* paid product — same structure, same format, reduced scope (fewer sections/categories/chapters/pages) | Structurally dependent — doesn't exist independently, is a literal excerpt/carve-out of the paid deliverable | Paid: "Complete Notion Financial Planning System" (12 modules) → Lead magnet: same system, 1 module only |
| `standalone_funnel` | A smaller but *complete* product on an adjacent/precursor topic that naturally leads a user toward the paid product's topic | Structurally independent — has full standalone utility even if the user never buys the paid product | Paid: "Complete Notion Financial Planning System" → Lead magnet: "Free 1-Page Budget Snapshot Template" (complete in itself, but a user who likes it is primed for the full system) |

**Scope boundary, explicit:** Step 5 records *which type is recommended/confirmed*, not the lead magnet's actual content. No fields here capture what the lead magnet's title, module count, or subtopics would be — that's a future phase's job (flagged in §4, item 14, as an open question for whoever scopes it).

### 1.2 Single Table: `lead_magnet_recommendations`

**Confirmed: same single-table design as `format_recommendations`** (confirm-in-place for accepting, supersede-and-copy-forward for changing after confirmation) — the cardinality here (1 recommendation → accept/override) is the same shape as Step 4, not Step 2's N-candidates-to-pick-among shape, so the same reasoning that ruled out a two-table pattern in Phase 2 applies unchanged.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects) | no | |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Snapshot of the locked title this was generated against — staleness check vs. §1.6 |
| `format_recommendation_id` | uuid (fk → format_recommendations) | no | Snapshot of the **confirmed** Step 4 row this was generated against — staleness check vs. §1.6. **New vs. Step 4's model** — Step 4 had no upstream recommendation table to snapshot; Step 5 does. |
| **Recommendation fields (set at generation time, never edited after):** |
| `recommended_suitable` | boolean | no | The yes/no gate |
| `recommended_type` | enum `lead_magnet_type` | yes | `stripped_sample` / `standalone_funnel` / null. **Null forced when `recommended_suitable = false`** (§2.4 guardrail rule) |
| `confidence` | enum `confidence_level` | no | high / medium / low — **reuses Step 4's enum type**, no new type needed |
| `reasoning_summary` | text | no | Plain-English 1–2 sentence explanation |
| `reasoning_signals` | jsonb | no | Array of `{source, detail}` — same contract as Step 4 (§2.3) |
| `alternate_type_considered` | enum `lead_magnet_type` | yes | Populated only when `recommended_suitable = true` and confidence is medium/low and it was a close call between the two types. Direct analog of Step 4's `alternate_format_considered`. |
| `inputs_snapshot` | jsonb | no | Full snapshot: title text, Step 1 rationale, demand/competition scores + signal detail, **and Step 4's `confirmed_format`/`confirmed_delivery_mode`** — new input vs. Step 4 |
| `model` | text | no | e.g. `openai/gpt-oss-120b` |
| `generation_status` | enum `generation_status` | no | `succeeded` / `failed_fallback` / `failed_blocked` — **reuses Step 4's enum type** |
| **Confirmation fields (null until the user acts, set once, then immutable):** |
| `confirmed_suitable` | boolean | yes | Null until user confirms |
| `confirmed_type` | enum `lead_magnet_type` | yes | Null until confirmed; null forever if `confirmed_suitable = false` |
| `is_override` | boolean | yes | True if `confirmed_suitable != recommended_suitable`, OR (`confirmed_suitable = true` AND `confirmed_type != recommended_type`) — see §3.2 |
| `override_reason` | text | yes | Optional, low priority — same treatment as Step 4 |
| `confirmed_by` | uuid (fk → users) | yes | |
| `confirmed_at` | timestamptz | yes | |
| **Row lifecycle:** |
| `recommendation_status` | enum `recommendation_status` | no | `active` / `superseded` — reuses Step 4's enum type. One active row per project. |
| `superseded_at` | timestamptz | yes | |
| `superseded_reason` | enum `lm_supersede_reason` | yes | `title_changed` / `format_changed` / `user_requested_reconsider` / `user_requested_change` / null — **new enum, one extra value (`format_changed`) vs. Step 4's** |
| `created_at` | timestamptz | no | default now() |

**Row lifecycle behavior — identical mechanics to `format_recommendations` (Phase 2 §1.2):**
- **Generation** (first entry, or Reconsider): new row, recommendation fields populated, confirmation fields null, `recommendation_status = 'active'`. Any prior active row is superseded first.
- **Confirmation** (accept-as-is, or override in either direction): updates the existing active row in place.
- **"Change" after confirmation**: existing row superseded (`superseded_reason = 'user_requested_change'`), new row inserted copying recommendation fields forward, confirmation fields reset to null.
- **Upstream invalidation** (title or format changes): see §1.6 — this is where Step 5 differs meaningfully from Step 4, since it now has *two* upstream dependencies instead of one.

### 1.3 `projects` Table Extensions

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `current_lead_magnet_recommendation_id` | uuid (fk → lead_magnet_recommendations) | yes | Points at the currently active (non-superseded) row |
| `status` | enum `project_status` | no | **Extended** — see §1.5 |

### 1.4 Enums

| Enum | Values | Status |
|---|---|---|
| `lead_magnet_type` | `stripped_sample`, `standalone_funnel` | New |
| `lm_supersede_reason` | `title_changed`, `format_changed`, `user_requested_reconsider`, `user_requested_change` | New |
| `confidence_level` | `high`, `medium`, `low` | Reused from Step 4 — no new type |
| `generation_status` | `succeeded`, `failed_fallback`, `failed_blocked` | Reused from Step 4 — no new type |
| `recommendation_status` | `active`, `superseded` | Reused from Step 4 — no new type |

**Deterministic rule (not left to the AI):** if `recommended_suitable = false`, `recommended_type` is force-set to `null` at write time regardless of what the model returns. Same rule applies to `confirmed_type` when `confirmed_suitable = false`. Direct analog of Step 4's ebook→null-delivery-mode rule — see §2.4.

### 1.5 `project_status` Extension

Phase 1–2 flow: `draft` → `researching` → `title_selected` → `format_recommending` → `format_selected`.

**Confirmed:** extend with two new values, mirroring the existing transient/terminal pattern:

| Status | Meaning |
|---|---|
| `format_selected` | (existing) Format locked, Step 5 not yet started |
| `lead_magnet_checking` | **New.** Step 5 in progress — recommendation generated (or regenerating), awaiting user acknowledgment or override. Mirrors `format_recommending`. |
| `lead_magnet_reviewed` | **New.** Terminal state for this phase. Covers **both** outcomes — "lead magnet type confirmed" and "no lead magnet, confirmed" — as one status value. Which outcome it was lives in the row's `confirmed_suitable`/`confirmed_type` fields, not in `project_status`, mirroring how Phase 2 doesn't encode override-vs-accept in the status enum either. |

**Confirmed:** confirmation is explicit and required to reach `lead_magnet_reviewed` even when the recommendation is "not suited" — but the *weight* of that confirmation differs from Step 4's (see §3.3). This is flagged explicitly because it's the one place this phase most plausibly diverges from "no silent auto-accept" as applied in Phases 1–2.

### 1.6 Re-recommendation, Locking & Staleness Rules

Structured identically to Phase 2 §1.6, with one structural addition: Step 5 has **two** upstream dependencies (title *and* format) instead of one, so it needs two independent staleness checks, not one.

| Trigger | Behavior |
|---|---|
| First entry into Step 5 (project reaches `format_selected`) | **Confirmed:** auto-fire the recommendation generation call immediately (no manual "Generate" button) — status moves `format_selected` → `lead_magnet_checking`. Mirrors Step 4's decision 7. |
| User clicks "Reconsider" while `lead_magnet_checking` (pre-confirm) | New row inserted (fresh AI call); previous row superseded, `superseded_reason = 'user_requested_reconsider'`. **Confirmed cap: 5 reconsiders per project** — same number as Step 4, for consistency, though the case for a lower/no cap is weaker cost-benefit here (see §4). |
| User confirms (yes+type, or no) | Confirmation fields filled on the existing active row — no new row. `projects.status` → `lead_magnet_reviewed`. |
| User clicks "Change" after `lead_magnet_reviewed` | Existing row superseded (`superseded_reason = 'user_requested_change'`); new row inserted copying recommendation fields forward, confirmation reset to null. `projects.status` reverts `lead_magnet_reviewed` → `lead_magnet_checking`. |
| User changes the **selected title** (Phase 1's "Change Selection") while status is `lead_magnet_checking` or `lead_magnet_reviewed` | **Cascading invalidation**, transitively through Step 4 (Phase 2 §1.6 already voids the format recommendation on title change; Step 5's active row is superseded here too, `superseded_reason = 'title_changed'`); `current_lead_magnet_recommendation_id` cleared; `projects.status` follows the title's own revert all the way back to `researching`. Step 4 and Step 5 must both be fully redone. |
| User changes the **confirmed format** via Step 4's "Change Format" (or a subsequent re-confirm with different values) while status is `lead_magnet_checking` or `lead_magnet_reviewed` | **New vs. Phase 2 — cascading invalidation scoped to Step 5 only** (title unchanged, so Step 4's own state is fine): active `lead_magnet_recommendations` row superseded, `superseded_reason = 'format_changed'`; `current_lead_magnet_recommendation_id` cleared; `projects.status` reverts to `format_recommending` (Step 4's transient state) until format is re-confirmed, at which point Step 5 re-auto-fires per row 1. Directly answers the "is Step 5 invalidated by format alone" question: **yes**, because Step 4's confirmed format is a direct input to Step 5's reasoning (§2.1) — a stale format snapshot means stale reasoning, same logic as the title case. |

**Detection mechanism:** lazy staleness check (established pattern) — Step 5 compares its stored `title_candidate_id` against `projects.selected_candidate_id`, and its stored `format_recommendation_id` against `projects.current_format_recommendation_id`, whenever it loads or the user acts. A mismatch on *either* triggers self-invalidation per the rows above. No eager push from Steps 3/4 into Step 5's code — same decoupling rationale as Phase 2.

---

## 2. Recommendation Logic Requirements

### 2.1 Inputs

| Input | Source | Included? | Why |
|---|---|---|---|
| Selected title text | `title_candidates.candidate_text` | Yes | Same rationale as Step 4 — title framing signals whether the niche has a natural "smaller/free" entry point (e.g. "The Complete System" implies a modular product that samples well; a single-use quiz less so) |
| Step 1 rationale | `title_ideas.rationale` | Yes | Captures audience/intent context not visible in the title alone — e.g. rationale mentioning a crowded market is a stronger "differentiate with a lead magnet" signal than the title text |
| Demand score + `demand_signal_detail` | `title_candidates` | Yes | A niche with real but not-yet-massive demand is where lead-magnet-driven list building is most worth the build effort; very low-demand niches often don't have enough audience volume to justify a two-tier funnel |
| Competition score + `competition_signal_detail` | `title_candidates` | Yes | High competition (crowded niche) is a classic case *for* a lead magnet as a differentiation/trust-building play before asking for payment |
| Confirmed format + confirmed delivery mode | `format_recommendations` (confirmed row) | **Yes — new vs. Step 4** | Directly shapes which lead magnet type is *feasible*: a modular tracker/workbook naturally samples down (`stripped_sample`); a single-narrative ebook or a one-shot quiz often doesn't sample well and skews toward `standalone_funnel` (or "not suited") instead. This is why Step 5 must fire *after* Step 4 is confirmed, not alongside it — see §2.2. |
| Other unselected title candidates / `alternate_format_considered` | `title_candidates`, `format_recommendations` | No | Same exclusion logic as Step 4 — the decision is about the *chosen* title and *confirmed* format only, not discarded alternatives |

### 2.2 Generation Approach — Hybrid, Separate Call From Step 4

**Confirmed: same hybrid pattern as Step 4** (single Groq structured JSON-mode call + deterministic guardrail), issued as its **own dedicated call, not merged into Step 4's generation call.**

**Why still AI over pure rules:** "clearly suited" is a qualitative judgment over title framing, niche structure, and format shape — the same class of problem Step 4 argued keyword-matching alone can't reliably resolve.

**Why a separate call, explicitly weighed against combining (per the brief's ask):**

| Consideration | Combined (one call at Step 4 time) | Separate (dedicated Step 5 call, fired after Step 4 confirms) |
|---|---|---|
| Input freshness | Reasons against the AI's *recommended* format, which the user may then override at confirm time — the lead-magnet reasoning could reference a format the user never actually picked | Reasons against the *confirmed* format — always accurate, no staleness window |
| Regeneration on override | Would need to re-fire the combined call any time format is overridden or changed, defeating the "fewer calls" motivation | Naturally re-fires only when needed, via the same staleness mechanism already required for title changes (§1.6) |
| Coupling / decoupling principle | Couples two independently-evolving prompts/guardrails into one code path — a future prompt tweak to lead-magnet logic risks touching Step 4 | Fully decoupled, matching the "zero regression risk" precedent Phase 2 established for Step 4 vs. Steps 1–3 |
| Cost/latency | Marginally fewer Groq calls | One extra Groq call per project (~same order as Step 4's decision 3, already ruled a non-issue on Groq's pricing/speed) |

**Conclusion — Confirmed: keep separate.** The staleness/correctness risk of reasoning against a not-yet-confirmed format outweighs the negligible cost savings of combining, and it preserves the decoupling principle that made Phase 2 low-risk to build against Phase 1. Flagged for Arman's confirmation since the source spec doesn't mandate either way.

**Guardrail layer** — deterministic post-processing before persisting, same "never trust AI blindly on hard rules" posture as Step 4:

| # | Rule |
|---|---|
| 1 | `recommended_suitable` must be a boolean — reject/retry once on malformed output. |
| 2 | **If `recommended_suitable = false`, force `recommended_type = null`** regardless of what the model returned. Direct analog of Step 4's ebook→null-delivery-mode rule (§1.4) — the AI must never be trusted to name a type when it said "not suited." |
| 3 | If `recommended_suitable = true` and `recommended_type` is null/invalid, default to `stripped_sample` (lower-effort, always-feasible default given any format) and downgrade `confidence` to `low`. |
| 4 | `reasoning_signals` must be non-empty; if empty, still persist but downgrade `confidence` to `low`. Same as Step 4 rule 4. |
| 5 | `alternate_type_considered` is force-set to `null` whenever `recommended_suitable = false` — it's only meaningful when a type was actually being chosen between. |

### 2.3 "Stated Reason" Output Contract

Same evidence-tagged JSON contract as Step 4 — the yes/no nature changes the field values, not the shape:

```json
{
  "recommended_suitable": true,
  "recommended_type": "standalone_funnel",
  "confidence": "medium",
  "reasoning_summary": "This niche is competitive enough that a free, complete budget snapshot template would build trust before asking for the full paid system, and the confirmed workbook format doesn't sample down cleanly enough for a stripped excerpt to feel complete on its own.",
  "reasoning_signals": [
    { "source": "competition_signal_detail", "detail": "Exact-angle Etsy competition is high (score 3/10) — differentiation via a free entry point is a stronger lever than in a white-space niche" },
    { "source": "confirmed_format", "detail": "Format confirmed as workbook/fillable — a single-module excerpt reads as incomplete, favoring a standalone product over a sample" },
    { "source": "rationale", "detail": "Step 1 rationale emphasizes reaching a broad beginner audience, which favors a low-friction free entry point" }
  ],
  "alternate_type_considered": "stripped_sample"
}
```

```json
{
  "recommended_suitable": false,
  "recommended_type": null,
  "confidence": "high",
  "reasoning_summary": "Demand signals are modest and the niche is narrow enough that building and maintaining a separate free product isn't likely to pay back the effort versus focusing on the paid product alone.",
  "reasoning_signals": [
    { "source": "demand_signal_detail", "detail": "Average favorites/views are in the lowest bucket — limited audience volume to fuel a two-tier funnel" },
    { "source": "title", "detail": "Title framing is narrowly scoped to a single specific use case, leaving little room for a distinct complete standalone product" }
  ],
  "alternate_type_considered": null
}
```

- `reasoning_summary` is the only field rendered by default; `reasoning_signals` is expandable detail — same UI treatment as Step 4.
- Every signal must be attributed to one of: `title` / `rationale` / `demand_signal_detail` / `competition_signal_detail` / `confirmed_format`.

### 2.4 Suitability Gate — Summary

The gate is binary and enforced deterministically (§2.2 rule 2), not left as an AI judgment call once made: `recommended_suitable = false` **always** implies `recommended_type = null` and `alternate_type_considered = null` in the persisted row, no exceptions.

### 2.5 Trigger & "Not Automatic" — What It Actually Governs

**Confirmed interpretation:** the spec's "not automatic on every product" describes the *recommendation outcome* (whether PROTO suggests building one), not whether the *generation call* fires. The underlying AI call still auto-fires on entry (§1.6 row 1) — PROTO has to actually evaluate suitability before it can know whether to suggest anything. What "not automatic" changes is purely the **UI weight given to a "no" outcome** (§3.3) — a lightweight banner rather than a full recommendation card, not a skipped step.

---

## 3. Output / Override Requirements

### 3.1 Object Exposed to UI

| Field | Source | Purpose |
|---|---|---|
| `recommended_suitable` | `lead_magnet_recommendations` (active row) | Drives which UI mode renders (§3.3) |
| `recommended_type` | `lead_magnet_recommendations` (active row) | Headline recommendation, hidden when `recommended_suitable = false` |
| `reasoning_summary` | `lead_magnet_recommendations` (active row) | Default-visible "why," in both outcomes |
| `reasoning_signals` | `lead_magnet_recommendations` (active row) | Expandable "show evidence" detail |
| `confidence` | `lead_magnet_recommendations` (active row) | Drives whether `alternate_type_considered` is surfaced |
| `alternate_type_considered` | `lead_magnet_recommendations` (active row) | Surfaced only when `recommended_suitable = true` **and** `confidence` is `medium`/`low` |

### 3.2 Override Mechanism

**Confirmed:** a 3-way control, always available regardless of what PROTO recommended — `None` / `Stripped-Down Sample` / `Standalone Funnel Product` — so the user can move freely in any direction:

| Scenario | `confirmed_suitable` | `confirmed_type` | `is_override` |
|---|---|---|---|
| PROTO said yes/type X, user accepts as-is | `true` | `X` | `false` |
| PROTO said yes/type X, user picks type Y instead | `true` | `Y` | `true` |
| PROTO said yes, user picks "None" | `false` | `null` | `true` |
| PROTO said no, user accepts as-is | `false` | `null` | `false` |
| PROTO said no, user picks a type anyway | `true` | `X` | `true` |

- PROTO's original recommendation and reasoning stay visible alongside the override control at all times (matches Step 4's §3.2 requirement) — never replaced by the picker.
- `override_reason`: optional, low priority, same as Step 4.

### 3.3 "No Lead Magnet" Confirmation Weight — Explicit Design Question

**Confirmed default:** even when `recommended_suitable = false`, the user still takes **one explicit lightweight action** to reach `lead_magnet_reviewed` — a single "Continue — no lead magnet needed" click — rather than the step silently auto-advancing with no action at all. This differs from Step 4's full confirm flow in *weight* (a condensed banner + one button, not a full recommendation card with a picker requiring engagement), but not in *mechanism* — it still writes `confirmed_suitable = false`, `confirmed_by`, `confirmed_at` to the row and produces a real audit record, consistent with the "no silent auto-accept" principle carried from Phases 1–2.

**UI shape by outcome:**

| Outcome | UI |
|---|---|
| `recommended_suitable = true` | Full recommendation card (mirrors Step 4): headline type, reasoning, evidence, override picker, explicit confirm |
| `recommended_suitable = false` | Condensed one-line banner ("PROTO doesn't recommend a companion lead magnet for this product — [reason]") with a single "Continue" button and a secondary "Add one anyway" expander that reveals the same 3-way picker if the user wants to override |

**Alternative considered and rejected as default:** fully silent auto-advance (no click at all) when `recommended_suitable = false`, with `project_status` moving straight to `lead_magnet_reviewed` and `confirmed_suitable` auto-populated without a `confirmed_by`/`confirmed_at` user action. Rejected as the default because it breaks the "every terminal state was explicitly reached by a user action" invariant used everywhere else in the pipeline, and because it forecloses the override path (a user who wants a lead magnet despite PROTO's "no" needs a place to say so). **Flagged explicitly — if Arman prefers zero-friction skip over the lightweight click, this is the one line item to change.**

### 3.4 Status on Completion

`projects.status = 'lead_magnet_reviewed'` once the user explicitly confirms — either outcome (yes+type, or the lightweight "no" acknowledgment in §3.3) reaches this same terminal value. No auto-completion on generation alone.

---

## 4. Decisions Locked (2026-08-22)

| # | Decision |
|---|---|
| 1 | Single-table design (`lead_magnet_recommendations`, no separate selections table) — confirm-in-place, supersede-and-copy-forward. Direct precedent from Phase 2 decision 4. |
| 2 | Two lead magnet types defined as `stripped_sample` (subset of paid product) vs. `standalone_funnel` (complete adjacent product) per §1.1. |
| 3 | Step 5 captures only the yes/no + type decision, never lead-magnet content — content/build happens in a future, unscoped phase (see decision 14). |
| 4 | Override supports all directions via a 3-way picker (None / Sample / Standalone), not just accept-or-pick-alternate-type — needed because PROTO's gate can be flipped in either direction, unlike Step 4's 4-way-pick-among-valid-options shape. |
| 5 | **"No lead magnet" outcome still requires one lightweight explicit click, not a silent auto-skip.** Confirmed as proposed — the most debatable call in this doc; see §3.3 for the rejected silent-auto-advance alternative. |
| 6 | `project_status` gets one new terminal value (`lead_magnet_reviewed`) covering both outcomes; the yes/no distinction lives in row fields, not the status enum — mirrors how Step 4 doesn't encode override-vs-accept in `project_status` either. |
| 7 | **Step 5 issues its own dedicated Groq call, not combined with Step 4's — fires only after Step 4's format is confirmed.** Confirmed as proposed, argued in full in §2.2 — main risk of combining was reasoning against a not-yet-confirmed format. |
| 8 | Guardrail forces `recommended_type = null` (and `alternate_type_considered = null`) whenever `recommended_suitable = false`. Direct analog of Step 4's ebook→null-delivery-mode hard rule. |
| 9 | Inputs include Step 4's **confirmed** format + delivery mode in addition to the four Step 2/4 signals — new vs. Step 4, justified in §2.1. |
| 10 | Auto-fire generation on reaching `format_selected` (no manual "Generate" click) — mirrors Step 4 decision 7. |
| 11 | Reconsider soft cap: 5 per project — kept equal to Step 4's cap for consistency. |
| 12 | `alternate_type_considered` field included, surfaced only when `confidence` is medium/low **and** `recommended_suitable = true` — direct analog of Step 4's `alternate_format_considered`. |
| 13 | Staleness triggers: **both** title change (cascades transitively through Step 4, same as Phase 2's existing cascade) **and** format change alone (title unchanged, Step 5-only cascade back to `format_recommending`) invalidate Step 5 — confirmed format is a first-class input (§2.1, §1.6). |
| 14 | Future lead-magnet content/build (its own title, structure, whether it needs a `projects`-like record of its own) is explicitly **not decided here** — noted as future scope, no action needed now. |
| 15 | `override_reason` capture: optional, low priority, not required for MVP — following Step 4's identical decision. |
| 16 | `confidence_level`, `generation_status`, `recommendation_status` Postgres enum types are reused from Step 4 rather than duplicated — no new types needed for values already covered. |

**Status: Step 5 requirements are locked. Not yet built** — DEV work starts now.
