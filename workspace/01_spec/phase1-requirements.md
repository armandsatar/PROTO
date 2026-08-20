# PROTO — Phase 1 Technical Requirements (Steps 1–3: Input, Title Research & Scoring, Selection)

Scope: Title idea capture through title selection. No later pipeline steps (format recommendation, transformation map, subtopics, content builder, design, copy, export, pricing, bundles) are covered, referenced, or implied by this document.

---

## 1. Data Model

### 1.1 Multi-tenancy scaffolding (applies to every entity below)

Per Section 2, this is multi-tenant-ready from day one even though Arman is the only user at launch.

| Entity | Purpose | Notes |
|---|---|---|
| `workspaces` | Top-level tenant boundary | `id`, `owner_user_id`, `name`, `created_at`. Even solo usage gets exactly one workspace row — never a bare personal table. |
| `workspace_members` | User↔workspace join (RLS anchor) | `workspace_id`, `user_id`, `role` (e.g. `owner`, `member` — only `owner` is used in phase 1, but the shape exists). |

Every entity from `projects` downward carries a `workspace_id` foreign key. Supabase RLS policies gate all reads/writes on `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`. No entity below is scoped only by `user_id` — always `workspace_id`, per Section 2's isolation principle.

### 1.2 Core entities

| Entity | Cardinality | Mutability | Key fields (conceptual) |
|---|---|---|---|
| `projects` | 1 per title idea the user starts | Mutable status pointer | `id`, `workspace_id`, `created_by`, `status` (`draft` → `researching` → `title_selected` **[locked]**), `created_at`, `updated_at`, `current_research_run_id` (nullable FK, points at latest run), `selected_candidate_id` (nullable FK, set at Step 3, write-protected once `status = title_selected` — see §1.4) |
| `title_ideas` | 1 per project (1:1) | **Mutable** — user can edit title/rationale before or between research runs | `id`, `project_id`, `workspace_id`, `original_title`, `rationale` (why this topic / trend / gap), `created_by`, `created_at`, `updated_at` |
| `research_runs` | Many per project (one per "research/regenerate" action) | **Immutable once completed** — append-only history, never overwritten | `id`, `project_id`, `workspace_id`, `run_number` (sequential per project), `idea_title_snapshot`, `idea_rationale_snapshot` (frozen copy of `title_ideas` at time of run — see 1.3), `ai_connector_used` (which BYOK provider or Groq default), `status` (`pending`/`completed`/`partial`/`failed`), `started_at`, `completed_at`, `error_detail` (nullable, sanitized — never raw provider error text, per Section 2 no-secrets-in-errors rule) |
| `title_candidates` | Exactly 4 per completed `research_run` | **Immutable** — belongs to a specific frozen run | `id`, `research_run_id`, `workspace_id`, `project_id`, `candidate_text`, `is_original` (bool — true for exactly one of the 4), `generation_axis` (enum: `original`/`niche_down`/`format_hint`/`keyword_optimized` — see §3.2), `demand_score` (1–10 int), `demand_color` (`green`/`amber`/`red`, derived not stored redundantly if computed at read time — see Open Questions), `demand_signal_detail` (JSON: the raw/bucketed sub-scores that produced the number, for auditability), `competition_score` (1–10 int), `competition_color`, `competition_signal_detail` (JSON), `display_order` (1–4), `created_at` |
| `title_selections` | Append-only log, 1 row per selection *event* | **Immutable log**; `projects.selected_candidate_id` is the mutable "current pointer" | `id`, `project_id`, `workspace_id`, `research_run_id`, `selected_candidate_id`, `selected_by`, `selected_at` |

### 1.3 Re-run behavior (explicit, since spec doesn't state this)

- **Editing the idea does not retroactively change past research.** Each `research_run` snapshots `idea_title_snapshot`/`idea_rationale_snapshot` at the moment it ran, so historical runs remain internally consistent even if the user later edits `title_ideas`.
- **Re-running research always creates a new `research_run` row and a new set of 4 `title_candidates`.** Nothing is overwritten. This gives Arman a full audit trail of every research/scoring attempt (useful for both debugging inconsistent scores and tracking research API/LLM spend per project).
- `projects.current_research_run_id` always points at the latest run so the UI knows which 4-candidate set to render by default; older runs remain queryable but not shown unless explicitly requested.
- **Selection is re-selectable across runs.** If the user re-runs research, `projects.selected_candidate_id` is cleared (Step 3 must be redone against the new candidate set) — a selection from a superseded run cannot silently persist as "the" selection. A new `title_selections` event is logged each time the pointer changes.

### 1.4 Selection lock behavior (decision: locked, per decision 11)

- Selecting a candidate sets `projects.status = title_selected` and writes a `title_selections` row. While `status = title_selected`, `selected_candidate_id` is write-protected — no silent overwrite from re-selecting or re-running research.
- **Unlocking requires an explicit action** (e.g. a "Change Selection" button), not just clicking a different candidate. This action: (a) reverts `projects.status` back to `researching`, (b) does **not** delete the prior `title_selections` row (append-only log stays intact — it's history, not a live pointer), (c) clears `projects.selected_candidate_id` so Step 3 must be explicitly redone.
- Interaction with re-running research (§1.3): a re-run always clears the selection pointer regardless of lock state — re-running research is itself implicitly an "I want to reconsider" action, so it does not require the separate unlock step first. The unlock action is only needed to change selection *within the same candidate set*, without regenerating.
- Editing `title_ideas` (§1.3, decision 8) is independent of this lock — idea text stays editable at any time and does not touch `projects.status` or `selected_candidate_id` by itself.

---

## 2. Research Requirements

**Scope locked by decisions (1, 2, 3, 10, and the new Trends-gap resolution):** Gumroad dropped entirely. No paid SERP vendor, no unofficial Google scraping. **v1 launches on Etsy-only signals for both Demand and Competition** — Google Trends integration is deferred, not built, pending alpha API approval (Arman applying now). Research never routes through an AI connector's own web-search tool — Etsy is called directly by PROTO's backend as a plain data API.

**Known limitation, flagged explicitly (not a silent gap):** with both scores sourced from the same Etsy search-result pull, Demand and Competition are **not fully independent signals in v1** — a niche with many favorited/viewed listings often also has more listings (i.e. higher competition too), so the two scores may move together more than the spec's "two independent research angles" framing implies. This is an accepted v1 tradeoff, to be revisited once Trends is added back as a truly independent demand source.

### 2.1 What each signal concretely means

| Signal | Concrete data pulled | Source type |
|---|---|---|
| Demand — Etsy engagement (v1 proxy) | Average `num_favorers` across exact-angle-match listings (top N=20) — favoriting is an active buyer-intent signal, the closest proxy to "demand" available from Etsy alone | Official Etsy Open API v3 |
| Demand — Etsy views (v1 proxy, secondary) | Average `views` across the same exact-angle-match listing set — a passive-interest signal, weighted lower than favorites | Official Etsy Open API v3 |
| Demand — Google Trends interest (**DEFERRED, not in v1**) | Interest-over-time index (0–100 scale) for the candidate phrase, trailing 12mo average — see §2.2. To be added once Trends alpha access is granted; formula in §3.1 will be revisited at that point, not assumed to just bolt on. | Google Trends API (future) |
| Competition — Etsy exact-angle matches | Result count from `findAllListingsActive` for the candidate's core keywords; of the top N (propose N=20) results, how many are an **exact-angle match** (same specific product concept, LLM-classified tri-state: exact angle / same broad topic / unrelated) | Official Etsy Open API v3 |
| Competition — Etsy broad-topic volume | Total listing count for the candidate's core keywords, regardless of angle match | Official Etsy Open API v3 |
| Competition — Etsy price range | Visible price range of exact-angle-match listings (informs pricing later, not part of Phase 1 scoring, but worth capturing now since the API call is already being made) | Official Etsy Open API v3 |

Note: `num_favorers` and `views` are confirmed fields on the Etsy listing object (per Etsy API docs/tutorials) — worth a quick sanity-check against the live schema when Arman registers the developer app this week, since Etsy's docs have moved fields before.

"Exact angle" is explicitly an **LLM semantic classification step**, not a keyword-count heuristic — a listing titled "Notion Budget Template" and one titled "Notion Budget Tracker for Freelancers" are the same broad topic but not necessarily the same angle. This classification must be a discrete, structured LLM call producing a label per listing, not folded invisibly into a single "give me a score" prompt.

### 2.2 Access method per source — reality check

| Source | Official free API? | Realistic access method | Risk / constraint |
|---|---|---|---|
| Etsy | **Yes — Etsy Open API v3**, `findAllListingsActive` supports keyword search. | Direct authenticated HTTP call using a PROTO-owned developer API key | Rate-limited by Queries Per Day / Queries Per Second per API key (app-level, not per-user as of Etsy's 2023 model change). Fully ToS-compliant. Clean, sanctioned path — the sole v1 data source for both scores. |
| Google Trends | **Yes, but not generally available.** Google announced an official Trends API in July 2025. As of Aug 2026 it is confirmed still an **application-gated alpha** — apply via Google's developer portal, approval not guaranteed, no published GA timeline. | Arman applying for alpha access now (§4). **Not a v1 build blocker** — v1 ships Etsy-only per the resolved decision below; Trends gets integrated as a follow-up once access is granted, not waited on. | Resolved: no unofficial fallback (`pytrends`-style scraping) will be used, consistent with decision 10. v1 demand scoring is Etsy-only in the meantime — see §2.1 known-limitation note. |

### 2.3 Mapping to the AI connector model (BYOK / Claude / Groq)

Simpler than the prior draft, now that SERP/Compound are both off the table:

1. **Etsy** — direct server-side HTTP call to the official Etsy API using a PROTO-owned developer key (registered by Arman, not the user — decision 9). This is a PROTO-operated data-API credential, distinct from user-supplied AI BYOK keys in Section 5, but still encrypted at rest per Section 2's architecture principle. In v1, this single credential/call pair feeds **both** Demand and Competition scoring — see §2.1 known-limitation note.
2. **Google Trends** — deferred to a future addition (§2.1, §2.2). When added, same pattern applies: direct server-side HTTP call using PROTO's alpha API credentials, not an AI connector call.
3. **Classification/synthesis only** ("is this Etsy listing an exact-angle match," "generate 3 title variants," combine sub-scores) — this is the only place the user's configured AI connector (BYOK Claude/OpenAI/Gemini/Grok, or the Groq zero-setup default) is used. It takes the raw structured data pulled in 2.2 as input and returns structured JSON classifications, never raw prose scores.

**Groq default confirmed sufficient for build/smoke-testing:** since research never asks the AI connector to browse the web, the Groq zero-setup default is fine for both production and Step 2 smoke-testing — Groq "Compound" is not needed. **Correction (2026-08-20, verified live via `client.models.list()`):** Groq's active model lineup no longer includes any Llama-branded chat model at all — confirmed by an actual `model_not_found` error on `llama-3.3-70b-versatile` during Increment 4's live smoke test. `lib/ai/groq.ts` now uses `openai/gpt-oss-120b` instead. Section 5 of the source spec ("Llama via Groq") is stale on this specific point and should be corrected to describe the zero-setup default generically (currently an OSS model served via Groq, not literally Llama) rather than naming Llama specifically, since Groq's lineup can and does change.

---

## 3. Scoring Requirements

### 3.1 Demand X/10 and Competition Y/10 — concrete rubric

Scores are **not** "ask the LLM for a number." The LLM's job is limited to semantic classification of raw signals (on-topic vs. not, exact-angle vs. broad-topic); a **deterministic backend formula** converts classified counts into the 1–10 score, so results are explainable, reproducible, and auditable (stored in `demand_signal_detail`/`competition_signal_detail`).

**Demand X/10 — v1 (Etsy-only proxy, approved default, tune later):** with Trends deferred (§2.1), v1 demand is derived from the same Etsy exact-angle-match listing set already pulled for competition scoring:

| Signal | Sub-score (0–10) bucketing | Weight |
|---|---|---|
| Avg `num_favorers` per exact-angle-match listing (top 20) | <5 → 1, 5–20 → 4, 21–75 → 7, 76+ → 10 | 60% |
| Avg `views` per exact-angle-match listing (top 20) | <100 → 1, 100–500 → 4, 501–2000 → 7, 2001+ → 10 | 40% |

Final `demand_score` = round(weighted average of sub-scores) → clamp 1–10. Favorites weighted higher than views since favoriting is an active buyer-intent signal, views a passive one. **Bucket thresholds are PROPOSED defaults** (same "approve now, tune once real data comes in" treatment as the rest of §3.1) — sanity-check against real Etsy numbers once the dev account is live, since typical favorite/view counts vary a lot by niche maturity.

**Demand X/10 — future (post-Trends-alpha):** once Google Trends access is granted, the plan is a **separate revisit**, not an automatic bolt-on — likely blending the Trends interest index with the Etsy engagement proxy above (exact weighting to be decided then), rather than simply replacing one with the other. Deferred to whenever Trends access lands; not scoped further here.

**Known correlation risk (see §2.1):** because Demand and Competition are both computed from the same Etsy `findAllListingsActive` pull in v1, they are structurally correlated — a crowded niche tends to also show more total favorites/views. This is an accepted, explicitly-flagged v1 tradeoff, not an oversight.

**Competition Y/10** — directionality confirmed (decision 4): **high Competition score = low competition / more white space**, matching green-is-good on both metrics. Google-organic-results sub-signal removed (SERP dropped per decision 10); reweighted across the two remaining Etsy signals:

| Signal | Sub-score (0–10) bucketing (inverse — fewer competitors = higher score) | Weight |
|---|---|---|
| Etsy exact-angle-match listings (top 20 results) | 0 → 10, 1–2 → 7, 3–5 → 4, 6+ → 1 | 70% |
| Etsy broad-topic listing count (total) | <50 → 10, 50–500 → 6, 500+ → 2 | 30% |

Final `competition_score` = round(weighted average) → clamp 1–10. Competition scoring is now **entirely Etsy-sourced** — the same single-source dependency as the Demand side in v1. Gumroad and Google-organic are both permanently out of scope for Phase 1 (decisions 1, 10), not just deferred.

### 3.2 Candidate generation (4 titles)

Per spec: the original title is always included in the 4 and is never auto-excluded regardless of score. This is enforced in the data model via `is_original = true` on exactly one of the four `title_candidates` rows per run, generated first and never dropped even if it scores red on both axes.

The 3 generated variants — PROPOSED concrete axes (spec does not define these, needs Arman confirmation):

| Axis | What varies | Informed by |
|---|---|---|
| `niche_down` | Same core concept, narrower audience/use-case appended (e.g. "for freelance designers") | User's rationale text from Step 1 |
| `format_hint` | Same concept, different deliverable-type framing (e.g. "Template" vs. "System" vs. "Kit" vs. "Guide") | Original title's implied format |
| `keyword_optimized` | Rephrased to match the highest-signal phrasing found in exact-angle-match Etsy listing titles from the *original title's* research pass | Step 2 research output for the original (**updated**: previously referenced Google autocomplete/PAA wording, which no longer exists as a v1 data source — corrected to Etsy listing phrasing to match the Etsy-only v1 scope in §2) |

**Sequencing implication**: research must run on the original title **first**, then the 3 variants are generated using both the original research output and the Step 1 rationale, then all 4 candidates get their own research + scoring pass. This means a single "research" action is really two research sub-passes (original, then the 3 derived candidates) inside one `research_run`.

---

## 4. Decisions Locked (2026-08-19)

| # | Decision |
|---|---|
| 1 | Gumroad dropped entirely from v1. No scraping, no data model field. |
| 2 | No paid SERP vendor — moot, since decision 10 dropped SERP-based Google signals entirely. |
| 3 | Groq Compound not needed — research is Etsy API only (Google Trends deferred, see decision 10/12), never routed through an AI connector's web search. |
| 4 | Competition directionality: higher = more white space/less competition, matching green-is-good on both metrics. |
| 5 | No rate cap on research runs for now (single user, manual monitoring). **Flagged to revisit before any multi-user opening** — carried forward as a standing item, not closed permanently. |
| 6 | Source failure handling: partial/degrade with a flagged "signal unavailable" note, not a hard fail. `research_runs.status` includes `partial` as a first-class state. |
| 7 | Candidate count: always exactly 4, hard rule — no fewer, no more. |
| 8 | `title_ideas` stays mutable after research runs; each run snapshots it. No blocking on edit. |
| 9 | Etsy developer registration: Arman's action item, to be done before Step 2 build continues. **In progress — key requested, pending Etsy's review, no ETA.** |
| 10 | MVP restricted to fully-sanctioned sources only: **Etsy API only for v1** (both Demand and Competition). Google Trends deferred — Arman applying for alpha access now; when granted, Trends is added as a follow-up demand signal, not waited on for v1 launch. No SERP vendor, no scraping, ever, under this decision. |
| 11 | Selecting a title locks the project into `title_selected` state (§1.4). Explicit "Change Selection" action required to unlock. |
| 12 | **v1 Demand scoring runs on Etsy engagement data (favorites + views), not Trends** — explicit known limitation, not a silent gap: Demand and Competition are structurally correlated in v1 since both derive from the same Etsy pull (§2.1, §3.1). Accepted tradeoff to unblock Step 2 build now rather than wait on Trends alpha approval. |
| 13 | Demand formula weights (§3.1: 60% favorites / 40% views, bucket thresholds as listed) approved as default — tune later once real data comes in. |
| 14 | AI connector for Step 2 smoke-testing: Groq zero-setup default is sufficient, no BYOK key required to start. |
| 15 | **Build starts now against mock Etsy data** (realistic fake listings — favorite counts, view counts, listing counts), since the Etsy key is pending with no ETA. Mock and real data sources are architected as cleanly swappable behind one interface, so the real key plugs in later without rebuilding the data model, scoring formula, or candidate-generation logic around it. See `workspace/03_build/` for the implementation once it exists. |
| 16 | **Groq model choice corrected from Llama to `openai/gpt-oss-120b`** (2026-08-20). Groq's active model lineup no longer serves any Llama-branded chat model — confirmed live via `client.models.list()` during Increment 4's smoke test, not assumed. Decision 14 and spec §5 both described the zero-setup default as "Llama via Groq"; that's now factually stale. The default is still zero-setup and still Groq, just not literally Llama — spec §5 should be reworded generically ("an open-weight model via Groq") rather than naming a specific model family, since Groq's lineup rotates. |

**Status: Step 2 build is underway using mock Etsy data (decision 15), started ahead of Etsy developer registration (decision 9) since the key is pending with no ETA.** The real Etsy integration slots in behind the same interface once the key is approved — no rework of scoring/classification/persistence logic required at that point. Google Trends remains a tracked future addition (decisions 10/12), not a blocker.

---

Sources consulted for §2 (Research Requirements) factual grounding:
- [Etsy Open API v3 — Rate Limits](https://developer.etsy.com/documentation/essentials/rate-limits/)
- [Etsy Open API v3 — Listings Tutorial](https://developer.etsy.com/documentation/tutorials/listings/)
- [Etsy Open API — Search Result Record Limits Discussion](https://github.com/etsy/open-api/discussions/1188)
- [Gumroad Official API](https://gumroad.com/api) (referenced for original Gumroad ruling-out, no longer in scope)
- [Introducing the Google Trends API (alpha)](https://developers.google.com/search/blog/2025/07/trends-api) — confirms alpha, application-gated, no GA date as of Aug 2026
- [Google Trends' API isn't Public — Use This Instead](https://meetglimpse.com/google-trends-api/)
- [pytrends Is Dead: Google Trends Data in 2026](https://dev.to/esteban_ortega/pytrends-is-dead-heres-how-to-get-google-trends-data-in-2026-1a18) — context on why the unofficial route is no longer viable either
- Etsy listing object fields (`views`, `num_favorers`) confirmed via Etsy API documentation/tutorial search, referenced in §2.1
