# PROTO — Phase 10 Technical Requirements: Step 12 (Pricing Recommendation)

**Scope:** Spec Step 12 only — PROTO recommends a **price point** for the finished digital product, derived from comparable products currently selling on the same platforms the product will be listed on (Etsy, Gumroad, StanStore, Whop), adjusted by the demand/competition scores from Step 2 and by the product's own measured depth (page count, fillable vs. static, format type). The recommendation appears at the very end, after content, design, copywriting, and export are all finalized — so real depth is known, not estimated. User can override.

**Does not cover:**
- **The Bundle Engine** — no cross-product bundling or bundle-pricing logic. The product spec describes the Bundle Engine as a separate supporting system (§4) with its own pricing mechanism ("bundle price calculated via the same demand/competition pricing engine as single products, displayed as a discount vs. buying items separately"). If that engine is built later, it should be able to call the same pricing primitives this phase establishes — but building it is not this phase's job.
- **Actually setting prices on any storefront** — same boundary every prior phase drew. Step 10 produced copy for Arman to manually paste; Step 12 produces a price recommendation for Arman to manually enter into each platform's pricing UI. PROTO never integrates with any storefront's pricing/listing API.
- **Subscription or recurring pricing models** — all four platforms in Step 10's scope (Etsy, Gumroad, StanStore, Whop) support one-time-purchase digital products, which is the only pricing model this phase considers. Gumroad and Whop also support memberships/subscriptions, but nothing in the product spec or in any product PROTO builds is subscription-shaped.
- **Currency conversion or multi-currency pricing** — Step 12 recommends USD price points (one per platform, decision 2). Etsy's own listing system handles per-country pricing conversion for international buyers; the other three platforms are USD-native. Not a gap — just a scope boundary named explicitly.
- **Lead magnet pricing** — Step 5's lead magnet, when `confirmed_suitable = true`, is by definition a **free** product. There is nothing to price. Step 12 operates on the paid product only, and simply ignores the lead magnet's existence entirely — it is not an input, not a checked exclusion requiring staleness tracking, and not a special case requiring a "$0" recommendation. Named here so it isn't mistaken for an oversight.

**Status: Decisions Locked (2026-08-30).** All 10 items in §9 confirmed by Arman. DEV work starts now.

---

## 1. Inputs Consumed

| Input | Source | Included? | Role |
|---|---|---|---|
| **Comparable product prices from Step 2's Etsy research** | `title_candidates.competition_signal_detail` → the price data already captured in the `EtsyListing.price` / `EtsyListing.currencyCode` fields (`lib/data-sources/etsy/types.ts`) during the Step 2 research pass for the selected candidate | **Yes — the base price signal, and the reason this phase can work without a new data-fetching call** | Phase 1 requirements §2.1 explicitly anticipated this: "Competition — Etsy price range: Visible price range of exact-angle-match listings (informs pricing later, not part of Phase 1 scoring, but **worth capturing now since the API call is already being made**)." The data is already persisted in `competition_signal_detail` jsonb — see §2.1 for the exact extraction path |
| Demand score + `demand_signal_detail` | `title_candidates` (selected) | Yes | High demand + low competition → price higher (spec §3, Step 12 definition) |
| Competition score + `competition_signal_detail` | `title_candidates` (selected) | Yes | Same adjustment axis as demand, inverse direction |
| Confirmed format + delivery mode | `format_recommendations` (confirmed) | Yes | "Further adjusted by product depth (page count, **fillable vs. static** — more depth justifies higher price)" — spec §3. A fillable tracker with interactive PDF form fields is a higher-value product than a static printable of the same page count |
| **Page count from the approved export** | `export_generations.page_count` (the approved export for the confirmed primary format) | **Yes — the spec's own "real depth is known" requirement** | The spec explicitly says pricing appears "at the very end, after content and design are finalized **(so real depth is known)**." Page count from the actual rendered export is the only honest measure of "real depth" — subtopic count or word count are proxies available earlier in the pipeline, but the spec chose to place pricing last specifically to have this real number |
| Selected title text | `title_candidates.candidate_text` | Yes | Baseline anchor, same as every phase since Step 4 |
| Step 1 rationale | `title_ideas.rationale` | No — checked exclusion | The rationale informed format and lead-magnet decisions; pricing is driven by market data and product depth, not the creator's stated intent. Including it would add noise to a formula-shaped recommendation without adding signal |
| Transformation map / subtopics / content bodies / cover | Steps 6–9 | No — pipeline-sequence gates, not data dependencies | Same distinction Step 11 drew in §1.1: the pipeline requires these steps to be complete before Step 12 is reachable, but Step 12's pricing logic never reads a field from any of them. The only Step 11 output that is a real input is `page_count` (above) |
| Step 10 copy | `copywriting_builds` / `platform_copies` | No | Same exclusion as Step 11 — copy is store-listing text, not a pricing input |

### 1.1 The price data already captured — worked through concretely, not assumed

`competition_signal_detail` (jsonb on `title_candidates`) is populated by Step 2's research pass and already includes the raw Etsy listing data used for scoring. The `EtsyListing` type (`lib/data-sources/etsy/types.ts`) carries `price: number` and `currencyCode: string` on every listing in the search results. The `computeCompetitionScore` function (`lib/scoring/competition.ts`) receives the classified exact-angle-match listings — the same listings whose prices are the "comparable products currently selling" the spec references.

**What's already there:** the prices of the top-N exact-angle-match Etsy listings, persisted in the jsonb detail column at Step 2 time.

**What's NOT there, honestly:** this price data is a snapshot from research time (potentially days or weeks before pricing runs). Etsy prices change. **Known limitation, flagged not solved (decision 1):** the comparable-price data Step 12 uses is as fresh as the most recent Step 2 research run — typically hours to days old in a real workflow, but could be weeks old if a project sits idle between research and pricing. This is an accepted v1 tradeoff, same posture as Step 2's own score-staleness acceptance (phase1-requirements.md §2.1). A fresh-Etsy-call option can be added later without changing the data model if stale pricing proves to be a real problem in practice.

### 1.2 The pipeline-sequence gate — same distinction as Step 11 §1.1

`projects.status` reaching `ready_to_download` (Step 11 done, at least one export format approved) is the entry gate for Step 12. This is a sequencing fact — a user cannot reach the Pricing screen without having an approved export. The only real data dependency from Step 11 is `page_count` (§1 table).

---

## 2. Pricing Research

Researched 2026-08-30 via WebSearch against current, dated sources. Same posture as every prior phase's research section.

### 2.1 What "comparable products currently selling" concretely means — and its limits

The spec says: "Base price from comparable products currently selling (same source as competition research: Etsy/Gumroad/etc.)."

**What's available from Etsy (the only live data source in this codebase):**

Step 2's Etsy search already returns real listing prices. For the selected title's exact-angle-match set (up to 20 listings), the prices of real, currently-selling comparable products are already captured. This gives:
- A **median price** of exact-angle-match competitors
- A **price range** (min–max) of the competitive set
- A **listing count** (how many comparable products exist at each price point)

**What's NOT available from Etsy alone:**
- **Gumroad/StanStore/Whop competitor prices** — no API access to any of these platforms exists in this codebase (Gumroad was permanently dropped from Step 2 per decision 1; the other two were never in scope for research). The spec's "same source as competition research: Etsy/Gumroad/etc." is aspirational — in v1, the only real comparable-price data comes from Etsy.
- **Sales volume or revenue data** — Etsy's API exposes favorites and views (used for demand scoring), but not how many units a listing has actually sold. A $25 listing with 10,000 favorites may be outselling a $5 listing with 100 favorites, but Step 12 cannot know this from available data.
- **Whether a listed price is the "real" price** — Etsy sellers frequently run sales/coupons, and the API's `price` field reflects the base listing price, not the effective sale price. A $20 listing perpetually on "50% off" is really a $10 product. No way to detect this programmatically.

**Known limitation, stated explicitly:** v1 pricing is Etsy-only comparable data, same single-source constraint as v1 demand/competition scoring (phase1-requirements.md §2.1). This is an accepted tradeoff, not a gap — the same one Step 2 accepted and documented.

### 2.2 Market context — digital product pricing by platform

| Platform | Typical digital product price range | Fee structure | Notes |
|---|---|---|---|
| Etsy | $3–$25 (templates/trackers), up to $50 for complex bundles | $0.20 listing fee + 6.5% transaction fee + payment processing (~3% + $0.25) | Marketplace with discovery — buyers expect lower prices; competing against high volume of low-priced alternatives |
| Gumroad | $10–$50+ (ebooks/courses/templates), sweet spot $30–$49 | 10% flat fee + Stripe 2.9% + $0.30 | No marketplace discovery; higher prices work because buyers arrive via creator's own audience/marketing |
| StanStore | $10–$50+ | 5% transaction fee (Creator Pro plan: 0%) | Creator-audience model, similar to Gumroad |
| Whop | $10–$100+ | 3.5% transaction fee | Premium positioning, supports higher price points |

**A real, documented finding:** per-platform price differentiation is a genuine strategy among higher-revenue digital product creators — the same product often lists at $7.99 on Etsy (where marketplace competition compresses prices) and $19.99 on Gumroad (where the buyer arrived via direct marketing and expects to pay more). This raises a real question for Step 12's output shape — see decision 2 (§9).

### 2.3 Price adjustment factors — what the spec names and what they concretely mean

The spec names three adjustment axes. Worked through concretely:

| Adjustment | Direction | Mechanism |
|---|---|---|
| High demand + low competition | **Price up** | The product addresses a validated need with few alternatives — market supports a premium. Concretely: `demand_score ≥ 7` AND `competition_score ≥ 7` (remember: high competition score = low competition, green-is-good per decision 4 of phase1-requirements.md) |
| Low demand + high competition | **Price down** | Crowded market with modest interest — price is a differentiator. Concretely: `demand_score ≤ 4` AND `competition_score ≤ 4` |
| Product depth (page count) | **Price up for deeper products** | "More depth justifies higher price" — a 30-page fillable tracker is worth more than a 4-page static one |
| Fillable vs. static | **Fillable premium** | Interactive form fields (PDF checkboxes, text inputs) add functional value beyond static content — a real, perceivable difference to buyers |

---

## 3. Shape Determination

### 3.1 Does an established shape fit?

| Shape | Precedent | Defining property | Fits Step 12? |
|---|---|---|---|
| **Recommend/confirm** | Steps 4–5 | AI proposes one value from a small set, with a stated reason; user accepts/overrides | **Yes — this is exactly the right shape.** Step 12 proposes a price (or price range), states a reason keyed to market data and product depth, and the user accepts or overrides with their own price. The cardinality is 1 recommendation per project, same as Steps 4/5 |
| Single editable record + log | Step 6 | One project-level, freely re-editable prose record | No — pricing is a recommendation to confirm, not a prose field to edit freely |
| Live variable-length collection | Step 7 | N self-managed rows | No |
| Editable-content-per-row | Steps 8/10 | N rows with independently editable content | Possibly, if per-platform pricing is chosen (decision 2) — but even then, the per-platform prices would be mechanically derived from one base recommendation, not independently generated |
| Candidate-artifact | Step 9 | Binary asset with subjective quality gate | No — a price is a number, not an artifact requiring visual review |

### 3.2 Conclusion: recommend/confirm, with the recommendation being a computed value rather than a small-enum classification

Step 4's shape is the right fit, with one structural difference: Step 4 classified into a 4-value enum (`tracker`/`workbook`/`ebook`/`quiz`); Step 12's "recommendation" is a **continuous numeric value** (a dollar amount), not an enum pick. The confirm/override mechanism is identical in spirit — the user sees the recommended price, the reasoning, and either accepts or types in their own number.

This is closer to Step 5's shape than Step 4's in one specific way: Step 5 had a binary gate (`recommended_suitable`) that the user could flip in either direction. Step 12 has no binary gate — the recommendation is always a positive price (the product is always priced; a $0 product is a lead magnet, which is out of scope). But the override direction is unconstrained — the user can set any price they want, higher or lower than the recommendation.

---

## 4. Generation Approach — Hybrid: Deterministic Formula + AI-Interpreted Context

### 4.1 Is this AI-generated or deterministic?

Both, in clearly separated roles — same hybrid posture as Steps 4/5:

| Piece of work | AI or deterministic? | Detail |
|---|---|---|
| **Base price calculation** (median of comparable Etsy prices) | **Deterministic** — pure arithmetic over already-captured price data | No judgment needed: take the median price of the exact-angle-match listings from Step 2's research, compute directly |
| **Score-based adjustment** (demand/competition modifier) | **Deterministic** — a formula with named thresholds | High demand + low competition → multiply base by an uplift factor; low demand + high competition → apply a discount factor. Exact multipliers are a tuning question (decision 3, §9), not an AI judgment |
| **Depth adjustment** (page count + fillable premium) | **Deterministic** — a formula | More pages → higher price, with diminishing returns; fillable → a fixed percentage uplift over static |
| **Reasoning summary** (why this price, stated in plain English) | **AI, small-scale** — a single Groq structured-JSON call, same pattern as Steps 4/5/11 | The formula produces the number; the AI produces the "stated reason" the spec requires, referencing the specific inputs that drove the price in natural language. One call, not multiple |
| **Per-platform price suggestions** (if decision 2 chooses per-platform) | **AI or deterministic** — depends on decision 2 | If per-platform pricing is chosen, the platform-specific adjustments could be deterministic (multiply by a platform factor) or AI-interpreted (same Groq call, given platform context). See decision 2 |

### 4.2 The formula — proposed, not locked

**Base price** = median(`price`) across exact-angle-match Etsy listings from Step 2's research for the selected candidate. If no exact-angle matches had prices (edge case: all classified listings were broad-topic, not exact-angle), fall back to median of all returned listings. If Step 2 returned no listings at all (another edge case: `research_runs.status = 'partial'`), fall back to a format-specific default floor (decision 4, §9).

**Demand/competition multiplier** — proposed shape (exact values are decision 3):

| Demand × Competition | Multiplier |
|---|---|
| Both green (≥7) | ×1.3 (premium territory) |
| One green, one amber | ×1.1 |
| Both amber (5–6) | ×1.0 (base, no adjustment) |
| One amber, one red | ×0.9 |
| Both red (≤4) | ×0.7 (competitive pressure) |

**Depth modifier** — proposed shape:

| Signal | Adjustment |
|---|---|
| Page count > 20 | +$1 per 10 additional pages (diminishing: capped at +$5) |
| Fillable delivery mode | +15% over static equivalent |
| Format = ebook (read-only, no interactivity) | No fillable premium, but longer page counts are expected and priced in via the page-count row above |

**Final recommended base price** = round(base × demand_competition_multiplier + depth_adjustment, nearest $0.99 ending) — the `.99` convention is confirmed (decision 10) as a deterministic post-processing step.

**Per-platform suggested prices** (decision 2) — derived from the base price by applying platform-specific multipliers reflecting the real market-context differences in §2.2:

| Platform | Proposed multiplier | Rationale |
|---|---|---|
| Etsy | ×0.7 | Marketplace with price-compressed expectations ($3–$25 typical range); buyers comparison-shop |
| Gumroad | ×1.0 (base = Gumroad price) | Direct-audience model; buyers arrive via creator's marketing, less price sensitivity. The formula's base price (median of Etsy comparables, adjusted) maps most naturally to Gumroad's positioning |
| StanStore | ×1.0 | Similar creator-audience model to Gumroad |
| Whop | ×1.2 | Premium positioning; supports and expects higher price points |

Each per-platform price is also rounded to `.99` endings. All four are independently confirmable/overridable by the user — a confirmed Etsy price of $7.99 and a confirmed Gumroad price of $19.99 for the same product is the expected, normal outcome, not an edge case.

### 4.3 The AI's role — stated reason only, not the number

The AI call receives:
- The computed recommended base price and per-platform prices
- The median comparable price before adjustments
- The demand/competition scores and their detail
- The page count and fillable status
- The confirmed format and title

And returns:
- `reasoning_summary`: a 2–3 sentence plain-English explanation of why this price (e.g., "Base price of $14.99 derived from a $9.50 median among 8 comparable Etsy trackers, adjusted upward for strong demand (8/10) in a niche with limited competition (7/10), and a 24-page fillable product offering more depth than most alternatives. Per-platform: $9.99 on Etsy (marketplace-adjusted), $14.99 on Gumroad/StanStore, $17.99 on Whop.")
- `reasoning_signals`: structured evidence array, same contract as Steps 4/5

The AI does NOT decide the price. It explains the price the formula decided. This is a deliberate, different-from-Steps-4/5 design: pricing is too consequential to leave to an LLM's judgment when a real, auditable formula can do the job — the AI's value-add is in articulating the "stated reason" the spec requires in natural language, not in picking the number.

### 4.4 Fallback on AI failure

If the Groq reasoning call fails, the price itself is still valid (it's formula-computed, no AI involved). The `reasoning_summary` falls back to a deterministic template: "Base price of $X.XX derived from a median of $Y.YY across Z comparable Etsy listings, adjusted for demand (D/10) and competition (C/10) scores." `generation_status = 'failed_fallback'`, same pattern as every prior phase.

---

## 5. Guardrails — What's Actually Checkable

| # | Rule | Deterministically checkable? | On failure |
|---|---|---|---|
| 1 | Recommended price is a positive number > $0 | **Yes** — trivial | Reject; do not persist. Fall back to format-specific default floor (decision 4) |
| 2 | Recommended price does not exceed a hard ceiling (proposed: $99.99 for single products — decision 5, §9) | **Yes** — trivial | Clamp to ceiling, flag `succeeded_with_warnings` with a note |
| 3 | Recommended price is not below the comparable-product floor by more than 50% (a sanity check against a degenerate formula result, not a business rule) | **Yes** — comparison against median base price | Non-blocking warning, surfaced in the reasoning |
| 4 | The `reasoning_summary` references at least one concrete input (a comparable price, a score, a page count) — not a vague platitude | **Partially** — keyword-presence check for numeric references, same shallow-check honesty as prior phases | Non-blocking; the price itself is valid regardless of reasoning quality |
| 5 | The formula inputs (base price, scores, page count) are all non-null at generation time | **Yes** — precondition check | Block generation with a clear error identifying which input is missing |

---

## 6. Action Model

| Action | What happens | Which table(s) change |
|---|---|---|
| **Generate pricing recommendation** (confirmed: explicit trigger only, decision 6 — no auto-fire) | Runs the deterministic formula (§4.2) + the Groq reasoning call (§4.3). Inserts a `pricing_recommendations` row with base recommended price, reasoning, and all input snapshots, plus 4 `pricing_platform_suggestions` child rows (one per platform). `projects.status` moves `ready_to_download` → `pricing_recommending` | `pricing_recommendations`, insert; `pricing_platform_suggestions`, 4 inserts; `projects.current_pricing_recommendation_id` updated; `projects.status` updated |
| **Confirm price** (accept-as-is or override, per platform independently) | Sets `confirmed_price` on the base recommendation row AND on each platform suggestion the user confirms. A platform whose suggested price is accepted gets `is_override = false`; one where the user types a different number gets `is_override = true`. `projects.status` → `pricing_confirmed` once at least one platform price is confirmed | `pricing_recommendations` + `pricing_platform_suggestions` |
| **Change price** (post-confirm) | Same supersede-and-carry-forward shape as Steps 4/5 — no re-run of the formula needed unless explicitly requested. Prior row preserved | `pricing_recommendations` |
| **Reconsider** (re-run the formula, e.g., after becoming aware of new market context) | New row inserted with a fresh formula computation; previous row superseded. Same soft cap as Steps 4/5 (decision 9: 5 per project) | `pricing_recommendations` + `pricing_platform_suggestions` |

---

## 7. Staleness Dependencies

### 7.1 Does pricing depend on each upstream artifact?

| Dependency | Depends? | Why |
|---|---|---|
| Title (selected candidate) | **Yes** — transitively, because the title determines which Step 2 research run's comparable prices are used | A title change triggers re-research (Step 2), which produces new comparable-price data, invalidating the pricing base |
| Demand/competition scores | **Yes — directly, not just transitively** | Scores are explicit multipliers in the formula (§4.2). If a title change triggers new research with different scores, the pricing recommendation is stale |
| Confirmed format + delivery mode | **Yes** | Fillable vs. static drives a 15% premium (§4.2); a format change could flip this. Format type also affects the default floor (decision 4) |
| Confirmed content bodies | **Not independently** — covered transitively via export's page count | Content changes propagate through export regeneration → new page count → stale pricing. But a content edit that doesn't change page count doesn't affect pricing |
| Approved cover | **No** | The cover has no bearing on pricing. A cover change triggers export staleness (Step 11 §7), but pricing doesn't depend on the cover independently |
| **Approved export (page count)** | **Yes — the real depth signal** | If the export is unlocked and regenerated with a different page count, the pricing depth adjustment is stale |
| Step 10 copy | **No** | Same exclusion as Step 11 — copy is store-listing text, not a pricing input |

### 7.2 Detection and precedence

| Dependency | Detection | Effect |
|---|---|---|
| Title | FK equality: `pricing_recommendations.title_candidate_id` vs. live `projects.selected_candidate_id` | Same technique as every phase since Step 5 |
| Format + delivery mode | FK equality: `pricing_recommendations.format_recommendation_id` vs. live `projects.current_format_recommendation_id` | Same technique |
| Export page count | Snapshot comparison: `pricing_recommendations.export_page_count_snapshot` vs. live approved export's `page_count` | New — unique to this phase |

**Precedence when multiple are stale simultaneously: title > format/delivery mode > export page count** — pipeline order, matching the established convention. Export is placed last because it's the most recently-confirmed upstream artifact.

**Effect:** same soft-staleness convention as every prior phase — a confirmed pricing recommendation reverts to a "needs re-run" state; no prior row is deleted.

---

## 8. Data Shape Proposal

### 8.1 Single table: `pricing_recommendations`

**Same single-table design as `format_recommendations` and `lead_magnet_recommendations`** — confirm-in-place, supersede-and-copy-forward on change. The cardinality (1 recommendation per project, accept or override) is the same shape.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects) | no | |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Staleness snapshot |
| `format_recommendation_id` | uuid (fk → format_recommendations) | no | Staleness snapshot |
| `export_page_count_snapshot` | int | no | Snapshot of the approved export's page count at generation time — staleness comparison basis |
| **Recommendation fields:** |
| `recommended_price` | numeric(10,2) | no | The formula-computed price (§4.2) |
| `base_price` | numeric(10,2) | no | Median comparable-product price before adjustments — stored for transparency/debugging |
| `comparable_count` | int | no | How many exact-angle-match listings contributed to the base price — a confidence signal (3 comparables vs. 15 comparables carry different weight) |
| `demand_competition_multiplier` | numeric(4,2) | no | The score-based multiplier applied (§4.2) |
| `depth_adjustment` | numeric(10,2) | no | The page-count + fillable premium in dollars |
| `reasoning_summary` | text | no | AI-generated plain-English explanation |
| `reasoning_signals` | jsonb | no | Structured evidence array, same contract as Steps 4/5 |
| `inputs_snapshot` | jsonb | no | Full snapshot: title, scores, signal detail, format, delivery mode, page count, comparable prices used |
| `model` | text | no | Groq model used for the reasoning call |
| `generation_status` | generation_status | no | Reused from Step 4 — `succeeded` / `failed_fallback` / `failed_blocked` |
| **Confirmation fields:** |
| `confirmed_price` | numeric(10,2) | yes | Null until user confirms |
| `is_override` | boolean | yes | True if `confirmed_price ≠ recommended_price` |
| `confirmed_by` | uuid (fk → auth.users) | yes | |
| `confirmed_at` | timestamptz | yes | |
| **Row lifecycle:** |
| `recommendation_status` | recommendation_status | no | Reused from Step 4 — `active` / `superseded` |
| `superseded_at` | timestamptz | yes | |
| `superseded_reason` | enum `pricing_supersede_reason` | yes | `title_changed` / `format_changed` / `export_changed` / `user_requested_reconsider` / `user_requested_change` |
| `created_at` | timestamptz | no | default now() |

### 8.2 `projects` table extension

| Column | Type | Notes |
|---|---|---|
| `current_pricing_recommendation_id` | uuid (fk → pricing_recommendations, nullable) | Points at the active row |

### 8.3 `project_status` extension — confirmed (decision 7)

**Pricing is optional/advisory. `ready_to_download` remains Step 11's terminal status, unchanged.** A project is "done" once its export is approved — pricing is an additional tool available from that point forward, not a gate.

Two new status values, both reachable only from `ready_to_download`:

| Status | Meaning |
|---|---|
| `ready_to_download` | (existing, unchanged) Export approved — product file exists. Pricing not yet run. A valid stopping point. |
| `pricing_recommending` | Step 12 in progress — recommendation generated, awaiting user confirmation. Reachable from `ready_to_download` only via an explicit "Generate pricing" action (decision 6). |
| `pricing_confirmed` | At least one platform price confirmed. Also a valid stopping point. |

**Reverting from `pricing_recommending` or `pricing_confirmed` back to `ready_to_download`** is allowed (e.g., the user decides they don't want PROTO's pricing recommendation after all, or an upstream change triggers staleness). This is the only phase in the pipeline where backward status movement doesn't imply "something broke" — it can also mean "I'd rather price this myself."

### 8.4 New enum

| Enum | Values | Notes |
|---|---|---|
| `pricing_supersede_reason` | `title_changed`, `format_changed`, `export_changed`, `user_requested_reconsider`, `user_requested_change` | Three upstream triggers (one more than Step 5, which only had title + format) |

### 8.5 Per-platform pricing — confirmed (decision 2): child table `pricing_platform_suggestions`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `pricing_recommendation_id` | uuid (fk → pricing_recommendations) | no | Parent recommendation |
| `platform` | enum `copy_platform` | no | Reuses Step 10's existing enum — `etsy`, `gumroad`, `stanstore`, `whop`. **Only the 4 storefront platforms, not `pinterest`/`instagram`/`narrative`** — social promo and narrative have no pricing dimension |
| `platform_multiplier` | numeric(4,2) | no | The platform-specific multiplier applied (§4.2: Etsy ×0.7, Gumroad ×1.0, StanStore ×1.0, Whop ×1.2) |
| `suggested_price` | numeric(10,2) | no | = round(base recommended price × platform_multiplier, `.99`) |
| `confirmed_price` | numeric(10,2) | yes | Null until user confirms this platform's price |
| `is_override` | boolean | yes | True if `confirmed_price ≠ suggested_price` |
| `confirmed_by` | uuid (fk → auth.users) | yes | |
| `confirmed_at` | timestamptz | yes | |
| `created_at` | timestamptz | no | default now() |

**Unique constraint:** `(pricing_recommendation_id, platform)` — exactly one suggestion per platform per recommendation row, 4 rows per recommendation.

**Lifecycle:** child rows are created alongside the parent `pricing_recommendations` row (one atomic operation). When the parent is superseded (change/reconsider), a new set of 4 child rows is created for the new parent. Old child rows remain queryable via their superseded parent — same append-only audit trail.

---

## 9. Decisions Locked (2026-08-30)

| # | Decision |
|---|---|
| 1 | **Reuse Step 2's captured Etsy prices — no fresh API call at Step 12 time.** The price data was captured for exactly this purpose (phase1-requirements.md §2.1 said so explicitly). **Known limitation, flagged not solved:** the price snapshot is from research time (potentially days or weeks before pricing runs). Etsy prices change — a product researched on Monday and priced on Friday uses Monday's comparable prices. This is an accepted v1 tradeoff, same posture as Step 2's own score-staleness acceptance (phase1-requirements.md §2.1). If stale pricing proves to be a real problem in practice, a fresh-Etsy-call option can be added later without changing the data model — the formula consumes price data the same way regardless of when it was fetched. |
| 2 | **Per-platform suggested prices, not a single flat number.** Etsy and Gumroad buyers have genuinely different price expectations ($3–$25 vs. $30–$49) — a single price would likely be wrong for at least one platform. The base recommendation is still one formula-computed number; per-platform suggestions are derived from it by applying platform-specific multipliers (§4.2, updated below). Each platform's suggested price is independently confirmable/overridable. §8.5's child-table approach (`pricing_platform_suggestions`) is the data model — see §8.5 updated. |
| 3 | **Score-based multiplier values approved as proposed defaults (×0.7 to ×1.3 range).** Open to tuning once real recommendations run against real products — same "approve now, tune later" treatment as Step 2's scoring thresholds (phase1-requirements.md decision 13). |
| 4 | **Format-specific default price floors approved:** tracker $4.99, workbook $6.99, ebook $9.99, quiz $3.99. |
| 5 | **Hard price ceiling of $99.99 approved.** Formula output is clamped; user can still override to any price via manual confirmation. |
| 6 | **Explicit trigger only, no auto-fire** — consistent with every phase from Step 8 onward. Pricing does not auto-generate when a project reaches `ready_to_download`. |
| 7 | **Pricing is optional/advisory — `ready_to_download` remains Step 11's terminal status, unchanged.** Step 12 adds `pricing_recommending` and `pricing_confirmed` as status values a project can move through, but `ready_to_download` is a valid stopping point — a project is "done" once its export is approved, with or without pricing. This gives Arman the flexibility to mark products ready without being forced to price them immediately, since pricing may get revisited per platform, per promotion, or per bundle later. `projects.status` flow: `ready_to_download` → `pricing_recommending` → `pricing_confirmed`, but `ready_to_download` → (stay) is equally valid. |
| 8 | **Bundle Engine pricing explicitly excluded.** Bundles are priced as a whole, separately — not through this per-product flow. The Bundle Engine (product spec §4) is a separate future system. |
| 9 | **Reconsider cap: 5 per project**, matching Steps 4/5. |
| 10 | **`.99` pricing convention approved.** All formula-computed prices (both base and per-platform) are rounded to end in `.99` as a deterministic post-processing step. User can override to any price. |

**Status: Decisions Locked (2026-08-30).** All 10 items above confirmed by Arman. No genuinely unverified technical claims exist in this document (unlike Steps 9/11, which each had live-spike-requiring unknowns) — every piece of this phase's implementation uses patterns and data sources already proven in the codebase. DEV work starts now.

---

Sources consulted for §2 (Pricing Research):
- [Digital Product Pricing Strategies: The Complete 2026 Guide — Fungies.io](https://fungies.io/digital-product-pricing-strategies/)
- [How to Price Digital Products on Etsy — The 2026 Profit Playbook — Margin for Makers](https://marginformakers.com/guides/how-to-price-digital-products-on-etsy)
- [Price Digital Products on Gumroad 2026: $30–49 Sweet Spot — InsightRaider](https://insightraider.com/en/answers/how-to-price-digital-products-on-gumroad)
- [Gumroad vs Etsy for Digital Products 2026 — Kupkaike](https://kupkaike.com/blog/gumroad-vs-etsy-for-selling-digital-products)
