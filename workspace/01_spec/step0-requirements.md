# PROTO — Step 0: Niche Discovery Requirements

**Scope:** Pre-Step-1 discovery phase that surfaces promising digital product niches before the user has a specific title idea. Feeds into Step 1 (title input) and Step 2 (title research/scoring). No later pipeline steps are implied.

**Context:** Steps 1–12 are fully built. Step 2 currently expects users to arrive with a specific product title and rationale. Step 0 addresses the cold-start problem: "I want to create a digital product, but I don't know what niche to pursue."

---

## 1. Core Use Case

**User journey:**
1. User clicks "Discover Niches" (Step 0) — no title idea required
2. System generates/surfaces a ranked list of candidate niches with scores
3. User reviews candidates, sees demand/competition indicators and market context
4. User selects a niche → Step 0 data feeds into Step 1/2 (auto-fill or manual transcription)

**Explicit constraints:**
- This is a **personal tool for one user** (Arman), not a multi-tenant public SaaS yet
- Must respect existing rate limits and API budgets (Etsy free tier, Groq free tier)
- Should reuse existing Step 2 architecture where practical (scoring formulas, Etsy integration, classification logic)
- Simplicity over sophistication — MVP should work, not be comprehensive

---

## 2. Data Sources & Tradeoffs

### 2.1 Etsy API — Trending/Seasonal Categories

**What exists:**
- Etsy Open API v3 has `findAllListingsActive` with search parameters including `keywords`, `sort_on` (created/price/updated/score), `taxonomy_id` (category filtering), and pagination
- **No official "trending" or "seasonal" endpoint exists** in the public API v3 documentation
- Etsy publishes seasonal trend reports manually (e.g., "Spring/Summer 2026 Trend Report") but these are editorial content, not API-accessible structured data
- The API allows sorting by `score` (Etsy's internal relevance ranking) but this reflects current search relevance, not trend momentum

**What's possible:**
- **Taxonomy-based scanning:** Query broad categories via `taxonomy_id` (e.g., "digital downloads," "templates," "wedding printables") and sort by `score` or `created` (newest listings as a proxy for emerging interest)
- **Keyword volume proxy:** Search predefined seed keywords and measure total listing count (`totalCount`) + engagement metrics (favorites/views) to infer niche saturation/demand
- **Time-based heuristic:** Filter by `sort_on=created` + recent date range (e.g., listings created in last 30 days) to find niches attracting new sellers (indirect trend signal)

**Tradeoffs:**
| Approach | Pros | Cons |
|---|---|---|
| Scan predefined taxonomy categories | Reuses existing API integration; free tier allows 10K req/day; structured categories map to niches | No true "trending" signal — just static category volume; requires manual category seed list; taxonomy IDs are opaque (need lookup table) |
| Keyword volume scan (batch Step 2) | Directly reuses Step 2 scoring logic; produces familiar demand/competition scores | Expensive (each keyword = 1 Etsy search + 1 LLM classification call); requires seed keyword list; no discovery beyond seeds provided |
| Sort by `created` (new listings) | Captures emerging niches before saturation | Noisy — new listings ≠ validated demand; still requires seed keywords/categories to scan |

**Rate limits (verified):**
- Etsy free tier: **10,000 requests/day** per app (not per user, since this is app-level auth)
- Etsy uses sliding-window rate limiting (Queries Per Second + Queries Per Day) — exact QPS not published, visible in developer portal after app approval
- Decision 17 confirmed real API access is live; keystring + sharedSecret auth working as of Aug 2026

**Recommendation (Decision 1):**
Use **keyword volume scan** (batched Step 2) as v1 approach:
- User provides or system suggests 10–20 seed keywords (e.g., "notion template," "budget planner," "wedding checklist")
- Step 0 runs Step 2's full research pipeline on each seed in parallel
- Results ranked by combined demand/competition score
- **Cost:** 10 seeds × 1 Etsy call = 10 API calls (well within 10K/day limit); 10 seeds × 1 LLM classification call ≈ 10K tokens (within Groq free tier 6K TPM if staggered)
- **Tradeoff accepted:** No true trend discovery beyond seeds, but reuses proven scoring logic and stays within free-tier budgets

**Decision 2 (locked):**
Build a **static seed library** of 50 validated niche keywords via **AI-assisted curation**: AI drafts the list using real Etsy trend reports, forums, and marketplace data as sources; Arman reviews and approves the final list before it ships. Not purely manual (too labor-intensive) and not purely auto-generated (quality control needed).

---

### 2.2 Reversed Step 2 Scoring (Batch Research)

**What this means:**
Run Step 2's `researchTitle()` function across N seed keywords/phrases, collect all results, rank by score.

**Technical feasibility:**
- **Already built** — `researchTitle.ts` is a pure function that takes a title string and returns demand/competition scores
- Parallelizable via `Promise.all()` (existing pattern in `runResearch.ts` for variants)
- Step 2 already produces `ScoreResult` objects with `score`, `color`, and `detail` — perfect for ranking

**Cost analysis (per seed keyword):**
| Resource | Per-seed cost | 10 seeds | 50 seeds | Notes |
|---|---|---|---|---|
| Etsy API calls | 1 search (N=20 listings) | 10 calls | 50 calls | Free tier = 10K/day; 50 seeds = 0.5% of daily quota |
| Groq LLM tokens (classification) | ~1K tokens (20 listings × 50 tokens/listing prompt) | 10K tokens | 50K tokens | Free tier = 6K TPM, 14.4K req/day; 50 seeds requires staggered batches (9 batches @ 6 seeds each, ~1 min total) |
| Latency | ~2–5 sec (Etsy + LLM serial) | 20–50 sec parallel | 100–250 sec (staggered) | Groq rate limit forces sequential batches |

**50-seed batch cost breakdown:**
- **Etsy:** 50 API calls = 0.5% of daily quota (10K limit) — negligible
- **Groq:** 50K tokens ÷ 6K TPM = 8.3 minutes if perfectly batched, but 30 RPM limit (free tier) means 50 requests ÷ 30 = 2 batches minimum. Practical time: **~2–3 minutes** with smart batching
- **Total cost:** $0 (both APIs are free tier)

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Reuses all existing Step 2 code (zero new scoring logic) | Locked to Etsy as sole data source (same Step 2 limitation: demand/competition correlated, per phase1-requirements §2.1) |
| Produces identical score format users already understand from Step 2 | No discovery beyond seed list — user must provide or system must ship with seeds |
| Free within current API budgets (10K Etsy/day, 6K Groq TPM) | Groq TPM limit forces staggered batches (2–3 min latency for 50 seeds) |
| Deterministic, auditable (same formula as Step 2) | Seed quality = output quality; bad seeds → bad recommendations |

**Recommendation (Decision 3):**
**Use reversed Step 2 as the v1 scoring engine.** It's free, already built, and users already trust Step 2 scores. Accept the known limitations (Etsy-only, correlated signals, seed-dependent) explicitly — same tradeoffs already accepted in phase1-requirements decisions 10/12.

---

### 2.3 Google Trends API

**Current status (verified Aug 2026):**
- Google announced official Trends API in July 2025
- **Still application-gated alpha** — no general availability, no published GA timeline
- Application process: submit via Google developer portal, join queue, no approval guarantee
- Most developers as of June 2026 report **no response or rejection** after months
- Phase 1 requirements (decision 10) deferred Trends pending alpha approval — **status unchanged**

**If access were granted:**
- API provides 5-year rolling window of search interest data (0–100 scale), daily/weekly/monthly aggregation, regional breakdowns
- Would add an **independent demand signal** (search interest ≠ Etsy listing engagement) — resolves phase1-requirements §2.1 known correlation issue
- Pricing unknown (alpha terms not public); likely usage-based tiers

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Independent demand signal (breaks Etsy correlation) | Not accessible — alpha application still pending from Step 2 build (decision 10) |
| Authoritative data (Google search volume) | No ETA, no fallback if denied |
| Free tier likely exists (speculation based on other Google APIs) | Scope unknown (what queries/regions supported?) |

**Recommendation (Decision 4):**
**Do not block Step 0 on Google Trends.** Proceed with Etsy-only v1 (same decision as Step 2). If/when Trends access is granted, revisit Step 0 scoring formula to blend Trends interest index with Etsy engagement — treat as a future enhancement, not a launch blocker.

**No unofficial alternatives** — pytrends and scraping methods are unreliable/ToS-violating as of 2026 (confirmed dead per phase1-requirements sources). Phase 1 decision 10 locked out scraping permanently.

---

### 2.4 Social Signals (Pinterest, Reddit, TikTok)

#### Pinterest Trends API

**Current status:**
- Official Pinterest API v5 exists with a `trends_read` endpoint
- **Access gated:** requires approved Business account, app approval, OAuth setup
- Trial access (exploratory) granted to approved developers; Standard access requires video demo of working app + compliance review
- **Critical limitation:** Pinterest API only provides access to **your own account data** — no public trend browsing endpoint exists
- Rate limits per-category (exact limits not published)

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Official API exists | Access gated (approval process required) |
| Trends endpoint exists in API surface | Only provides your own account's data — cannot browse public Pinterest trends |
| Relevant for visual niches (templates, printables) | Requires Business account setup + OAuth flow (complex for single-user tool) |

**Verdict:** **Not viable for Step 0.** The trends_read endpoint doesn't expose marketplace-wide trend data; it's for analyzing your own pins' performance. Pinterest trending searches are visible on the web UI but not accessible programmatically without scraping (violates decision 10).

#### Reddit API

**Current status:**
- Official Reddit API exists; free tier = 100 queries/minute (OAuth-authenticated)
- Commercial tier starts at **$12K/month** for 50M calls ($0.24/1K calls)
- No self-service signup — new OAuth tokens require manual approval (2–4 week timeline)
- Trending topics endpoint exists (`/r/subreddit/hot`, `/r/subreddit/rising`)
- Third-party providers offer cheaper Reddit data APIs ($0.002/call for trend snapshots)

**Use case for Step 0:**
Query `/r/Entrepreneur`, `/r/DigitalNomad`, `/r/SideHustle`, `/r/Notion` hot/rising threads, parse post titles for niche keywords (e.g., "looking for a good budget template" → "budget template" is a signal)

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Free tier (100 QPM) sufficient for Step 0 use case | OAuth approval required (2–4 weeks) — not instant like Etsy |
| Direct signal of user pain points / requests | Signal is unstructured text (Reddit posts ≠ validated demand) |
| Complements Etsy (different audience: people asking vs. people buying) | Requires NLP to extract niche keywords from posts (extra LLM calls = token cost) |

**Cost for trend detection:**
- Poll 5 subreddits × top 25 posts each = 125 API calls (~1–2 min given 100 QPM limit)
- LLM extraction pass on 125 post titles = ~10K tokens (within Groq free tier if batched)
- **Total: $0** on free tier, but requires OAuth app approval first

**Verdict:** **Defer to v2+.** Reddit adds qualitative signal (user pain points) but requires OAuth approval delay + NLP parsing complexity. Not worth the setup cost for v1 when Etsy already provides quantitative demand data.

#### TikTok Creative Center

**Current status:**
- TikTok Creative Center is a **free web tool** (no API, just browser UI) showing top-performing ads, trending hashtags, sounds, and creators
- Data updated constantly; filterable by industry, region, time range (last 7/30/120 days)
- **No official public API** for Creative Center data
- TikTok Marketing API exists (for advertisers running campaigns) but does not expose Creative Center trend data programmatically

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Free, rich trend data (sounds, hashtags, ad formats) | No API — web scraping required (violates decision 10) |
| Highly relevant for creator economy niches | TikTok trends skew toward physical products/lifestyle content, not digital products |
| Real-time trend velocity data | |

**Verdict:** **Not viable for Step 0.** No sanctioned API access path. Web scraping violates phase1-requirements decision 10 (sanctioned sources only). TikTok trends are useful for manual research but can't be systematically integrated without breaking architectural guardrails.

---

### 2.5 AI Brainstorm Pass (LLM-Generated Seeds)

**What this means:**
Use Groq (or user's BYOK LLM) to generate 20–50 niche ideas via a structured prompt, then run Step 2 scoring on the generated list.

**Example prompt structure:**
```
You are a digital product market analyst. Generate 30 specific digital product niche ideas that:
1. Target creators, solopreneurs, or small businesses
2. Are deliverable as templates, guides, trackers, or systems
3. Have potential demand on marketplaces like Etsy/Gumroad
4. Are NOT oversaturated (avoid "social media planner," "resume template")

Respond with JSON array: [{"niche": "Notion freelance client tracker", "rationale": "..."}, ...]
```

**Cost analysis:**
- Prompt: ~200 tokens input
- Response: 30 niches × 50 tokens avg = ~1,500 tokens output
- **Total per brainstorm:** ~1,700 tokens (~$0.00008 on Groq paid tier; **free** on Groq free tier)
- Then: 30 niches × Step 2 scoring (Etsy + classification) = same cost as §2.2 batch (30K Groq tokens for classification, 30 Etsy calls)

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Zero manual seed curation required | LLM outputs are only as good as the prompt + training data (may hallucinate fake niches or repeat common ones) |
| Can prompt for specific attributes (audience, format, constraints) | Still requires Step 2 validation (LLM-generated niche ≠ validated demand) — same batch cost as §2.2 |
| Nearly free on Groq free tier | Output quality unpredictable — needs trial runs to tune prompt |
| Scalable — generate fresh ideas each run | Risk of repetitive outputs across runs (LLMs favor common patterns) |

**Recommendation (Decision 5):**
**Hybrid approach for v1:**
1. Ship with a **static curated seed library** of 50 validated niches (manually sourced from Etsy trend reports, Step 2 runs, forums) as the default
2. Add an **optional "AI Suggest More" button** that runs an LLM brainstorm pass, appends results to the seed pool, then scores via Step 2
3. User can trigger AI suggest if the static library doesn't resonate, but defaults to curated seeds (higher quality, zero API cost until user opts in)

This balances quality (curated seeds) with flexibility (AI expansion) without forcing every Step 0 run to burn tokens on generation.

---

### 2.6 Data Source Recommendation Summary

**Decision matrix:**

| Source | Viability | v1 Use? | Cost/Complexity | Notes |
|---|---|---|---|---|
| **Etsy batch scan (reversed Step 2)** | ✅ High | **YES** | Free; 2–3 min for 50 seeds | Reuses existing code; Etsy-only limitation accepted (same as Step 2) |
| **AI-generated seed niches** | ✅ High | **Optional** | ~1.7K tokens per generation (~$0 on free tier) | Hybrid: curated library default + AI expansion opt-in |
| **Static curated seed library** | ✅ High | **YES (default)** | $0 API cost; manual curation labor upfront | 50–100 niches sourced from Etsy reports, validated via Step 2 |
| **Google Trends** | ❌ Blocked | No | N/A | Alpha access still pending from Step 2 (decision 10); defer to future |
| **Pinterest Trends** | ❌ Limited | No | Approval required; only own-account data | No public trend access; not worth OAuth complexity |
| **Reddit API** | ⚠️ Possible | No (defer to v2) | Free tier viable but requires OAuth approval (2–4 weeks) | Qualitative signal; NLP extraction needed; defer for simplicity |
| **TikTok Creative Center** | ❌ Blocked | No | No API (scraping required) | Violates decision 10 (sanctioned sources only) |

**v1 Architecture (Decision 6 — recommend approval):**
1. **Default seed pool:** 50–100 curated niche keywords (manually compiled, versioned in codebase as JSON)
2. **User workflow:** User sees seed library → filters by category/format → picks 10–20 to score → clicks "Analyze"
3. **Scoring engine:** Batch `researchTitle()` on selected seeds (parallel Etsy + Groq classification per Step 2 architecture)
4. **Optional AI expansion:** "Suggest More Niches" button → LLM generates 20–30 seeds → appends to pool → user selects from expanded set → re-analyze
5. **Cost:** $0 API spend for curated seeds; ~1.7K tokens if user opts into AI expansion

---

## 3. Candidate Volume & Scoring

### 3.1 How Many Candidates to Surface?

**Existing pattern (Step 2):**
Step 2 always returns exactly 4 candidates (decision 7: original + 3 variants) — hard rule, no more/no less.

**Step 0 context:**
Unlike Step 2 (user already has a title, needs validation + alternatives), Step 0 is discovery — user has no starting point. More candidates = more exploration, but also more cognitive load.

**Recommendation (Decision 7):**

| Display tier | Count | Rationale |
|---|---|---|
| **Top tier (always shown)** | 10 niches | Enough to see patterns (e.g., "budgeting" cluster, "wedding" cluster) without overwhelming; scannable in one screen |
| **Expanded view (opt-in)** | 20–50 niches | User clicks "Show More" to see full scored set; allows deep browsing without forcing it |
| **Batch size (backend)** | 10–50 seeds scored | User selects from seed library (or AI-generated pool), picks how many to score (default 20, max 50 to stay within Groq TPM limits) |

**Why 10 top + expandable to 50:**
- 10 fits Step 2's "small set, high signal" UX pattern (4 candidates there; 10 here is proportional for discovery)
- 50 max keeps Groq free tier viable (50K tokens ÷ 6K TPM = ~9 min with batching; acceptable for one-off discovery)
- Expandable view prevents decision paralysis (most users pick from top 10; power users drill deeper)

---

### 3.2 Scoring & Ranking Logic

**Option A: Reuse Step 2 scores exactly**

Rank by **combined score** (demand + competition weighted average), same formula as Step 2's internal ranking.

```
combined_score = (demand_score × 0.5) + (competition_score × 0.5)
```

Sort descending (highest combined score = best opportunity).

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Zero new logic — already validated in Step 2 | Weights demand and competition equally; Step 0 users might prefer high-demand niches even if competitive |
| Users understand the scale (1–10, green/amber/red) | No way to filter by "low competition" vs. "high demand" — single sort axis only |
| Deterministic, auditable | |

**Option B: Separate demand/competition sort toggles**

Let users toggle sort axis:
- "Best Opportunity" (default): combined score (demand + competition balanced)
- "Highest Demand": sort by `demand_score` descending (show me where buyers are, regardless of competition)
- "Lowest Competition": sort by `competition_score` descending (show me blue ocean, regardless of demand size)

**Tradeoffs:**
| Pros | Cons |
|---|---|
| User control — different strategies (whale hunt vs. niche carve-out) | More UI complexity (3 sort modes vs. 1) |
| Reuses same scores, just reorders them | Users may misinterpret (high demand + low competition rarely coexist — could set false expectations) |

**Recommendation (Decision 8):**
**Use combined score (Option A) for v1.** Simplicity matches Step 2 UX (one canonical ranking). Add sort toggles in v2 if users request filtering by specific axis. Document the formula explicitly in the UI ("Ranked by balanced demand + competition score") so users know it's not pure demand or pure opportunity.

**Score display:**
Show both scores separately (not just combined):

```
Niche: "Notion Budget Tracker for Freelancers"
Demand:      ████████░░ 8/10 (Green)
Competition: ██████░░░░ 6/10 (Amber)
Overall:     ███████░░░ 7/10
```

This lets users mentally apply their own weighting ("I only want green competition") even if the sort is combined.

---

### 3.3 Contextual Data (Beyond Just Scores)

**What does the user see per candidate?**

Minimum (required):
- Niche title (the seed keyword scored)
- Demand score (X/10, color)
- Competition score (Y/10, color)
- Combined/overall score (Z/10)

Enhanced (recommended):
- **Why this niche?** One-sentence rationale auto-generated by LLM or pulled from seed library metadata (e.g., "Freelancers need budget tracking; low competition in Notion format niche")
- **Market size indicators:** Exact-angle listing count (from `competition_signal_detail.exactAngleMatchCount`) + total broad-topic count — gives user concrete sense of niche size
- **Example competing products:** Top 3 Etsy listing titles from exact-angle matches (from `researchTitle()` output) — shows user what "good" looks like in that niche
- **Price range:** Min/max price of exact-angle listings (already captured in Step 2's `competition_signal_detail.exactAngleMatchPrices`) — informs monetization potential

**Decision 9:**
Which enhanced fields to include in v1?

| Field | Value to user | Cost to add | Recommend? |
|---|---|---|---|
| **Rationale** | Helps user understand *why* the system surfaced this niche | If using curated library: $0 (pre-written). If AI-generated: ~100 tokens/niche (5K tokens for 50 niches = $0 on free tier) | ✅ YES (include for curated; generate for AI seeds) |
| **Market size (listing counts)** | Concrete validation ("127 exact matches, 2,341 total — established but not saturated") | $0 (already in Step 2 output) | ✅ YES (already computed) |
| **Example products (top 3 titles)** | Shows user the competitive set; inspiration for Step 1 title refinement | $0 (already in Step 2 output: `exactAngleMatchListingTitles`) | ✅ YES (slice first 3 from array) |
| **Price range** | Monetization signal ("competitors price $7–$25 — viable premium positioning") | $0 (Step 2 already captures this per decision in phase1-requirements §2.1) | ✅ YES (already in `competition_signal_detail`) |

**Recommendation:** Include all four enhanced fields. Zero marginal cost (data already exists in Step 2 output), high user value (turns raw scores into actionable market intel).

**Example UI card:**

```
┌─────────────────────────────────────────────────────────┐
│ Notion Budget Tracker for Freelancers                  │
│                                                         │
│ Demand:      ████████░░ 8/10 (Green)                   │
│ Competition: ██████░░░░ 6/10 (Amber)                   │
│ Overall:     ███████░░░ 7/10                           │
│                                                         │
│ Why: Freelancers need expense tracking; Notion format  │
│      is underserved vs. Excel templates (127 matches   │
│      vs. 2,341 total budget trackers on Etsy).         │
│                                                         │
│ Market: 127 exact-angle listings, $12–$29 price range  │
│                                                         │
│ Examples:                                               │
│  • Freelance Budget Planner | Notion Template          │
│  • Notion Budget Tracker + Expense Log                 │
│  • Monthly Budget Template for Self-Employed           │
│                                                         │
│ [Select This Niche →]                                  │
└─────────────────────────────────────────────────────────┘
```

---

## 4. One-off vs. Periodic

### 4.1 Execution Model

**Option A: One-off "give me ideas now"**

User clicks "Discover Niches" → picks seeds (or uses default curated set) → runs batch scoring → reviews results. Ephemeral — results not saved, user must re-run if they want fresh data.

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Simple — no scheduling, no background jobs, no persistent storage beyond what Step 2 already uses | User must manually re-run to see trend changes over time |
| Zero infrastructure cost (no cron, no queue) | No "here's what changed since last week" diff view |
| Fits single-user tool profile | |

**Option B: Periodic (weekly digest)**

System auto-runs Step 0 scoring every week on a fixed seed set (e.g., the curated 50-niche library), emails user a "Top 10 Trending Niches This Week" digest with score deltas vs. prior week.

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Passive discovery — user doesn't need to remember to check | Requires persistent storage of prior runs (new table: `niche_discovery_runs`) |
| Trend delta view ("Notion templates +12% demand this week") adds signal | Requires background job scheduler (cron, GitHub Actions, Supabase Edge Function trigger) |
| Keeps user engaged even when not actively building | Costs API quota weekly regardless of whether user reads digest (50 Etsy calls + 50K Groq tokens/week = 200 calls/month, 200K tokens/month — still free tier but non-zero burn) |

**Cost comparison (weekly periodic for 50 seeds):**

| Resource | Weekly cost | Monthly cost | Annual cost | Free tier limit |
|---|---|---|---|---|
| Etsy API calls | 50 | 200 | 2,400 | 10,000/day (3.65M/year) — negligible |
| Groq tokens | 50K | 200K | 2.4M | 6K TPM (259M/month @ 100% utilization) — negligible |
| Email delivery (if digest via email) | 4 emails/month | 4 | 48 | Depends on provider (Resend free tier = 100/day) — negligible |

**Verdict:** Periodic is viable on free tiers, but adds complexity (scheduler, email template, storage, delta logic).

**Recommendation (Decision 10):**
**Ship v1 as one-off only.** Rationale:
- Single user (Arman) can manually trigger when needed — no passive discovery urgency
- Avoids infrastructure complexity (no scheduler, no new tables for run history/deltas)
- Free tier budget better spent on user-initiated runs (on-demand depth) than automated shallow scans
- Periodic can be added in v2 if user finds themselves manually re-running weekly (validates demand for automation)

If periodic is desired later:
- Store `niche_discovery_runs` table: `id`, `workspace_id`, `run_date`, `results_json` (array of scored niches)
- Weekly cron (Supabase Edge Function or GitHub Actions) runs Step 0, compares to prior week, emails top 10 with deltas
- Cost stays within free tiers (200 Etsy calls/month << 10K/day limit)

---

## 5. Handoff to Step 1/2

### 5.1 Data Flow When User Selects a Niche

**User action:** Clicks "Select This Niche" on a Step 0 candidate card.

**Three handoff options:**

#### Option A: Auto-fill Step 1 (title + rationale pre-populated)

- Step 0 writes selected niche to Step 1's `title_ideas` table: `original_title` = niche seed text, `rationale` = Step 0's generated/curated rationale
- User lands on Step 1 with fields pre-filled, editable before proceeding to Step 2
- Step 2 re-runs research on the (possibly edited) title — fresh data, not carried forward from Step 0

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Seamless UX — one click from discovery to research | Step 0 scoring already ran Step 2 on this exact seed; re-running in Step 2 = duplicate API calls (1 Etsy + 1 LLM per niche, wasted if user doesn't edit) |
| User can refine title/rationale before committing | If user picks 3 niches to explore, that's 3× Step 2 runs (already done in Step 0) — poor API budget use |
| Preserves Step 1's editing flow (§1.3 mutability) | |

#### Option B: Carry forward Step 0 scores (skip Step 2 re-research)

- Step 0 writes a full `research_run` + 4 `title_candidates` to the database (reusing Step 2 schema)
- Candidate 1 = the selected seed (marked `is_original = true`)
- Candidates 2–4 = generated variants (via `generateTitleVariants()`, same as Step 2 §3.2)
- User lands on Step 3 (selection screen) with Step 0's scores, skips Step 2 entirely
- If user edits the title in Step 1 (before selecting a niche), Step 0 data is discarded and Step 2 runs fresh

**Tradeoffs:**
| Pros | Cons |
|---|---|
| No duplicate API calls — Step 0 scoring = Step 2 scoring, reuse it | Breaks Step 2's "always fresh research" contract — scores are stale from Step 0 run (could be hours/days old if user explores multiple niches) |
| Faster user flow (discovery → selection, no intermediate research wait) | Variants generated in Step 0 are based on Step 0 seed + generic rationale, not user's refined Step 1 rationale — lower quality than Step 2's variants |
| Saves API budget (50 niches scored once in Step 0; user picks 1 → 1 batch, not 50 sequential) | Complex state management: if user edits title, must invalidate Step 0 data and trigger Step 2 |

#### Option C: Inspiration only (manual transcription)

- Step 0 is read-only — shows scored niches, user reviews them
- When user clicks "Select This Niche," they are taken to Step 1 with an empty form
- Niche title + rationale + example products are **displayed as reference** (sidebar or modal) while user writes their own Step 1 input
- Step 2 runs fresh on whatever the user writes, no data carried forward

**Tradeoffs:**
| Pros | Cons |
|---|---|
| Clean separation — Step 0 = discovery, Step 1/2 = execution; no state bleed | Extra friction — user must manually copy/adapt the niche idea into their own words |
| No duplicate API calls (user writes a *derivative* of the Step 0 seed, not the seed itself → Step 2 researches the derivative, not a duplicate) | Loses seamless UX — feels like two disconnected tools, not one pipeline |
| Preserves Step 2's "always fresh" guarantee | |

**Recommendation (Decision 11):**
**Use Option A (auto-fill Step 1, re-run Step 2).** Rationale:

- Duplicate API cost is acceptable in v1 (single user, free tier has massive headroom: 10K Etsy calls/day, Step 0 uses 50 calls once, Step 2 uses 4 calls per project → even if user explores 10 niches, total = 50 + 40 = 90 calls, <1% of daily quota)
- Seamless UX beats API efficiency for a personal tool (if this were multi-tenant SaaS, Option B's cost savings would matter more)
- Preserves Step 2's "fresh research" contract — user might edit the title before running Step 2, making Step 0's scores stale anyway
- Step 0 seeds are often generic ("notion budget tracker") but user will refine in Step 1 ("notion budget tracker for freelancers with crypto income") → Step 2's research on the refined title produces better variants than Step 0 could

**Fallback (if API costs become a concern):**
Add a **"Use Step 0 Scores" checkbox in Step 1** — default unchecked (re-run Step 2), but user can check it to carry forward Step 0 data (Option B path). Requires minimal schema change (tag `research_runs` with `source: 'step0' | 'step2'` to differentiate carried-forward vs. fresh runs).

---

### 5.2 What Data Persists from Step 0?

**Minimum (Option A/C):** Nothing — Step 0 is ephemeral, results exist only in-memory during the session.

**Optional (future enhancement):** Store Step 0 runs in a `niche_discovery_runs` table for history/comparison:

| Field | Type | Purpose |
|---|---|---|
| `id` | uuid | PK |
| `workspace_id` | uuid | FK (multi-tenant boundary) |
| `run_date` | timestamp | When the scan ran |
| `seed_source` | enum | `'curated_library'` / `'ai_generated'` / `'user_custom'` |
| `results_json` | jsonb | Array of scored niches: `[{seed, demand_score, competition_score, rationale, examples, ...}, ...]` |
| `selected_niche_id` | uuid | FK to `title_ideas` if user selected one (nullable) |

**Use cases for persistence:**
- User wants to compare this week's trends vs. last week's (requires 2+ runs stored)
- User ran Step 0 a month ago, wants to revisit the scored niches without re-running (API cost savings)
- Analytics: "Which Step 0 niches did user explore but not commit to?" (informs future seed curation)

**Recommendation (Decision 12):**
**Do not persist Step 0 runs in v1.** Keep it ephemeral (results shown, user selects one or closes the page). Rationale:
- Simpler — no new table, no RLS policies, no "view past runs" UI
- Trends change fast — month-old Step 0 scores are misleading (demand/competition shifts weekly on Etsy)
- Single user has no comparison use case yet (no team to share discoveries with, no historical trend analysis workflow)

Add persistence in v2 if user manually requests "I wish I could see last month's results again" — validates the need before building storage.

---

## 6. Cost Concerns & Budget Constraints

### 6.1 Per-Run Cost Breakdown (50-Seed Batch)

| Resource | Unit Cost | 50-Seed Batch Cost | Free Tier Limit | % of Quota Used |
|---|---|---|---|---|
| **Etsy API calls** | 1 search/seed | 50 calls | 10,000/day | 0.5% |
| **Groq tokens (classification)** | ~1K tokens/seed | 50K tokens | 6K TPM, 14.4K req/day | 100% of single-minute quota (requires 9 min staggered batching) |
| **Groq requests** | 1 classification call/seed | 50 requests | 30 RPM | 167% of single-minute quota (requires 2 min staggered batching) |
| **Total monetary cost** | Free tier, no $ cost | $0 | N/A | N/A |
| **Latency** | 2–3 sec/seed (serial Etsy + Groq) | ~2–3 minutes (parallelized with Groq batching) | N/A | Acceptable for one-off discovery |

**Groq free tier constraints (verified Aug 2026):**
- **30 RPM** (requests per minute) → 50 seeds ÷ 30 = 1.67 batches → minimum 2 minutes if perfectly batched
- **6K TPM** (tokens per minute) → 50 seeds × 1K tokens = 50K tokens ÷ 6K = 8.3 minutes if at token limit
- **14.4K requests/day** → 50 seeds = 0.35% of daily quota

**Practical batching strategy:**
```typescript
// Batch 30 seeds/minute (RPM limit), process in 2 waves
const batch1 = seeds.slice(0, 30); // Process immediately
const batch2 = seeds.slice(30, 50); // Wait 60 sec, then process

// Each seed's classification call = ~1K tokens, well under 6K TPM when spread across 30 requests/min
```

Total time: 2 minutes for 50 seeds (acceptable for a one-off discovery run).

---

### 6.2 Etsy API Rate Limits (Verified)

**From phase1-requirements decision 17 + WebFetch §2:**
- **10,000 requests/day** (free tier, confirmed from search results)
- **Queries Per Second (QPS)** not publicly disclosed; visible in developer portal after app approval
- Uses **sliding window rate limiting** (not fixed 24-hour cycle)

**Step 0 impact:**
- 50-seed batch = 50 Etsy calls = 0.5% of daily quota
- Even if user runs Step 0 ten times in one day (500 calls), still only 5% of quota
- Step 2 (4 calls per project) + Step 0 (50 calls per discovery run) comfortably coexist on free tier

**No additional throttling needed** — free tier headroom is enormous for single-user use.

---

### 6.3 Groq Token Costs at Scale

**Groq free tier (verified Aug 2026):**
- **No per-token charge** on free tier — genuinely free, gated only by rate limits (30 RPM, 6K TPM, 14.4K req/day)
- **Paid tier pricing:** $0.05–$1.00 per 1M input tokens (model-dependent); Step 0 would use `openai/gpt-oss-120b` (same as Step 2, per decision 16) = $0.05/1M input tokens

**Step 0 token consumption (per 50-seed batch):**
- Classification: 50 seeds × 1K tokens = 50K tokens
- AI seed generation (if opted in): 1,700 tokens per brainstorm
- **Total:** ~52K tokens per full Step 0 run (curated seeds + one AI expansion)

**Annual cost if user ran Step 0 weekly on paid tier:**
- 52 runs/year × 52K tokens = 2.7M tokens/year
- 2.7M ÷ 1M × $0.05 = **$0.135/year**

**Verdict:** Token cost is negligible even on paid tier. Free tier handles Step 0 + Step 2 combined with room to spare (6K TPM = 8.6M tokens/day if sustained; Step 0 uses 52K once per run).

---

### 6.4 Cost Bounding Strategy

**Risk:** User accidentally triggers 100 Step 0 runs in one day (e.g., UI bug, automation script gone wrong).

**Mitigation options:**

| Strategy | Pros | Cons |
|---|---|---|
| **No cap (current Step 2 approach, decision 5)** | Simple; single user can self-monitor | Risk of quota exhaustion if misused |
| **Client-side rate limit (1 run per 5 min)** | Prevents accidental rapid-fire clicks | Easily bypassed (refresh page, disable JS) |
| **Server-side rate limit (5 runs/day per workspace)** | Enforceable; protects API quotas | Requires new rate-limit tracking table + logic |
| **Manual quota monitoring (dashboard)** | User sees "You've used X/10K Etsy calls today" | Reactive, not preventative |

**Recommendation (Decision 13):**
**No hard cap in v1 (same as Step 2 decision 5).** Rationale:
- Single user (Arman) is trusted not to abuse the system
- Free tier quotas are so high (10K Etsy/day, 6K Groq TPM) that accidental overuse is unlikely to hit limits
- Adding rate-limit infrastructure for a single-user tool is premature optimization

**Flag to revisit before multi-user launch** (same note as phase1-requirements decision 5) — if/when PROTO becomes multi-tenant, add per-workspace rate limits (e.g., 10 Step 0 runs/day, 50 Step 2 runs/day).

**Monitoring (no code required):**
- Etsy: Check developer portal dashboard for daily QPD usage
- Groq: Check GroqCloud console for daily request/token usage
- Set calendar reminder to review quarterly (overkill for single user, but ensures no surprises)

---

## 7. Decisions Summary

All decisions locked by Arman on 2026-08-31.

| # | Decision | Locked Value | Notes |
|---|---|---|---|
| **1** | Data source for v1 | **Hybrid: 50-niche curated library + optional AI expansion + batch Step 2 scoring** | Approved as recommended |
| **2** | Curated library source | **AI-assisted curation** | AI drafts list from real Etsy trend reports/forums; Arman reviews/approves final list before shipping. Not purely manual, not purely auto-generated. |
| **3** | Scoring engine | **Reuse Step 2 exactly** | Zero new scoring code; same demand/competition formulas |
| **4** | Google Trends integration | **Proceed without** | Same as Step 2 decision 10; don't block on unavailable API |
| **5** | AI seed generation | **Include in v1 (optional/opt-in)** | "Suggest More Niches" button ships in v1; no downside since it's opt-in |
| **6** | v1 architecture | **Approved** | Hybrid curated + AI + batch Step 2 |
| **7** | Candidate display count | **Top 10, expandable to 50** | Approved as recommended |
| **8** | Ranking logic | **Combined score (demand + competition balanced)** | Show both scores separately for transparency |
| **9** | Enhanced context fields | **All 4: rationale, market size, examples, price range** | Zero marginal cost; high user value |
| **10** | Execution model | **One-off only in v1** | Manual trigger; no weekly digest; defer periodic to v2 |
| **11** | Handoff to Step 1/2 | **Auto-fill Step 1, re-run Step 2** | Accept duplicate API cost; preserves "fresh research" contract |
| **12** | Persist Step 0 runs? | **Ephemeral (no persistence in v1)** | Results shown, user picks one or closes; revisit if history is wanted later |
| **13** | Rate limiting | **No cap** | Single user, trusted; free tier quotas enormous |

---

## 8. Technical Architecture (Proposed)

### 8.1 New Components

| Component | Location | Purpose |
|---|---|---|
| **Curated seed library** | `/workspace/03_build/lib/discovery/seeds.json` | Static list of 50–100 validated niches with metadata (title, rationale, category tags) |
| **Seed generator (AI)** | `/workspace/03_build/lib/discovery/generateSeeds.ts` | LLM prompt + JSON parsing for "Suggest More Niches" feature |
| **Batch scoring orchestrator** | `/workspace/03_build/lib/discovery/runDiscovery.ts` | Wraps `researchTitle()` in parallel batches, respects Groq TPM/RPM limits |
| **Discovery results UI** | `/workspace/03_build/app/discovery/page.tsx` (Next.js route) | Renders scored niches with enhanced context (scores, examples, price range) |

### 8.2 Reused Components (No Changes)

- `researchTitle()` — used as-is for per-seed scoring
- `computeDemandScore()` / `computeCompetitionScore()` — scoring formulas unchanged
- `classifyExactAngleMatches()` — LLM classification unchanged
- `getEtsyDataSource()` — Etsy API client unchanged
- Groq LLM client (`groqJsonCompletion()`) — used for AI seed generation + classification

### 8.3 Data Model (No New Tables in v1)

**Decision 12 locked:** No persistent storage for Step 0 runs in v1 (ephemeral).

If persistence is added later (v2+):

```sql
CREATE TABLE niche_discovery_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) NOT NULL,
  run_date TIMESTAMPTZ DEFAULT now(),
  seed_source TEXT CHECK (seed_source IN ('curated_library', 'ai_generated', 'user_custom')),
  results_json JSONB NOT NULL, -- Array of {seed, demand_score, competition_score, ...}
  selected_niche_id UUID REFERENCES title_ideas(id), -- Nullable; tracks if user picked one
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: same workspace-scoped pattern as existing tables
ALTER TABLE niche_discovery_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_own_workspace ON niche_discovery_runs FOR SELECT USING (
  workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
);
```

**Not required for v1** — noted for future reference only.

---

## 9. User Workflow (Proposed UX)

**Step 0 Entry Points:**

1. **From dashboard:** "Discover Niches" button (parallel to "Start New Project")
2. **From Step 1 (if user arrives with no idea):** "I don't have an idea yet" link → redirects to Step 0

**Step 0 Flow:**

```
┌─────────────────────────────────────────────────────────┐
│ Step 0: Niche Discovery                                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ Choose niches to analyze:                              │
│                                                         │
│ ☑ Budget & Finance Templates (12 seeds)                │
│ ☐ Wedding & Event Planning (8 seeds)                   │
│ ☑ Notion Productivity Systems (15 seeds)               │
│ ☐ Digital Planners (10 seeds)                          │
│ ...                                                     │
│                                                         │
│ [ Suggest More Niches (AI) ]                           │
│                                                         │
│ Selected: 27 seeds                                      │
│                                                         │
│ [ Analyze These Niches → ]                             │
└─────────────────────────────────────────────────────────┘

(User clicks "Analyze")

┌─────────────────────────────────────────────────────────┐
│ Analyzing 27 niches... (Est. 1–2 min)                  │
│ ████████████░░░░░░░░░░░░ 50% (14/27 complete)          │
└─────────────────────────────────────────────────────────┘

(Results load)

┌─────────────────────────────────────────────────────────┐
│ Top 10 Opportunities (sorted by overall score)          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 1. Notion Budget Tracker for Freelancers               │
│    Demand: 8/10 | Competition: 6/10 | Overall: 7/10    │
│    127 listings, $12–$29 | [View Details] [Select →]   │
│                                                         │
│ 2. Wedding Guest List Template (Google Sheets)         │
│    Demand: 7/10 | Competition: 8/10 | Overall: 7.5/10  │
│    43 listings, $8–$18 | [View Details] [Select →]     │
│                                                         │
│ ...                                                     │
│                                                         │
│ [ Show All 27 Results ]                                │
└─────────────────────────────────────────────────────────┘

(User clicks "Select →" on a niche)

→ Redirects to Step 1 with:
  - title_ideas.original_title = "Notion Budget Tracker for Freelancers"
  - title_ideas.rationale = (auto-filled from seed library or AI-generated)

User edits if desired, then proceeds to Step 2 (which re-runs research).
```

---

## 10. Implementation Phases (If Approved)

**Phase A: Curated Library + Batch Scoring (Core MVP)**
- Manually compile 50 niches into `seeds.json` (category-tagged, with rationales)
- Build `runDiscovery()` orchestrator (wraps `researchTitle()`, batches per Groq limits)
- Build Step 0 UI (seed selection, progress indicator, results table)
- Test with 10-seed batch, verify API costs match projections

**Phase B: AI Seed Expansion (Optional Feature)**
- Build `generateSeeds()` LLM prompt + JSON parsing
- Add "Suggest More Niches" button to Step 0 UI
- Append AI-generated seeds to curated library, re-score combined pool

**Phase C: Enhanced Context & Handoff**
- Extract rationale, market size, examples, price range from Step 2 output
- Render enhanced candidate cards in Step 0 results UI
- Implement "Select This Niche" → auto-fill Step 1 → trigger Step 2 flow

**Phase D (Future/v2):** Periodic digest, persistent storage, sort toggles, Reddit integration.

---

## 11. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **Groq TPM limit causes slow batching (>5 min for 50 seeds)** | Poor UX (user abandons discovery run) | Medium | Test with 10-seed batch first; if too slow, reduce max batch size to 30 seeds or add "Quick Scan (10 seeds)" vs. "Deep Scan (50 seeds)" toggle |
| **Curated library becomes stale (niches oversaturate)** | Step 0 recommends saturated niches → bad user experience | High (Etsy trends shift quarterly) | Add "Last Updated" timestamp to `seeds.json`; set quarterly review reminder to re-score library and prune/add seeds |
| **AI-generated seeds are low-quality (generic or nonsensical)** | User opts into AI expansion, gets garbage niches | Medium | Validate LLM output strictly (reject any seed <5 words or >100 chars); test prompt with 10 trial runs before shipping; include disclaimer "AI suggestions are experimental" |
| **User expects Step 0 to find breakout niches (unicorn discovery)** | Unmet expectations (Step 0 scores existing Etsy data, can't predict future trends) | Medium | Set expectations clearly in UI: "Based on current Etsy marketplace data — scores reflect today's demand/competition, not future trends" |
| **Duplicate API calls (Step 0 + Step 2 both research same seed)** | Wastes API quota | Low (free tier has headroom) | Acceptable in v1 (Decision 11); add "Use Step 0 Scores" checkbox in Step 1 if this becomes a concern |

---

## 12. Success Metrics (Proposed)

Since this is a personal tool (single user), formal analytics are overkill, but these signals validate whether Step 0 is useful:

| Metric | How to Measure | Success Threshold |
|---|---|---|
| **Adoption rate** | % of new projects that started from Step 0 vs. direct Step 1 entry | >30% of projects begin with Step 0 (validates cold-start problem exists) |
| **Selection rate** | % of Step 0 runs where user selected a niche and proceeded to Step 1 | >50% (if <50%, Step 0 results aren't compelling) |
| **Seed source split** | Curated library vs. AI-generated (if AI expansion is used) | Curated >70% (validates curation quality over AI) |
| **User feedback** | Manual notes after first 5 Step 0 runs | "Helped me find a niche I wouldn't have thought of" or "Too generic, prefer my own ideas" |

**Tracking (minimal):** Add a `source` field to `projects` table: `'step0'` or `'step1_direct'`. Query monthly: `SELECT source, COUNT(*) FROM projects GROUP BY source;`.

---

## 13. References & Sources

**Etsy API:**
- [Etsy Open API v3 Rate Limits](https://developer.etsy.com/documentation/essentials/rate-limits/)
- [Etsy Open API v3 Listings Tutorial](https://developer.etsy.com/documentation/tutorials/listings/)
- [Etsy API Search Result Limits Discussion](https://github.com/etsy/open-api/discussions/1188)
- [findAllListingsActive endpoint parameters](https://github.com/gordonturner/etsy-open-api-client/blob/main/docs/ShopListingApi.md)

**Google Trends API:**
- [Introducing the Google Trends API (alpha)](https://developers.google.com/search/blog/2025/07/trends-api)
- [Google Trends API alpha access application](https://developers.google.com/search/apis/trends)
- [Google Trends' API isn't Public – Use This Instead](https://meetglimpse.com/google-trends-api/)
- [pytrends Is Dead: Here's How to Get Google Trends Data in 2026](https://dev.to/esteban_ortega/pytrends-is-dead-heres-how-to-get-google-trends-data-in-2026-1a18)

**Groq API:**
- [Groq Pricing In 2026: Every Model, Tier, And Cost Compared](https://www.cloudzero.com/blog/groq-pricing/)
- [Groq Free Tier 2026 — Free Models, Credits & Limits](https://pricepertoken.com/endpoints/groq/free)
- [Groq Free Tier Limits 2026: 30 RPM, 6K TPM, 14.4K Req/Day](https://tokenmix.ai/blog/groq-free-tier-limits-2026)
- [Groq API Pricing 2026: Free Tier, 315 TPS, $0.05/M Paid Models](https://tokenmix.ai/blog/groq-api-pricing)

**Social Signal APIs:**
- [Pinterest API Pricing: Complete Guide for 2026](https://www.blotato.com/blog/pinterest-api-pricing)
- [Understanding Pinterest Access Tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/)
- [Reddit API Pricing in 2026: Complete Guide](https://www.techloy.com/reddit-api-pricing-in-2026-complete-guide-for-developers-and-businesses/)
- [Detect Trending Topics on Reddit: 2026 API Guide](https://www.redditapis.com/blogs/detect-trending-topics-reddit-api-2026)
- [TikTok Creative Center Guide: Top Ads, Trends & Research Workflow](https://www.admapix.com/blog/ad-intelligence/tiktok-creative-center-tutorial)
- [TikTok Trends API: Get Real-Time Insights](https://data365.co/blog/tiktok-trends-api)

**Etsy Marketplace Trends (2026):**
- [Leading Trends for Etsy 2026: Keywords, Styles, Bestsellers](https://printify.com/blog/leading-trends-for-etsy-sellers-in-2026/)
- [Etsy Trends 2026: Complete Guide to What's Trending](https://www.sellerapp.com/blog/etsy-trends/)
- [Seller Trend Report: Spring and Summer 2026](https://www.etsy.com/seller-handbook/article/1473931456647)

**Phase 1 Requirements (Internal):**
- `/Users/armandsatar/Projects/PROTO/workspace/01_spec/phase1-requirements.md` — data model, Step 2 architecture, decisions 1–17
- `/Users/armandsatar/Projects/PROTO/workspace/03_build/lib/research/researchTitle.ts` — Step 2 research orchestration
- `/Users/armandsatar/Projects/PROTO/workspace/03_build/lib/scoring/demand.ts` — Demand X/10 formula
- `/Users/armandsatar/Projects/PROTO/workspace/03_build/lib/scoring/competition.ts` — Competition Y/10 formula

---

## 14. Decision Lock Record

All 13 decisions locked by Arman on 2026-08-31. Key deviations from original recommendations:

- **Decision 2:** Changed from "manual curation" to "AI-assisted curation" — AI drafts the 50-niche list from real sources, Arman reviews/approves before shipping. Reduces upfront labor while maintaining quality control.
- **Decision 5:** Changed from "optional, consider deferring" to "include in v1" — the "Suggest More Niches" button ships from day one since it's opt-in with no downside.

All other decisions accepted as recommended. Build may proceed.

---

**End of Step 0 Requirements Document**
