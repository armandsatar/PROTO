# PROTO — Phase 4 Technical Requirements: Step 6 (Visceral Transformation Map)

**Scope:** Spec Step 6 only — PROTO generates a before/after customer transformation journey for the confirmed title, and the user can edit/regenerate it. Consumes the confirmed title (Steps 1–3). Does **not** cover Step 7 (Subtopic Generation) or anything downstream (Content Builder, Design, Copywriting, Export, Pricing, Bundles) — those are future phases and are intentionally absent from this document.

**Status:** All 13 items in §5 confirmed by Arman on 2026-08-22, as proposed — no corrections needed this pass. Unlike Phases 2–3, this document does **not** default to the recommend/confirm pattern — see §0 for the explicit shape analysis this required, per the brief's instruction not to copy Phase 2/3's structure by habit.

---

## 0. Shape Determination — Why This Is Not Recommend/Confirm

Phases 2 and 3 both had a genuine **decision gate**: a small enumerable option space (4 formats × 2 delivery modes; suitable/not-suitable × 2 types), where PROTO proposes one point in that space and the user either accepts it or picks a different point in the *same* space. That shape is what justified the single-table `recommended_*` / `confirmed_*` column pairs, `is_override`, and supersede-and-copy-forward.

Step 6 has none of that structure:

| Property | Phase 2/3 (Steps 4/5) | Step 6 |
|---|---|---|
| Output space | Small fixed enum (format × delivery mode; suitable × type) | Open qualitative text across multiple fields — not enumerable |
| What "override" means | Pick a different point in the same finite space | Not meaningful — there's no discrete alternative to "pick instead of." A user who dislikes the AI's phrasing doesn't select a different enum value, they **rewrite the sentence** |
| Natural user action | Accept, or pick-and-confirm | Read, tweak wording field-by-field, regenerate individual attempts, iterate |
| Content volume per artifact | ~5 short fields (1–2 sentences each) | ~10 text fields (headline pair + 4 dimension pairs), each ideally a few sentences — a genuine draft, not a classification |
| Cost of forcing "confirm-in-place, else supersede-and-copy-forward" | Cheap — copying 2 enum values forward is free | Expensive if applied naively — a "Change" action that supersedes-and-copies-forward would either (a) discard the user's hand-edits, or (b) require field-level diffing to know what to preserve, which the Phase 2/3 pattern was never designed to do |

**Conclusion: Step 6 is editable-content-shaped, not recommend/confirm-shaped.** The closer precedent already in this codebase is **Phase 1's `title_ideas`** (a single mutable, directly-editable row) **plus `research_runs`** (an immutable, append-only log of each generation attempt, kept for audit/cost tracking) — not Phase 2/3's single confirm-in-place table. Step 6 borrows that two-table split, and separately borrows Phase 2/3's *state-machine* conventions (explicit confirm required to advance, explicit unlock required to revise) without borrowing their *column* conventions (`recommended_*`/`confirmed_*`/`is_override`). See §1 for the concrete result.

This is the single most consequential call in this document — flagged in §5, item 1, for Arman's explicit confirmation before build starts.

---

## 1. Data Model

### 1.1 Two tables, not one: generation log + live editable content

| Table | Cardinality | Mutability | Role |
|---|---|---|---|
| `transformation_map_generations` | Many per project (one per AI generation attempt: initial auto-fire, or explicit "Regenerate") | **Immutable once completed** — append-only, mirrors `research_runs` | The audit/cost-tracking log of every AI attempt and exactly what it produced |
| `transformation_maps` | Exactly 1 per project (1:1) | **Mutable** — directly user-editable, mirrors `title_ideas` | The live, current content record. Seeded from the latest generation, then freely hand-edited in place. What Step 7 will eventually read from. |

### 1.2 `transformation_map_generations`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects) | no | |
| `generation_number` | int | no | Sequential per project (1, 2, 3…), for display ("Attempt 3 of 5") |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Snapshot of the locked title this was generated against — staleness check vs. §1.6 |
| `inputs_snapshot` | jsonb | no | Title text, Step 1 rationale, demand/competition scores + signal detail at generation time (§3.1) |
| `headline_before` / `headline_after` | text | no (on success) | Single-sentence global summary pair — see §2.1 schema |
| `dim_emotional_before` / `dim_emotional_after` | text | no (on success) | See §2.1 |
| `dim_practical_before` / `dim_practical_after` | text | no (on success) | See §2.1 |
| `dim_identity_before` / `dim_identity_after` | text | no (on success) | See §2.1 |
| `dim_pain_point_before` / `dim_pain_point_after` | text | no (on success) | See §2.1 |
| `model` | text | no | e.g. `openai/gpt-oss-120b` |
| `generation_status` | enum `generation_status` | no | `succeeded` / `failed_fallback` / `failed_blocked` — reuses Phase 2/3's enum type |
| `error_detail` | text | yes | Sanitized only, per Section 2's no-secrets-in-errors rule — mirrors `research_runs.error_detail` |
| `created_at` / `completed_at` | timestamptz | created_at no, completed_at yes | |

All 10 content fields are nullable at the row level only to accommodate `failed_blocked` rows (see §3.4) — on `succeeded` or `failed_fallback`, all 10 are populated (fallback populates placeholder scaffolding, not real nulls — §3.4).

### 1.3 `transformation_maps` (the live content record)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects, **unique**) | no | 1:1, same shape as `title_ideas.project_id` |
| `source_generation_id` | uuid (fk → transformation_map_generations) | no | Which generation most recently seeded this row's content (updated on every Regenerate) |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Snapshot for staleness check — mirrors the generation row's snapshot, kept independently since this row can outlive several generations |
| `headline_before` / `headline_after` | text | no | **Editable.** Seeded from `source_generation_id`'s values, then user-mutable in place |
| `dim_emotional_before` / `dim_emotional_after` | text | no | Editable — see §2.1 |
| `dim_practical_before` / `dim_practical_after` | text | no | Editable |
| `dim_identity_before` / `dim_identity_after` | text | no | Editable |
| `dim_pain_point_before` / `dim_pain_point_after` | text | no | Editable |
| `is_edited` | boolean | no | default `false`. Set `true` on any manual field edit since the last (re)generation; reset `false` whenever content is overwritten by a new generation |
| `last_edited_at` / `last_edited_by` | timestamptz / uuid (fk → users) | yes | Null until first manual edit |
| `status` | enum `transformation_map_status` | no | `draft` (editable) / `confirmed` (locked — see §1.5) |
| `confirmed_at` / `confirmed_by` | timestamptz / uuid (fk → users) | yes | Null until confirmed |
| `regenerate_count` | int | no | default 0. Increments on every Regenerate — drives the soft cap (§1.6) |
| `created_at` / `updated_at` | timestamptz | no | |

**No `recommended_*`/`confirmed_*`/`is_override` columns exist here** — deliberate, per §0. There is one current value per field, not a recommended-vs-confirmed pair, because the user doesn't choose between two given options; they edit toward whatever they want.

### 1.4 `projects` Table Extensions

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `current_transformation_map_generation_id` | uuid (fk → transformation_map_generations) | yes | Points at the latest generation attempt (for the "Attempt N of 5" UI and staleness bookkeeping) |
| `status` | enum `project_status` | no | **Extended** — see §1.5 |

(No separate "current map" pointer needed — `transformation_maps` is 1:1 with `projects`, unlike the recommendation tables which needed a pointer because multiple superseded rows could exist per project.)

### 1.5 `project_status` Extension

Phase 1–3 flow: `draft` → `researching` → `title_selected` → `format_recommending` → `format_selected` → `lead_magnet_checking` → `lead_magnet_reviewed`.

| Status | Meaning |
|---|---|
| `lead_magnet_reviewed` | (existing) Step 5 done, Step 6 not yet started |
| `transformation_mapping` | **New.** Step 6 in progress — `transformation_maps` row exists in `draft` status, editable, awaiting explicit confirm. Mirrors the transient-state pattern, but here "in progress" can legitimately last much longer (open-ended editing), not just a brief recommend-then-click window. |
| `transformation_map_confirmed` | **New.** Terminal state for this phase — user explicitly confirmed the map is ready. `transformation_maps.status` moves in lockstep with this (`draft`↔`transformation_mapping`, `confirmed`↔`transformation_map_confirmed`). |

Confirmation is explicit and required to leave `transformation_mapping`, matching the "no silent auto-accept" principle carried through every phase so far — even though there's no accept-vs-override distinction to record here, there is still a real "I'm done editing, this is ready" action the user must take, since Step 7 needs a stable, intentional input rather than a moving draft.

### 1.6 Generation, Edit, Regenerate, Confirm, Unlock — Explicit Behaviors

This is Step 6's equivalent of Phase 2/3 §1.6 (their "re-recommendation & locking rules" table) — restated for a mutable-content shape rather than a supersede-shaped one.

| Action | What happens | Which table(s) change |
|---|---|---|
| **First entry** (project reaches `lead_magnet_reviewed`) | Auto-fires the AI call (no manual "Generate" button — mirrors Steps 4/5). Inserts `transformation_map_generations` row #1. **Upserts** `transformation_maps` (creates the 1:1 row, all 10 fields copied from generation #1, `is_edited=false`, `status='draft'`). `projects.status` → `transformation_mapping`. | Both, insert |
| **Edit** (user types into any of the 10 fields, in `draft` status only) | Direct mutation of `transformation_maps` fields in place. Sets `is_edited=true`, `last_edited_at`/`last_edited_by`. **No new row anywhere** — this is the key difference from Phases 2/3, where every state change was a new/updated recommendation row. | `transformation_maps` only, update-in-place |
| **Regenerate** (explicit button, `draft` status only) | Fires a fresh AI call → inserts a new `transformation_map_generations` row (`generation_number` + 1). **If `transformation_maps.is_edited = true`, a confirmation modal warns the user their manual edits will be overwritten** before proceeding — this is destructive to hand-edits and must not happen silently. On confirm: all 10 fields on `transformation_maps` are overwritten with the new generation's output, `source_generation_id` updated, `is_edited` reset to `false`, `regenerate_count` +1. **Soft cap: 5 regenerations per project** (same number as Steps 4/5, for consistency — see §5). | Both — insert on generations, overwrite-in-place on maps |
| **Confirm** (explicit action, `draft` status only) | Sets `transformation_maps.status='confirmed'`, `confirmed_at`/`confirmed_by`. `projects.status` → `transformation_map_confirmed`. Content fields become read-only in the UI (not schema-enforced immutable — see follow-up below). | `transformation_maps` only, update-in-place |
| **Unlock / "Edit Map"** (explicit action, only available in `transformation_map_confirmed`) | Sets `transformation_maps.status` back to `draft`, clears `confirmed_at`/`confirmed_by`. `projects.status` reverts `transformation_map_confirmed` → `transformation_mapping`. **Content is preserved, not cleared** — this is a deliberate difference from Phase 1's title-selection unlock (which does clear the pointer), because here the "locked" content is the very thing worth keeping; the user is resuming editing, not starting over. | `transformation_maps` only, update-in-place |
| **Upstream title change** (Phase 1's "Change Selection" unlock, while status is `transformation_mapping` or `transformation_map_confirmed`) | **Soft staleness flag, not hard invalidation** — see §4. Content is **not** cleared and `projects.status` is **not** force-reverted to `researching` the way Phase 2/3 cascade. A banner surfaces; the user chooses to regenerate or hand-edit. Explicit divergence from Phase 2/3's cascade pattern — justified in §4. | Neither table is mutated automatically; UI-level flag only, computed at read time |

**Follow-up flagged, not blocking (mirrors Phase 2's decision-4 follow-up):** whether to schema-enforce read-only-when-confirmed (e.g. an UPDATE RLS policy gated on `status = 'draft'`) vs. relying on UI-level disabling alone is a build-time detail, not an open requirements question — recommend the RLS gate for consistency with the rest of the app's "offload to managed infrastructure" principle (Section 2), but not deciding the exact policy syntax here.

### 1.7 Enums

| Enum | Values | Status |
|---|---|---|
| `transformation_map_status` | `draft`, `confirmed` | New |
| `generation_status` | `succeeded`, `failed_fallback`, `failed_blocked` | Reused from Phase 2/3 — no new type |

---

## 2. What "Visceral Transformation Map" Concretely Contains

### 2.1 Schema: one global headline pair + four dimensional pairs

"Map" implies more than one before/after point, and "visceral" specifically demands gut-level, sensory, identity-level content — not a feature list. A single generic before/after pair ("before: disorganized. after: organized.") satisfies neither. The schema below is **grounded in an established copywriting/messaging framework** rather than invented ad hoc: StoryBrand's three-level problem model (external / internal / philosophical) is a widely-used, well-documented split of exactly the "practical vs. emotional vs. identity" distinction the brief asked for, and the Before-After-Bridge (BAB) formula is the standard structure for the before/after pairing itself. See sources at the end of this document.

| # | Dimension | Maps to | What it captures | Example (before → after) |
|---|---|---|---|---|
| — | **Headline** (global) | BAB's top-line Before/After | One-sentence, high-level summary pair — the "at a glance" version, used as the default-visible summary (mirrors `reasoning_summary`'s role in Phases 2/3) | "Dreads opening her finances." → "Feels in control of her money." |
| 1 | **Emotional state** | StoryBrand's *internal* problem | How the customer *feels*, gut-level, not what they think or do | "A knot in her stomach every Sunday night before the week's bills are due." → "A calm, almost boring sense that money is handled." |
| 2 | **Practical / behavioral state** | StoryBrand's *external* problem | What the customer concretely *does* day-to-day — actions, time spent, tools used | "Manually reconciling four spreadsheets, ~2 hours every week." → "Opens one dashboard, updates itself, checks it in under 5 minutes." |
| 3 | **Identity / self-perception** | StoryBrand's *philosophical* problem | How the customer sees *themselves* — the story they tell about who they are | "'I'm just bad with money — I'll never get ahead.'" → "'I'm someone who has this handled. I'm in control of my future.'" |
| 4 | **Specific pain point resolved** | Not in StoryBrand; added for "visceral" specifically | One concrete, sensory, moment-specific trigger scenario — this is the field that most directly enforces "visceral" over "generic," since it forces a specific moment rather than an abstract category | "Opening the banking app and feeling a stomach-drop of dread before even looking at the number." → "Opening the banking app on autopilot, no dread, because there are no surprises left." |

**Why four dimensions, not one, and not more:** three (emotional/practical/identity) is directly grounded in StoryBrand's problem model; the fourth (specific pain point) is added because none of the first three structurally *force* concreteness — an AI could satisfy "emotional state" with a generic mood word ("frustrated → relieved") without ever grounding it in a specific moment. The pain-point dimension exists specifically to counteract that failure mode. A fifth, optional dimension — **social/relational state** ("avoids money conversations with partner" → "confidently discusses shared goals") — was considered and is **not** included by default; flagged as PROPOSED-optional in §5, since it's a real and common transformation axis but adds generation cost/length without a clear case that every product needs it (a solo-use tracker product may have no relational angle at all, forcing the AI to invent one).

**Why "visceral" specifically implies structure, not just tone:** if this were a single free-text field ("describe the transformation"), the AI's easiest path under time/token pressure is a generic feature-benefit list ("saves time, reduces stress, more organized"). Forcing four *named, required, non-empty* dimensions — each explicitly labeled in the prompt as needing a felt, sensory, or identity-level answer rather than a functional one — structurally pushes the model away from that shortcut, even though (see §3.3) nothing can *guarantee* visceral tone the way a taxonomy rule can guarantee a valid enum value.

---

## 3. Generation Logic Requirements

### 3.1 Inputs

| Input | Source | Included? | Why |
|---|---|---|---|
| Selected title text | `title_candidates.candidate_text` | Yes — primary | The transformation is *for this specific product's promise*; the title is the clearest statement of what outcome is being sold |
| Step 1 rationale | `title_ideas.rationale` | Yes — primary | Rationale is often where the *specific* pain point and audience context live (e.g. "for freelancers who dread tax season") — directly feeds dimension 4 (specific pain point) and dimension 3 (identity), which the title text alone rarely contains |
| Demand score + `demand_signal_detail` | `title_candidates` | Yes — secondary context | Lower-weight input than title/rationale; can flavor how acute the "before" state is framed (e.g. strong favoriting signals suggest the pain is widely and actively felt, supporting a sharper before-state) |
| Competition score + `competition_signal_detail` | `title_candidates` | Yes — secondary context | Same treatment as Steps 4/5 — a crowded niche can inform the identity dimension's "after" framing (differentiation/relief-from-noise), included for consistency with precedent and because it's already in the snapshot at zero extra cost |
| Confirmed format (`format_recommendations`) | — | **No — deliberately excluded** | See §4. The transformation is about the *customer's* before/after, not the *product's* delivery mechanism; a tracker and an ebook on the same topic describe essentially the same human transformation. Including it would also force this generation step to become a second staleness dependency (§4), which the actual content need doesn't justify. |
| Confirmed lead magnet decision (`lead_magnet_recommendations`) | — | **No — deliberately excluded** | Even more clearly out of scope — lead magnet type is a funnel/marketing-structure decision, not a customer-psychology input. Including it would add a dependency with no plausible effect on the map's content. |
| Other unselected title candidates | `title_candidates` (not selected) | No | Same exclusion logic as Steps 4/5 — the map is about the *chosen* title only |

### 3.2 Generation Approach — AI-only, no deterministic scoring layer to hybridize with

Unlike Steps 4/5, there is no deterministic formula this step is "hybridizing" with — Steps 4/5 combined an AI classification with a rule-based post-processing layer that enforced *hard business rules* (ebook→null delivery mode, not-suitable→null type). Step 6 has no equivalent hard business rule to enforce (see §3.3), so the generation approach is simpler in kind, not just in mechanics:

- **Single Groq structured JSON-mode call** (same connector/pattern — `openai/gpt-oss-120b`), receiving the inputs from §3.1, returning the 10 fields from §2.1 in one shot.
- **Prompt design carries the "visceral" requirement**, not a post-hoc guardrail: the prompt explicitly names each of the 4 dimensions with its definition (§2.1), instructs the model to avoid generic feature-benefit phrasing, and includes one full few-shot example (input title/rationale → output 10-field JSON) demonstrating the sensory/identity-level tone expected. This is a prompt-engineering responsibility, not a validation-layer one.

### 3.3 Guardrail Layer — Structural Only, Explicitly Not a "Visceral" Enforcer

**This is the most important honesty call in this document, per the brief's explicit ask.** Phases 2/3 had a deterministic guardrail because they had *hard, checkable business rules* (an enum must be one of 4 values; ebook forces delivery_mode to null). Step 6 has **no equivalent hard rule** — "is this text visceral enough" is a subjective writing-quality judgment, not a checkable business fact, and building a guardrail that pretends otherwise would just be brittle keyword-matching dressed up as validation.

What the guardrail **does** enforce, deterministically, before persisting:

| # | Rule | Rationale |
|---|---|---|
| 1 | All 10 fields must be present and non-empty on a `succeeded` response — reject/retry once if any are missing/null. | Structural completeness, not content quality — same "retry-once on malformed required-field output" pattern as Phases 2/3. |
| 2 | Each field must meet a minimum length (**PROPOSED: 30 characters**) — reject/retry once if any field is a placeholder-length stub. | Catches degenerate output ("Feels bad." → "Feels good.") without judging tone. |
| 3 | For each dimension, `before` and `after` must not be literally identical strings — reject/retry once if any pair matches exactly. | Catches a lazy no-op response; a cheap deterministic check, not a semantic one. |

**What the guardrail explicitly does NOT do:** it does not score, block, or auto-rewrite content for being "generic" or "not visceral enough." That would require semantic judgment the guardrail layer, by design (Section 2's architecture principle — deterministic checks, not AI-graded-by-AI loops), is not the place for. Two options were considered for going further and both are **rejected as the default**:

- *A second AI call to grade the first AI call's "viscerality"* — rejected: doubles cost/latency for a self-referential judgment with no ground truth to validate against.
- *A banned-generic-phrase blocklist ("saves time," "more organized," etc.) as a hard reject rule* — rejected as a **blocking** rule (too fragile, high false-positive risk on legitimate phrasing) but **PROPOSED as a non-blocking soft signal**: compute a boolean `visceral_quality_flag` heuristically (e.g. does the text contain zero sensory/emotional/first-person language markers) and surface it in the UI as "this section reads a bit generic — consider editing" without blocking save or confirm. Flagged in §5 for Arman's call on whether it's worth building at all for v1.

### 3.4 AI-Failure Fallback — Structural Scaffold, Not a Computed Value

Phase 2's fallback was a keyword heuristic (still produces a real classification). Phase 3's fallback was a conservative safe default (still produces a real boolean/enum). **Neither pattern has a real analog here**, and this document says so explicitly rather than inventing one: there is no keyword rule or conservative default that can produce genuine emotional narrative prose. Keyword-matching can pick an enum; it cannot write a sentence.

**Proposed fallback, on retry-once also failing:** persist the `transformation_map_generations` row with `generation_status = 'failed_fallback'` and all 10 fields populated with **labeled placeholder scaffolding**, not blank fields and not fabricated content passed off as AI output — e.g. `dim_emotional_before = "[Describe how your customer feels before using this product]"`. The UI renders these fields visibly distinct (e.g. italic/gray placeholder styling) until the user overwrites them. `transformation_maps` is still seeded and enters `draft` status normally — the user isn't blocked from proceeding, they're prompted to hand-write the map instead of edit an AI draft. This is flagged as a genuinely different *kind* of fallback than Phases 2/3's, not a smaller version of the same kind — see §5.

If the call fails outright with no retry possible (`failed_blocked` — e.g. connector auth failure, not a malformed-output case), the same placeholder-scaffold behavior applies; `error_detail` is populated (sanitized) per Section 2's no-secrets-in-errors rule.

### 3.5 Output Contract (JSON)

```json
{
  "headline_before": "Dreads opening her finances every Sunday night.",
  "headline_after": "Feels a calm, almost boring sense that money is handled.",
  "dim_emotional_before": "A knot in her stomach every Sunday night before the week's bills are due — a low-grade dread that builds all weekend.",
  "dim_emotional_after": "Sunday nights are just Sunday nights again. No dread, no bracing herself before opening the banking app.",
  "dim_practical_before": "Manually reconciling four spreadsheets and two banking apps, roughly two hours every week, often redone from scratch after a mistake.",
  "dim_practical_after": "Opens one dashboard that updates itself. Checks it in under five minutes, twice a week, out of habit rather than necessity.",
  "dim_identity_before": "\"I'm just bad with money. I'll never really get ahead, no matter how hard I try.\"",
  "dim_identity_after": "\"I'm someone who has this handled. I'm not perfect with money, but I'm in control of my own future.\"",
  "dim_pain_point_before": "Opening the banking app and feeling a stomach-drop of dread before she's even looked at the number.",
  "dim_pain_point_after": "Opening the banking app on autopilot — no bracing, no dread — because there are no surprises left to find."
}
```

- `headline_before`/`headline_after` are the only fields rendered by default (mirrors `reasoning_summary`'s default-visible role in Phases 2/3); the four dimension pairs are the expandable full map.
- No `confidence` or `reasoning_signals`/evidence-attribution fields — those existed in Phases 2/3 because the output was a *classification with a stated reason*. Step 6's output *is* the content; there's nothing separate to "cite evidence" for. Explicitly not carrying that pattern forward.

---

## 4. Staleness — Title Only, and Soft Rather Than Hard

**Conclusion: Step 6 has exactly one upstream dependency — the confirmed title — not two.** Worked through explicitly, per the brief's request:

- **Does the map's own *content* depend on format or lead magnet?** No. The before/after journey describes the customer's emotional/practical/identity transformation on the *topic*, which is substantially independent of whether the paid product ships as a tracker or an ebook, and entirely independent of whether a lead magnet exists. The spec's line — "this shapes what the subtopics need to cover" — describes the map's role as an **input to Step 7**, not a claim that the map itself is shaped by format. Format, lead magnet decision, and the transformation map are three **sibling inputs** that converge at Step 7; the map is not downstream of the other two.
- **Trigger-after vs. depends-on, kept distinct:** Step 6 still **auto-fires only after Step 5 completes** (`lead_magnet_reviewed` → `transformation_mapping`), purely to preserve the existing linear pipeline UX established in Phases 1–3. This is a *sequencing* choice, not a *dependency* one — Step 6 does not snapshot or consume Step 4/5 output, and is never invalidated by Step 4/5 changes. Deliberately not smuggling format in as "soft context, no staleness trigger" either — if an input is worth feeding the prompt, it's worth a real staleness snapshot; a half-measure would silently drift.
- **Practical cost argument, reinforcing the conclusion:** this artifact is expensive to lose — a user may have spent real time hand-editing 10 fields. Making it a second-order dependency of Step 5 (the way Step 5 was of Step 4) would mean routine lead-magnet tweaks blow away hand-written transformation content for no content-relevant reason. That asymmetry (high edit cost vs. low signal value) is itself evidence the dependency shouldn't exist.

**How staleness is detected and handled — soft, not hard, diverging deliberately from Phase 2/3's cascade:**

| | Phase 2/3 (title/format change) | Step 6 (title change) |
|---|---|---|
| Detection | Lazy — compare stored snapshot FK to `projects` current pointer, on load/action | Same mechanism — compare `transformation_maps.title_candidate_id` to `projects.selected_candidate_id`, on load |
| Effect on stored content | Hard: active row superseded, pointer cleared, forced redo | **Soft: a banner/flag only.** `transformation_maps` row and its 10 fields are left untouched. |
| Effect on `projects.status` | Hard: reverts all the way back through the chain to `researching` | `transformation_mapping`/`transformation_map_confirmed` **is** reverted to `transformation_mapping` if it was confirmed (so re-confirmation is still required before Step 7 can trust it), but the content itself is not blanked |
| User's next step | Must fully redo the step | Prompted to either hit Regenerate (fresh AI pass against the new title) or hand-edit the existing text to match — their choice |

**Why softer here, explicitly justified, not just asserted:** Phase 2/3's content was cheap to regenerate (a classification + 1–2 sentence reasoning) and had no user-authored material worth preserving, so hard invalidation cost nothing. Step 6's content can represent real authored effort; silently discarding it on a title edit (even a minor wording tweak) would be a worse outcome than briefly surfacing a "this may be out of date" banner and letting the user decide. This is flagged in §5 as a deliberate, and debatable, divergence from established precedent.

---

## 5. Decisions Locked (2026-08-22)

| # | Decision |
|---|---|
| 1 | **Shape: editable-content (Phase 1's `title_ideas`+`research_runs` pattern), not recommend/confirm (Phase 2/3's pattern).** The single most consequential call in this document — everything else follows from it. See §0. |
| 2 | Schema: headline pair + 4 required dimensions (emotional / practical / identity / specific pain point), grounded in StoryBrand's 3-problem model + BAB. See §2.1. |
| 3 | Optional 5th "social/relational" dimension **excluded from v1**. Real and common transformation axis, but not universal (e.g. solo-use trackers), and adds generation length/cost. Easy to add later. |
| 4 | Guardrail scope: structural only (completeness, min length, before≠after) — explicitly **no** semantic "is this visceral" enforcement. Honesty call: no hard business rule exists here the way it did in Phases 2/3. See §3.3. |
| 5 | Optional non-blocking `visceral_quality_flag` heuristic (generic-phrase detector, UI warning only, never blocks) — **build-later, not v1**. |
| 6 | AI-failure fallback: labeled placeholder scaffolding per field (not blank, not fabricated content), `generation_status='failed_fallback'`, user proceeds to hand-write. A genuinely different *kind* of fallback than Phases 2/3 — no computed value is possible for prose. See §3.4. |
| 7 | Staleness dependency: **title only** — format and lead magnet excluded entirely, not even as soft context. See §4's cost-vs-signal argument. |
| 8 | Staleness handling: **soft flag + banner**, content preserved, only `projects.status` reverts — not Phase 2/3's hard supersede/clear/redo cascade. The one place this phase's mechanics most diverge from Phases 2/3's. See §4. |
| 9 | Regenerate soft cap: 5 per project — same number as Steps 4/5's reconsider cap for consistency, though this action is more destructive (can overwrite hand-edits) than either of theirs ever was. |
| 10 | Regenerate-when-edited requires a destructive-action confirmation modal before overwriting — no precedent for this in Phases 1–3, new behavior. |
| 11 | Post-confirm "Edit Map" unlock preserves content (does not clear it), unlike Phase 1's title-selection unlock — justified by the different cost of losing this content vs. losing a title selection. |
| 12 | Auto-fire generation on reaching `lead_magnet_reviewed` (no manual "Generate" click) — mirrors Steps 4/5's decisions 7/10. |
| 13 | Minimum field length for guardrail rule 2: **30 characters** — approved as default, sanity-check once real model output is seen, same "approve now, tune later" treatment Phase 1 gave its scoring buckets. |

**Status: Step 6 requirements are locked. Not yet built** — DEV work starts now.

---

Sources consulted for §2.1 (transformation-map schema grounding):
- [The StoryBrand Framework: What is It & How do You Use It](https://medium.com/@thejoshuahart/the-storybrand-framework-what-is-it-how-do-you-use-it-f700b460f841) — external/internal/philosophical problem model
- [The 7 Elements of the StoryBrand Framework Explained](https://www.seangarner.co/blog/the-7-elements-of-the-storybrand-framework-explained)
- [What is the StoryBrand Framework? — IMPACT](https://www.impactplus.com/learn/what-is-the-storybrand-framework)
- [Copywriting Tips for Beginners: The Before-After-Bridge (BAB) Formula With Examples](https://medium.com/@slobodandekanic.com/before-after-bridge-bab-e2f72093427e)
- [Mastering the BAB Framework: Before, After, Bridge — Pageblock](https://pageblock.io/resources/framework/bab)
- [What Is the Before After Bridge? (Copy That Converts)](https://copymaister.com/formulas/what-is-a-before-after-bridge/)
