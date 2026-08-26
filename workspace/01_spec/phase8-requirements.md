# PROTO — Phase 8 Technical Requirements: Step 10 (Copywriting)

**Scope:** Spec Step 10 only — generating platform-specific **store listing copy** (Etsy, Gumroad, StanStore, Whop) and **social promo copy** (Pinterest pin, Instagram caption) for a project, respecting each destination's real format/length conventions (§3), running an anti-slop/anti-genericness pass tuned to marketing-copy failure modes (§5) and a compliance pass carried over from Step 8's health-claims guardrail (§6), and giving the user manual edit + regenerate + confirm control per §7. Consumes the confirmed title (Steps 1–3), confirmed format + delivery mode (Step 4), the transformation map (Step 6, tone/voice context), the confirmed subtopics list (Step 7, structural "what's inside" signal), the confirmed content bodies (Step 8, the source of concrete, niche-specific detail this phase pulls from — see §2), and the approved cover (Step 9, light style/mood context only — see §2.5). **Does not cover:**
- **Step 11 (Export)** — the actual output-file assembly (PDF/Notion/Docx/ebook). Notably, Step 11 runs *after* this phase in the pipeline, which creates a real sequencing question this document surfaces rather than silently resolves — see §2.6.
- **Step 12 (Pricing)** — no price is known or referenced at this stage.
- **The Bundle Engine** — no cross-product bundling logic.
- **Actually publishing/posting copy to any platform via API** (Etsy's listing API, Instagram's Graph API, etc.). Nothing in the product spec describes PROTO as a publishing/scheduling tool for Step 10 — this phase produces copy text for Arman to manually paste into each platform's own listing/post-creation flow. Stated explicitly because it's an easy scope creep to assume otherwise once "platform-specific" is in the phase name.
- **Hashtag strategy as its own research discipline** beyond what's needed to fit Instagram/Pinterest's own conventions — confirmed out of scope, decision 9, §10.

**Connector: Groq, same precedent as every prior text-generation phase, no correction needed.** Unlike Step 8/Step 9 (which both had to flag a spec-vs-reality connector correction), Step 10's own spec text names no connector at all — §5 of the product spec's "Claude API" language is the same BYOK-aspirational text already established as not-yet-built (per `phase6-requirements.md`'s callout). This document defaults to Groq (`lib/ai/groq.ts`, `openai/gpt-oss-120b`, confirmed live) for the same reason every phase since Step 2 has: it's the connector that actually exists. **No new connector is needed.** Generation here is pure text-in/text-out — there is no requirement anywhere in this phase for the model to *see* the cover image (§2.5 works through this explicitly), so Nano Banana 2/Gemini's vision capability is never invoked. `getSignedCoverUrl` (Step 9) is only relevant for showing a human-facing preview of the cover next to generated copy in the UI — not as a generation input.

**Status: Decisions Locked (2026-08-26), with two explicit exceptions.** All 12 items in §10 confirmed by Arman, except decisions 5 (StanStore/Whop field limits) and 6 (Gumroad Markdown), which are deferred pending Arman's own account verification and do not block DEV work on the rest of the phase. DEV work starts now.

---

## 0. Shape Determination

### 0.1 Does an established shape fit?

| Shape | Precedent | Defining property | Fits Step 10? |
|---|---|---|---|
| Recommend/confirm | Steps 4–5 | AI proposes one enum value, user accepts/overrides | No — there's no small enumerated choice being made; six pieces of prose are being generated |
| Single editable record + log | Step 6 | One project-level text record | No — six independently-editable records exist, not one |
| Live variable-length collection | Step 7 | N self-managed rows, user adds/deletes/reorders | No — the set of platforms is fixed (6), not user-managed |
| Editable-content-per-row, N inherited from upstream | Step 8 | N rows, N inherited from a live upstream table (`subtopics`) | **Close, but not exact** — see §0.2 |
| Candidate-artifact + lineage + mandatory approval | Step 9 | Binary asset, iterative edit, human taste gate | No — copy is text PROTO *can* guardrail deterministically (character counts, keyword scans), unlike an image |

### 0.2 The real shape: Step 8's pattern, but N is a fixed code-level enum, not an inherited table

Step 8's defining property was "N rows, cardinality inherited from `subtopics`, Step 8 never adds/deletes its own rows." Step 10 shares the second half of that (it never adds/deletes rows on its own initiative) but **N here is not inherited from any database table at all — it's a fixed set of 6 platforms, defined in code** (`etsy`, `gumroad`, `stanstore`, `whop`, `pinterest`, `instagram`). This is closer to how Step 9 treats its template registry (§7.5 of `phase7-requirements.md`: "templates are a small, code-level registry... not a database table") than to Step 8's `subtopics` dependency — the *set of platforms* is a code constant, not a mutable per-project artifact.

**Conclusion: Step 10 is Step 8's editable-content-per-row shape (header + append-only log + live row-per-unit), with the row set keyed by a fixed `copy_platform` enum instead of an inherited foreign table.** No new fifth/sixth shape is needed — this is a genuine, minor variant of an existing one, not a reinvention.

### 0.3 A genuinely new wrinkle: the six rows are not structurally identical

Every one of Step 8's N rows held the same shape (`body: text`, one prose field). Step 10's six rows do **not** share one field set — Instagram is caption-only; Etsy needs title + description + a structured tag list; StanStore needs title + subtitle + description; Whop needs name + headline + description; Pinterest needs title + description. This heterogeneity is real and drives the data-shape recommendation in §8 — flagged here so it isn't silently smoothed over by reusing Step 8's single-`body`-column shape unmodified.

---

## 1. Inputs Consumed — What Each Upstream Artifact Contributes, and Why

| Input | Source | Included? | Role |
|---|---|---|---|
| Selected title text | `title_candidates.candidate_text` | Yes — primary anchor | Same anchor role as every prior phase |
| Confirmed format + delivery mode | `format_recommendations.confirmed_format` / `confirmed_delivery_mode` | Yes | Determines value-prop framing (a tracker's pitch differs from an ebook's) and whether "printable" or "fillable" language is accurate — see §2.6 for a real limit on how far this can be trusted at this pipeline position |
| Transformation map (headline + 4 dimensions) | `transformation_maps` | Yes — tone/voice context, same weight class as Step 8 (§2.5 of `phase6-requirements.md`) | Copy needs to hit "care not clout" voice; the map is the one artifact carrying felt-experience language, not just structural summary |
| Confirmed subtopics (titles/descriptions, full list) | `subtopics` | Yes | The literal "what's inside" bullet list several platforms' descriptions need (Etsy/Gumroad/StanStore/Whop conventionally list contents) |
| **Confirmed content bodies** | `subtopic_contents.body` (Step 8) | **Yes — the load-bearing input for specificity, see §2.1–§2.3** | The actual mechanism that prevents generic, swappable-into-any-niche listing copy |
| Approved cover | `cover_designs` / `cover_generations` (Step 9) | **Partial — style/mood metadata only, not pixels, see §2.5** | Thematic consistency without requiring a vision-capable model |
| Demand/competition signals | `title_candidates` | No | Same exclusion reasoning as Step 8 §6.1 — already acted on upstream, adds no new signal at the copy-writing stage |
| Lead magnet decision | `lead_magnet_recommendations` | No | Same reasoning as Steps 6–8 — separate product, unscoped here |
| Arman's own source material | — | No | Never an input anywhere in this pipeline |

### 2.1 Does copy need full content bodies, or just subtopic titles?

Worked through explicitly, because titles/descriptions alone are cheap and tempting, but insufficient:

- **Titles/descriptions alone are compressed and structural** ("Module 3: Understanding Cortisol") — exactly the kind of input that produces *plausible-sounding but swappable* listing copy ("Learn everything you need to know about cortisol and stress!"). This is precisely the Anti-Slop niche-specificity failure mode the product spec names in §4: "fails if a sentence could paste unchanged into any other niche's product."
- **The actual subtopic content bodies are the only artifact in the whole pipeline holding concrete, niche-specific detail** — the real frameworks, named categories, specific exercises, or reference points the product actually contains. A listing that says "includes a 7-day trigger-food elimination tracker with 4 symptom-severity categories" (a real detail pulled from body content) is categorically harder to fake than "a comprehensive tracker to help you feel your best."
- **Confirmed (decision 1, §10): Step 10 reads the full confirmed `subtopic_contents.body` text for every subtopic in the project**, not just titles, as input to the writer pass — approved as the working default, with correctness against a real deep-tier document's context-window budget to be verified live during build rather than decided further here. This is a genuine cost/complexity tradeoff, flagged explicitly:

| Option | What it means | Tradeoff |
|---|---|---|
| Titles/descriptions only | Cheap, small prompt | Fails the specificity bar (§2.1's core finding) |
| **Full body text for all subtopics (confirmed default, decision 1, §10)** | Prompt includes the entire confirmed document (up to ~30k words for a 15-chapter `deep` ebook, per Step 8's own word-count table) | Free on Groq (no per-token dollar cost, unlike Step 9's paid image calls), but **real, untested risk**: whether `openai/gpt-oss-120b`'s served context window can actually hold a full deep-tier ebook plus prompt scaffolding plus six platforms' worth of instructions without truncation or degraded attention to the parts that matter most. **Not verified in this document — to be verified live during build, §10 decision 1** |
| A pre-summarized "concrete details digest" (a new, separate extraction pass per subtopic) | Bounded prompt size regardless of document length | Adds a whole new AI-call stage (cost in Groq call volume, not dollars) and a new failure surface (the digest itself could be generic) — **not recommended as a v1 default**, but the fallback worth building if the full-body approach hits real context-window trouble in testing |

**Confirmed as the default (decision 1), with the digest approach as the documented fallback if live testing during build shows context-window strain** — not silently assuming the full-body approach "just works" at every document length.

### 2.2 Sibling-platform awareness

Each platform's copy is generated independently (§4.1), but the writer prompt for every platform includes the *other* platforms' current confirmed/draft text as light context, purely so a StanStore description and a Gumroad description don't read as word-for-word identical — same "helps avoid literal repetition, not a duplicate-avoidance guardrail" posture Step 8 gave sibling subtopic titles (§6.1 of `phase6-requirements.md`).

### 2.3 Compliance pass needs body content too, not just for tone

§6 works through this in full, but noting here: the compliance/specificity review pass for copy should have access to what the product's own content actually supports, so it can catch a listing over-promising something the real content doesn't substantiate — not just catching absolutist keywords in isolation.

### 2.4 Delivery mode language

`format_recommendations.confirmed_delivery_mode` (fillable vs. printable) is a safe, already-locked signal to reference directly ("fillable PDF tracker," "printable workbook"). This is different from — and should not be confused with — Step 11's eventual file-*container* decision (PDF vs. Notion vs. Docx vs. ebook), which does not exist yet at this point in the pipeline. See §2.6.

### 2.5 Does copy need to *see* the cover?

**No — and this is worth stating plainly rather than assuming either way.** Groq is text-only; feeding it the cover would require either (a) a separate vision-capable call (a real new connector dependency this document explicitly avoids introducing without cause) or (b) a human-written text description of the image (adds a manual step this phase should not require). Instead: **Step 10 reads `cover_designs.confirmed_look_id` (the code-registry look key, e.g. `'editorial-serif-01'`) and its associated mood/style descriptor as light textual context** — enough to keep a Pinterest pin caption or Instagram caption thematically consistent with "the cover reads as editorial and serif-driven" without needing pixel awareness. `getSignedCoverUrl` remains relevant only for the **UI**, so a human reviewing generated copy can see the cover alongside it — not for the AI call itself.

### 2.6 A real sequencing gap, surfaced rather than resolved

**Step 10 runs before Step 11 (Export) decides the actual output file format.** Step 4 already locks fillable-vs-printable (safe to reference, §2.4), but the specific *container* — will this ship as a PDF? A Notion template? A Docx? — is Step 11's decision, made *after* this phase. If copy commits to specific container language ("instant PDF download," "duplicate this Notion template") before Export has decided, that language could be wrong by the time Step 11 runs. **Confirmed (decision 8, §10): accepted as-is, no extra machinery.** Copy is not made a staleness-dependent of a future Export decision — Step 4's fillable/printable signal already covers the load-bearing claim, and this gap is judged low-stakes enough not to warrant its own guardrail.

---

## 2. Platform Format Research

Researched 2026-08-26 via WebSearch/WebFetch against current, dated sources. Confidence explicitly graded per platform — **do not treat any of this as permanently pinned**; the same "re-verify, don't assume" posture `phase7-requirements.md` §3.2 established for Nano Banana 2 applies here, arguably more so, since none of these are the kind of connector this team can smoke-test with a real API key the way Groq/Gemini were.

### 2.1 Etsy — CONFIRMED, high confidence, multi-source consistent

| Field | Limit | Confidence |
|---|---|---|
| Listing title | **140 characters max**; only the first ~40–50 characters reliably display in search results before truncation | Confirmed — consistent across [Outfy](https://www.outfy.com/blog/etsy-character-limit/), [ListingForge](https://www.listing-forge.com/blog/etsy-character-limits), [TypeCount](https://typecount.com/blog/etsy-character-limit), [ShopFoundry](https://www.shopfoundry.app/etsy-listing-limits), [EtsyEdge](https://etsyedge.app/blog/etsy-title-character-limit.html) — this is a long-standing, stable Etsy platform limit, not a recent/volatile one |
| Tags | **13 tags max, 20 characters max per tag** (multi-word phrases count as one tag) | Confirmed, same source set |
| Description | No hard character limit found; effectively long-form. Best practice: front-load value in the first ~160 characters (search-snippet visibility) | Best-available guidance, not a hard platform limit |
| Digital-download specifics | "Instant Download" attribute exists; up to 5 files per listing, 20MB each (larger files require external hosting linked inside a delivered PDF); delivery is fully automated — Etsy emails a secure download link + makes it available under the buyer's "Purchases and Reviews" the moment payment clears | Confirmed via [help.etsy.com-derived guidance](https://help.etsy.com/hc/en-us/articles/115015628347-How-to-Manage-Your-Digital-Listings) surfaced through search (direct fetch of help.etsy.com returned HTTP 403 — could not pull the primary source page directly) |

**Caveat:** Etsy's own help center blocked direct fetch (403). Every number above is aggregator-confirmed (multiple independent seller-tool sites agreeing), not pulled live from Etsy's own page — high confidence given consistency, but **Arman should spot-check the 140-char title / 13-tag limits against his own Etsy listing draft screen** before this ships, since he already has a real Etsy seller account.

### 2.2 Gumroad — PARTIALLY confirmed; Markdown claim NOT confirmed as literal

| Field | Limit | Confidence |
|---|---|---|
| Title | No character limit found in any source, official or aggregator | Best-available guidance: no limit found, not confirmed to be truly unlimited |
| Description | No character limit found. Gumroad's own [Help Center](https://help.gumroad.com/article/101-designing-your-product-page) confirms a rich-text editor: bold/italic, lists, quotes, code blocks, embedded videos/media, buttons, links | Confirmed — rich text formatting exists |
| **"Fairly free-form Markdown" (spec's own framing)** | **Not confirmed as literal Markdown syntax.** What's confirmed is a WYSIWYG rich-text *toolbar* (buttons for bold/lists/quotes/etc.) — nothing in the sources found confirms that typing raw Markdown syntax (`**bold**`, `# heading`) is parsed by Gumroad's editor, versus requiring the toolbar UI itself | **Deferred (decision 6, §10) — Arman is checking his own Gumroad dashboard.** Until confirmed, generation defaults to producing clean, readable plain-text/light-structure copy (short paragraphs, line breaks, simple bullet-style lines) that reads well regardless of whether literal Markdown syntax renders. Does not block DEV work on the rest of the phase |

### 2.3 StanStore — LOW confidence, thin documentation, explicitly flagged

| Field | Limit | Confidence |
|---|---|---|
| Fields that exist | Title, subtitle, button text (defaults to "Download now," customizable), description, plus product image (1920×1080 recommended for hero, ~400×400 for a square/callout thumbnail) | Confirmed structurally via [Stan Store Help Center](https://help.stan.store/) and third-party StanStore setup guides |
| Character limits on any of the above | **None found anywhere.** No official documentation surfaced a title/subtitle/description character limit | **Deferred (decision 5, §10) — no fabricated number is asserted here.** StanStore is a newer, smaller platform with materially thinner public documentation than Etsy/Gumroad. Arman is checking real field behavior (does the title field silently truncate? does it accept long descriptions?) against his own Stan Store account. Until real numbers arrive, StanStore stays soft-guidance-only — decision 4's hard-limit blocking is **not** applied here. Does not block DEV work on the rest of the phase |

### 2.4 Whop — LOW-MEDIUM confidence, thin documentation, explicitly flagged

| Field | Limit | Confidence |
|---|---|---|
| Fields that exist | Product name, headline, description, banner image, category — all listed as required fields to get a listing onto the marketplace | Confirmed structurally via [Whop's listing & sales creator policy](https://help.whop.com/en/articles/10412694-listing-sales-creator-policy) and setup guides |
| Character limits | **None found anywhere** in the sources surfaced | **Deferred (decision 5, §10), same treatment as StanStore** — soft-guidance-only until Arman checks his own Whop creator dashboard; decision 4's hard-limit blocking is **not** applied here in the meantime. Worth noting for context, not as a build requirement: Whop's own product UI already ships a native "Generate with AI" button for title/headline/description — a real competitive-landscape data point (PROTO's differentiation here has to be quality/specificity, not novelty of "AI writes your listing") |

### 2.5 Pinterest — CONFIRMED hard limits, MEDIUM-HIGH confidence overall

| Field | Hard limit | Best-practice guidance | Confidence |
|---|---|---|---|
| Pin title | **100 characters max** | 40–60 characters recommended (avoids feed truncation, front-loads keywords) | Confirmed — consistent across 7+ independent sources ([SocialRails](https://socialrails.com/blog/pinterest-character-limits-guide), [BulkPublish](https://bulkpublish.com/blog/pinterest-character-limit), [LetterCounter](https://lettercounter.org/blog/pinterest-character-limit-guide/), others) |
| Pin description | **500 characters max** | Front-load keywords in the first ~50–60 characters (truncation point); viral pins average 220–232 characters — shorter, focused descriptions often outperform max-length ones | Confirmed limit; best-practice figures are aggregated marketing-analytics claims, not Pinterest's own published data — treat the *limit* as solid, the *220–232 average* as directional only |

Not pulled directly from Pinterest's own developer documentation (search-aggregated only) — high confidence given consistency across many independent sources, but a quick official-doc spot-check before launch is still the more rigorous path.

### 2.6 Instagram — CONFIRMED hard limit, MEDIUM-HIGH confidence on best-practice figures

| Field | Hard limit | Best-practice guidance | Confidence |
|---|---|---|---|
| Caption | **2,200 characters max** (well-established, stable platform mechanic) | Feed captions truncate at **~125 characters** before a "…more" cutoff — the real effective limit for what a reader sees without tapping. Engagement research (aggregated, not Meta's own data) suggests 1–50 chars gets the highest raw engagement rate; 125–300 is a solid general range; 300–800 is described as a "sweet spot" by one source; 2,000+ only works for long-form educational posts and tends to underperform for promotional copy | Hard limit and the ~125-char truncation point: **high confidence**, both are stable, widely-corroborated platform mechanics. The specific engagement-length breakdowns: **medium confidence** — aggregated marketing-blog claims, not Meta's own published analytics, treat as directional guidance |

### 2.7 Summary table — what generation must hard-enforce vs. softly aim for

| Platform | Field | Hard ceiling (must never exceed) | Soft target (aim for, non-blocking) |
|---|---|---|---|
| Etsy | Title | 140 chars | ≤50 chars for guaranteed non-truncated search display |
| Etsy | Tags | 13 tags, 20 chars each | n/a — the cap is the target |
| Gumroad | Title / Description | None confirmed | Clean, scannable, short-paragraph structure |
| StanStore | Title / Subtitle / Description | **Unknown — deferred, decision 5** | n/a until Arman confirms; not hard-enforced meanwhile |
| Whop | Name / Headline / Description | **Unknown — deferred, decision 5** | n/a until Arman confirms; not hard-enforced meanwhile |
| Pinterest | Title | 100 chars | 40–60 chars |
| Pinterest | Description | 500 chars | ~220–260 chars |
| Instagram | Caption | 2,200 chars | Strong hook in first ~125 chars; total length 125–800 depending on tone |

---

## 3. Generation Approach

### 3.1 Call shape — independent per-platform generation, writer + review pass (Step 8's exact pattern, reapplied)

**Six independent generation targets, each with its own writer pass + review pass** — same two-call structure Step 8 locked in (`phase6-requirements.md` §3.1) for the same reason: a single call trying to write well *and* self-police length/compliance/specificity simultaneously risks instruction drift on the highest-stakes objective. No shared "generate all six in one call" mode — there's no cross-platform namespace problem requiring joint reasoning (direct parallel to Step 8's own conclusion in §6.3 that regenerate-one needs no duplicate-avoidance guardrail).

- **Writer pass**: given title, format/delivery mode, transformation-map tone context, full subtopic list + content bodies (§2.1), sibling-platform drafts (§2.2), cover look/mood (§2.5), and *this specific platform's* hard/soft length targets (§2.7) — produces a first-draft set of fields for that platform (e.g., for Etsy: `{title, description, tags[]}`).
- **Review pass**: reads the draft, performs (a) the marketing-specific anti-slop/specificity check (§5), (b) the compliance/claims check carried over from Step 8 (§6), and (c) a **deterministic hard-limit check** unique to this phase (§4) — returns a structured response with any rewritten spans plus a specificity score, mirroring Step 8's `content_generations.output_snapshot` / `content_compliance_changes` pattern exactly.

**Twelve Groq calls per full-project generation (6 platforms × 2 passes)** — more than Step 9's single-image-per-attempt cost profile, less than Step 8's worst case (up to 30 for a 15-item ebook). Free on Groq, so the constraint is call-volume/blast-radius, not dollars — same category of concern that made Step 8 break auto-fire precedent (§4.2 works through whether Step 10 should too).

### 3.2 Regeneration is per-platform, not all-or-nothing

Each of the six platform rows can be regenerated independently (`trigger_scope='regenerate_one'`), or the whole batch can be regenerated together (`trigger_scope='regenerate_all'`, looping the same per-platform call pair) — direct structural parallel to Step 8 §1.8's regenerate-one/regenerate-all pair, applied to platforms instead of subtopics.

### 3.3 Generation trigger — confirmed explicit, not auto-fire

Step 8 broke the Steps 2–7 auto-fire precedent specifically because of call-volume blast radius on a free connector (§8 of `phase6-requirements.md`). Step 10's 12-call minimum is smaller than Step 8's worst case but is still a real jump above every phase before Step 8. **Confirmed (decision 2, §10): the same treatment — no auto-fire on reaching `cover_approved`, an explicit "Generate Copy" action required.**

---

## 4. Guardrail Layer — What's New Here vs. Every Prior Text Phase

Step 8 established the "AI judgment + deterministic backstop" pattern for both compliance and specificity. Step 10 reuses that pattern for the same two failure modes (§5, §6) but adds one genuinely new guardrail category no prior phase needed: **hard, external, platform-imposed limits that aren't quality judgments at all — they're pass/fail submission constraints.**

| # | Rule | Deterministic? | On failure |
|---|---|---|---|
| 1 | Each field's character/count is within its platform's **hard** ceiling (§2.7) — e.g., Etsy title ≤140 chars, ≤13 tags each ≤20 chars; Pinterest title ≤100/description ≤500; Instagram caption ≤2,200 (Etsy/Pinterest/Instagram only — StanStore/Whop have no confirmed ceiling to check against, decision 5) | Yes — exact character/count check, code-level, no AI judgment involved | Reject/retry once with the exact overage named. **If still over after retry: confirmed as blocking that platform's confirm action specifically — see §4.1, decision 4, a genuine deviation from every prior phase's soft-accept posture** |
| 2 | Marketing-slop deterministic blocklist scan (§5.1) | Yes | Reject/retry once on 3+ hits (heuristic threshold, same starting point as Step 8's blocklist gate); if still failing, non-blocking `quality_flag='below_specificity_threshold'` |
| 3 | Absolutist-claim keyword scan, reused from Step 8's FTC-grounded list (§6.2) | Yes (backstop layer) | Force-flags a `copy_compliance_changes` row; triggers one review-pass retry naming the missed phrase — same as Step 8 |
| 4 | Every `copy_compliance_changes.original_text` is a real substring of the draft | Yes | Drop the fabricated record, same "never fabricate" posture as every guardrail in this codebase |
| 5 | Niche-specificity score ≥7/10 (AI judgment, checks the copy against real subtopic-content specifics, §2.1/§2.3) | No — AI judgment only, same honesty as Step 8 §4.1 | Reject/retry once; still-failing → non-blocking flag |

### 4.1 Why hard-limit failures deserve an actual block, not just a flag — confirmed

Every prior soft-guardrail in this codebase (length tolerance, specificity threshold, AI-slop blocklist) accepts-as-is with a non-blocking flag after one retry, because the underlying judgment is fuzzy or the "failure" is still usable content. **A title that's 160 characters when Etsy hard-caps at 140 is different in kind: it is not a quality judgment, it is a fact about whether the text can even be submitted to the destination platform.** Publishing an over-limit title isn't "lower quality" — Etsy will not accept it. **Confirmed (decision 4, §10): exceeding a hard platform limit blocks that specific platform's `confirm` action** (the other five platforms remain confirmable independently) until the field is fixed by regeneration or manual edit — a narrower, more targeted version of Step 9's precedent-breaking move to hard caps (§4.2 of `phase7-requirements.md`) where real external stakes justified deviating from the soft-flag-only norm. This is the first time this codebase blocks a confirm action on anything other than a structural existence check (Step 9's only hard block was "a cover image must exist"). Applies to Etsy, Pinterest, and Instagram now; StanStore and Whop have no enforced ceiling until decision 5 resolves.

---

## 5. Anti-Slop for Marketing Copy — A Different Failure Mode Than Instructional Content

The product spec's Anti-Slop content rule ("no genericness... fails if a sentence could paste unchanged into any other niche's product") was written with Step 8's instructional prose in mind. Applied to sales copy, the *symptom* looks different even though the underlying principle is identical:

| Failure mode | Example | Mechanism |
|---|---|---|
| **Instructional-writing AI tells** (Step 8's existing blocklist: "delve," "tapestry," "crucial," "leverage," "seamless," etc.) | Rare in short marketing copy, but still worth scanning for | Reuse Step 8's existing blocklist as a baseline layer |
| **Marketing-specific slop** — generic superlatives and templated sales constructions that could sell literally any product | "Perfect for busy professionals!", "This isn't just a tracker, it's a lifestyle," "Say goodbye to [problem] forever," "Unlock your potential," "Game-changer," "Level up your [X]," "Imagine a world where...", excessive exclamation points | **New, separate deterministic blocklist, marketing-copy specific** — a different phrase list than Step 8's, because the failure register is different (templated sales language vs. templated explainer-prose language) |
| **Swappable niche-genericness** — could this exact sentence sell a completely different niche's product with a word swapped? | "A comprehensive guide to help you feel your best" (could describe literally anything) vs. "A 6-category cortisol-symptom tracker built around the same morning/evening logging structure used in the actual product" (references a real, specific detail) | AI-judgment only, `specificity_score` (§4, rule 5) — same honesty as Step 8: no keyword list can catch this, only judgment informed by the real content bodies (§2.1) can |

**Confirmed (decision 10, §10): two separate deterministic blocklists (Step 8's existing instructional-tell list, reused as a baseline layer, plus a new marketing-slop-specific list), feeding the same reject-retry-then-flag mechanism already established.** The marketing-slop list above is approved as a starting heuristic seed, not a researched-and-final set (mirrors how Step 8 itself treated 3 of its 4 word-count table cells) — flagged for a tuning pass once real generated copy exists to check it against, rather than a dedicated research pass now.

---

## 6. Compliance/Tone Carryover — Explicit Treatment, Not a Silent Assumption

**The question stated directly: can a store listing claim "cures your anxiety" even if the underlying product content itself was written cautiously?**

**Answer: No — confirmed (decision 7, §10). Step 8's exact compliance mechanism extends to every platform-copy generation, and if anything the case for doing so is stronger here, not weaker.**

### 6.1 Why this is not automatically covered by Step 8's existing pass

Step 8's compliance pass already reviewed and rewrote the *body* content for absolutist/unsupported health claims (`content_compliance_changes`, `phase6-requirements.md` §3). But Step 10 generates **brand-new prose** — a listing title, a Pinterest description, an Instagram caption — none of which is verbatim body text. A compliance pass having already cleaned up Chapter 3's language does nothing to stop a freshly-generated Etsy description from independently writing "clinically proven to eliminate anxiety" in its own new sentence. **Step 10 needs its own compliance pass; Step 8's does not carry forward "for free."**

### 6.2 Why the stakes are arguably higher here, not lower

The FTC health-claims guidance Step 8 grounded its keyword backstop in (`phase6-requirements.md` §3.2, decision 7) is guidance about **advertising and marketing claims specifically** — a store listing and a social caption are the most literal, direct expression of "advertising claim" this entire pipeline produces. If anything, this is the surface where that guidance is most squarely on-point, more so than educational chapter prose.

### 6.3 Recommendation, concretely

- **Reuse the exact same two-layer mechanism**: AI-judgment review pass looking for unsupported/absolute claims, diagnostic-implying language, missing cautious framing — backstopped by the same deterministic absolutist-keyword scan Step 8 built (`cures`, `guaranteed`, `eliminates`, `treats [condition]`, `100% effective`, `clinically proven to`, etc.), reused verbatim rather than reinvented.
- **Run it niche-agnostically, on every project's copy, regardless of niche** — same reasoning as Step 8 decision 21: no niche-classification field exists anywhere in this pipeline, and the cost asymmetry (one extra Groq call vs. a real liability/false-negative gap) favors running it universally.
- **A genuinely new check worth adding here, beyond keyword-matching**: an "over-promise" check — does this copy claim something the product's *actual confirmed content* doesn't substantiate? This is only possible because Step 10 (uniquely among copy-generating passes) has direct read access to the real content bodies (§2.1). This is AI-judgment-only (no deterministic version is possible), proposed as an extension to the existing `specificity_score`/review-pass output, not a new call.
- **Arman's decision-19 standing commitment** (from `phase6-requirements.md`: manually reviewing gut-health-adjacent content before publishing, since no independent fact-check layer exists) **is confirmed (decision 7, §10) to explicitly extend to cover Step 10's output too**, not silently assumed to already apply.

---

## 7. Action Model

| Action | What happens | Which table(s) change |
|---|---|---|
| **Explicit Generate Copy** (available once `cover_approved`; confirmed no auto-fire, §3.3, decision 2) | Inserts `copywriting_builds` (`status='draft'`). For each of the 6 fixed platforms: fires the writer + review call pair (§3.1, `trigger_scope='initial'`), inserts one `copy_generations` row and one `platform_copies` row. `projects.status` → `copy_generating` | All, insert |
| **Manual edit** (`copywriting_builds.status='draft'` only) | Direct update to a `platform_copies` row's fields. Recomputes char/word counts and hard-limit status. Sets `is_edited=true`, `compliance_reviewed=false` — same semantics as Step 8's `subtopic_contents` edit behavior | `platform_copies` only |
| **Regenerate one platform** (`draft` only) | If `is_edited=true`, requires the same explicit-acknowledgment gate every prior phase uses before overwriting hand-curated work. Fires the writer+review pair scoped to that platform (`trigger_scope='regenerate_one'`) | `copy_generations`, `platform_copies` |
| **Regenerate all platforms** (`draft` only) | Same acknowledgment gate if any row is edited. Loops the per-platform call pair across all 6 (`trigger_scope='regenerate_all'`). Soft cap: 5 whole-batch regenerations, consistent with every prior phase's number | `copy_generations`, `platform_copies` (all rows), `copywriting_builds.regenerate_count`+1 |
| **Confirm** (`draft` only; confirmed: **one document-level confirm**, see §7.1) | Sets `copywriting_builds.status='confirmed'`, `confirmed_at`/`confirmed_by`. `projects.status` → `copy_confirmed` (confirmed name, §9.4/§10). **Blocked if any platform's field is currently over its hard limit** (§4.1) — the one genuinely new blocking condition in this phase | `copywriting_builds` only |
| **Unlock / "Edit Copy"** (from `copy_confirmed`) | Reverts `copywriting_builds.status` to `draft`, `projects.status` to `copy_generating`. Content preserved, same precedent as every prior unlock | `copywriting_builds` only |
| **Upstream title/format/map/content/cover-look change** | Soft staleness flag only, §8 | None (UI-level flag) |

### 7.1 Confirm granularity — confirmed document-level

**Confirmed (decision 3, §10): one document-level "Confirm All Copy" action, gating all six rows together** — mirrors the single-header-confirm shape every prior phase (`content_builds`, `cover_designs`) already uses, and avoids inventing a sixth independent lock-state machine for a phase whose outputs are typically consumed together (moving on to Export). The genuine alternative (independent per-platform confirm, matching that Arman might list on Etsy today and not touch Whop for weeks) was considered and not taken.

---

## 8. Staleness Dependencies

### 8.1 Does copy depend on each upstream artifact?

| Dependency | Depends? | Why |
|---|---|---|
| Title | Yes | Baseline, every phase |
| Format + delivery mode | Yes | Drives value-prop framing and delivery-mode language (§2.4) |
| Transformation map | Yes — tone context, same weight as Step 8 | Voice consistency |
| Confirmed subtopics list | Yes | "What's inside" bullet content directly reflects this |
| **Confirmed content bodies** | **Yes — the strongest dependency in this phase, given §2.1's finding that specificity is pulled directly from body text** | If body content changes materially after copy was generated against it, the copy's specific claims may reference details that no longer exist in the product |
| Cover look | **Yes, but narrowly** — only the registered `look_id` changing (a genuinely different template/mood), not every regenerate/style-edit that keeps the same `look_id` | Avoids over-warning on cosmetic cover iterations that don't change the thematic signal copy actually consumed (§2.5) |

### 8.2 Soft, following the established precedent — and the argument is strong here too

Same "expensive-to-lose hand-curation" reasoning every phase since Step 6 has used, applied here: copy that's been generated, compliance-reviewed, and possibly hand-edited across six platforms represents real effort worth protecting from a forced redo on a minor upstream nudge. **All dependencies below are soft.**

### 8.3 Detection and effect

| Dependency | Detection | Effect |
|---|---|---|
| Title / format / map (document-level) | FK/timestamp snapshot comparison on `copywriting_builds`, same technique every phase since Step 5 uses | If `copy_confirmed`: reverts to `copy_generating`. Stored copy untouched |
| Content bodies | Timestamp comparison: `copywriting_builds.content_build_confirmed_at` vs. live `content_builds.confirmed_at`, falling back to `content_builds.updated_at` when currently unconfirmed — **direct reuse of the exact fallback Step 8 and Step 9 both already established for depending on a possibly-unlocked upstream document** | Same as above |
| Cover look | Text equality: `copywriting_builds.cover_look_snapshot` vs. live `cover_designs.confirmed_look_id` | Same as above, narrower trigger condition (§8.1) |

**Precedence when multiple are stale: title > format > content bodies > cover look** — continuing the exact ordering convention established since Step 5.

---

## 9. Data Shape Proposal (reasoning level, not SQL)

### 9.1 Three tables plus one child log — same shape family as Step 8, adapted for heterogeneous fields

| Table | Cardinality | Role |
|---|---|---|
| `copywriting_builds` | 1:1 per project | Header — status, lock state, staleness snapshots (title/format/map/content/cover-look), whole-batch regenerate count |
| `platform_copies` | Up to 6 per project (1 per `copy_platform` enum value) | Live, editable row per platform |
| `copy_generations` | Many per `platform_copies` row (one per attempt) | Append-only audit log |
| `copy_compliance_changes` | Many per `copy_generations` row (0..N) | Span-level "Original → Rewritten, reason" log, same granularity/reasoning as Step 8's `content_compliance_changes` (§5 of `phase6-requirements.md`) — **not reused directly** (a new, parallel table, since the parent relationship differs) |

### 9.2 The heterogeneous-fields problem (§0.3) — recommended resolution

Since Etsy needs a tag array and StanStore needs a subtitle and Instagram needs neither, a single fixed set of typed columns doesn't cleanly fit all six platforms. **Recommendation: hybrid — typed columns for the two near-universal concepts every platform has *some* version of (`title` nullable, `body` — the primary long-form field, e.g. description or caption), plus a `platform_fields jsonb` column for the rest** (Etsy's `tags[]`, StanStore's `subtitle`/`button_text`, Whop's `headline`, optional hashtag lists for Pinterest/Instagram if §9's hashtag question resolves in favor of generating them).

| Option | Tradeoff |
<br>
| **Hybrid: typed `title`/`body` + jsonb `platform_fields` (confirmed, decision 11, §10)** | Keeps the two fields every UI view needs (title-like, body-like) directly queryable/indexable, while not forcing a rigid schema onto genuinely different field sets. Validation of `platform_fields`' shape happens at the application layer against a **code-level per-platform schema registry** — direct parallel to Step 9's decision that the template registry lives in code, not the database (§7.5 of `phase7-requirements.md`), for the identical reason: these field definitions don't change per-project and shouldn't require a migration to update |
| Fully typed columns per platform (one big table with every possible field as its own nullable column) | Most queryable, but the table accumulates platform-specific columns (`etsy_tags`, `stanstore_subtitle`, `whop_headline`...) that are null for 5 of every 6 rows — a real schema smell, and adding a 7th platform later means a migration touching this table directly |
| Fully normalized field-level table (one row per project × platform × field) | Cleanest in the abstract, but meaningfully more rows/joins for a phase whose actual field count per platform is small (1–3) — likely over-engineered for the real cardinality here |

### 9.3 Enum reuse — deliberate, not automatic

| New enum | Values | Reasoning |
|---|---|---|
| `copy_platform` | `etsy`, `gumroad`, `stanstore`, `whop`, `pinterest`, `instagram` | New — the fixed set driving §0.2's shape |
| `copy_trigger_scope` | `initial`, `regenerate_one`, `regenerate_all` | New — no `new_subtopic_backfill`-equivalent value needed, since the platform set is fixed, not a mutable upstream table (§0.2) |
| `copy_generation_status` | `succeeded`, `succeeded_outside_soft_target`, `failed_hard_limit_exceeded`, `failed_fallback`, `failed_blocked` | New, 5-value — one more than Step 8's 4-value set, because §4.1's hard-limit failure is a genuinely distinct outcome no prior text phase had (an image had no length-miss-equivalent either, per Step 9's own 3-value set — this phase needs *more* granularity than either precedent, not less) |
| `copy_hard_limit_status` | `within_limit`, `exceeds_limit` | New — persisted directly on `platform_copies` so the UI/confirm-check doesn't need to query the log to know if a row is currently blockable (§4.1, §7) |

| Reused enum | From | Justification |
|---|---|---|
| `content_status` (`generated`/`manual`/`failed_empty`) | Step 8 | Identical semantic set, identical failure shape — unlike Step 8's own deliberate non-reuse of `subtopic_source` (where the failure states genuinely differed), here they're the same concept applied to a different row type |
| `content_quality_flag` (`clean`/`below_specificity_threshold`) | Step 8 | Identical concept |
| `content_compliance_status` (`no_changes_needed`/`changes_applied`/`review_pass_failed`) | Step 8 | Identical concept |
| `content_risk_category`, `content_change_detector` | Step 8 | Identical taxonomy applies equally well to copy as to instructional prose |
| `transformation_map_status` (`draft`/`confirmed`) | Phase 3/5/6/7 | Same reuse convention continued |

### 9.4 `projects.status` extension — confirmed (decision 12, §10)

| Status | Meaning |
|---|---|
| `cover_approved` | (existing) Step 9 done, Step 10 not yet started |
| `copy_generating` | **Confirmed new.** Step 10 in progress |
| `copy_confirmed` | **Confirmed new.** Terminal state for this phase, feeds Step 11 |

---

## 10. Decisions Locked (2026-08-26)

| # | Decision |
|---|---|
| 1 | **Full body-text-as-input approach: approved as the default.** Step 10 reads the full confirmed `subtopic_contents.body` text for every subtopic, not just titles, as input to the writer pass. Genuinely untested at scale — correctness against a real deep-tier document's context-window budget will be verified live during build, the same "verify live, don't trust research" posture every AI-facing increment in this codebase already follows. A digest/summarization fallback remains the documented contingency if the live test shows truncation. §2.1. |
| 2 | **Generation trigger: explicit "Generate Copy" action, no auto-fire** — confirmed, matching Step 8's blast-radius precedent. §3.3. |
| 3 | **Confirm granularity: one document-level "Confirm All Copy"** action, not six independently-confirmable platform rows. §7.1. |
| 4 | **Hard-limit blocking: confirmed as blocking.** Exceeding a platform's hard character/tag limit blocks that platform's confirm — a fact about submission compatibility, not a quality judgment call, so the soft-flag-only precedent used everywhere else does not apply here. Applies to Etsy, Pinterest, Instagram now. §4.1. |
| 5 | **StanStore/Whop field limits: deferred.** No hard limits are asserted or enforced for either platform until Arman verifies real account behavior. Decision 4's hard-limit blocking does **not** apply to these two platforms meanwhile — they stay soft-guidance-only. Does not block DEV work on the other four platforms or the rest of the phase. §2.3, §2.4. |
| 6 | **Gumroad Markdown: deferred.** The writer prompt defaults to clean plain-text/simple-structure copy (no reliance on literal Markdown syntax) until Arman confirms whether Gumroad's editor actually parses raw Markdown. Does not block DEV work. §2.2. |
| 7 | **Compliance-pass extension: confirmed.** Arman's existing decision-19 health-content manual-review commitment (`phase6-requirements.md`) explicitly extends to cover Step 10's generated copy too, same standard as Step 8's content. §6.3. |
| 8 | **Export sequencing gap: accepted as-is, no extra machinery.** Step 4's fillable/printable signal already covers the load-bearing claim; copy is not made a staleness-dependent of a future Export decision. §2.6. |
| 9 | **Hashtag scope: out of scope for Step 10.** Hashtags are left to Arman's own judgment at publish time, not a generated sub-task. §0. |
| 10 | **Marketing-slop blocklist: approved as a starting heuristic list**, not independently researched to the depth Step 8's instructional-tell list was. Flagged for a tuning pass once real generated copy exists to check it against, same treatment Step 8 gave its own word-count table. §5. |
| 11 | **Data shape: hybrid typed-columns-plus-jsonb approved** for `platform_copies` (typed `title`/`body`, `platform_fields jsonb` for the rest). §9.2. |
| 12 | **`projects.status`: `copy_generating`/`copy_confirmed` approved as proposed.** §9.4. |

**Status: Decisions Locked (2026-08-26), with two explicit exceptions.** Items 5 and 6 are deferred pending Arman's own StanStore/Whop/Gumroad account verification — everything else is locked and DEV work can start now. Item 1 proceeds as the working default, verified live during build rather than decided further here.
