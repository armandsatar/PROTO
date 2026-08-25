# PROTO — Phase 7 Technical Requirements: Step 9 (Design)

**Scope:** Spec Step 9 only — the template-based layout/style system, AI-generated cover art (Nano Banana 2), and the required manual cover-approval gate. Consumes the confirmed title (Steps 1–3), confirmed format (Step 4), the transformation map (Step 6, for tone/niche context feeding style selection), the confirmed subtopics list (Step 7), and the confirmed content (Step 8 — word count / page-length signal feeds template selection). Does **not** cover Step 10 (Copywriting), Step 11 (Export — the actual PDF/Notion/Docx document assembly), Step 12 (Pricing), or the Bundle Engine. Those are future phases and are intentionally absent from this document.

**Connector correction, flagged explicitly (same treatment as `phase1-requirements.md` decision 16 and `phase6-requirements.md`'s Groq-vs-Claude callout):** spec §5 names "Nano Banana 2 (Google Gemini image model)" as the connector for cover generation, at "~$0.02/image." "Nano Banana" is actually a **family of three tiers**, not one model — Lite, standard ("Nano Banana 2"), and Pro — each a genuinely different API model with different pricing (§3.1/§4.1). This document targets the **standard "Nano Banana 2" tier specifically, API model `gemini-3.1-flash-image`** — the tier the product spec's own naming literally refers to, not a blend across tiers.

**Live connector verification: DONE (2026-08-25), against a real key and a real billable call — §3.2 has the full findings.** Unlike every prior research-only claim in this document, the model name, the request/response shape, and the real per-call cost are now confirmed live, not just researched. Two things the live call corrected vs. what was researched/documented: (1) the response format only accepts `image/jpeg`, not `image/png` as shown in Google's own documented examples; (2) the response **does** include a real `usage` field with token counts (earlier research said no cost metadata was exposed — wrong), and the real measured cost for one 1K image (**$0.0891**) ran **~33% higher** than the $0.067 flat per-image rate this document had been citing — see §4.1 for why.

**Status: Decisions Locked (2026-08-25).** All 19 items in §9 confirmed by Arman, including a real live connector verification against a funded Gemini API key (§3.2) — the first phase whose most consequential technical claims (model, response shape, real per-call cost) are live-confirmed rather than research-only estimates. DEV work starts now.

---

## 0. Shape Determination

### 0.1 Do any of the four established shapes fit?

| Shape | Precedent phase(s) | Defining property | Does Step 9 match? |
|---|---|---|---|
| **Recommend/confirm** | Phase 2/3 (Steps 4–5: format recommendation, lead magnet) | AI proposes one value from a small enumerated set with a stated reason; user accepts or overrides; no iteration loop, no binary artifact | **Partially.** The *style/template pick* genuinely fits this shape (§2.3). But nothing in Phase 2/3 ever produced a rendered binary artifact or needed a human-taste approval gate — this shape covers only half of what Step 9 needs |
| **Single editable record + log** | Phase 4 (Step 6: transformation map) | One project-level record, freely re-editable text fields, append-only generation log behind it | **No.** The "record" in Step 9 (the cover) isn't a text field a user rewrites — it's a binary image, replaced wholesale by a new candidate, not edited in place the way prose is |
| **Live variable-length collection** | Phase 5 (Step 7: subtopics) | N self-managed rows, user adds/deletes/reorders | **No.** Step 9 produces at most one *live, current* cover at a time; there's no user-managed collection of arbitrary size |
| **Editable-content-per-row** | Phase 6 (Step 8: content builder) | N rows, N inherited from an upstream table, one live prose field per row, edited in place | **No.** Step 9's cardinality isn't inherited from an upstream N — there's exactly one product, one cover, one approval decision per project |

**None of the four fit.** Forcing Step 9 into any of them would either drop the iterative-edit/candidate-history requirement (recommend/confirm), pretend a binary asset behaves like an editable text field (single record), or invent a false N-collection where none exists (the other two).

### 0.2 The two genuinely new properties driving a fifth shape

1. **The artifact being produced is a binary asset (an image), not text.** Every prior phase's "content" was a string PROTO could inspect, diff, and guardrail (word count, keyword scan, substring checks). An image has none of that — PROTO cannot deterministically inspect "is this a good cover" the way it inspected "is this specific enough." This changes what a guardrail layer can even claim to do (§6).
2. **The approval gate is explicitly, deliberately non-automatable.** Every prior Quality Gate (Steps 2–8) was "handled entirely by PROTO, no manual review required." Step 9's gate is the spec's one named exception: "required manual approval... the one place Arman stays actively in the loop, since visual taste is inherently subjective." No prior phase's data model had to represent a human sign-off as the *terminal* state-transition condition — confirms in Steps 6–8 are convenience checkpoints on AI-generated-and-guardrailed content; Step 9's approval is the actual point of the phase.

**Conclusion: Step 9 is a fifth shape — "recommend/confirm for style parameters, feeding a candidate-artifact-plus-iterative-edit flow with a mandatory human approval gate."** It borrows recommend/confirm's shape for the *style profile* piece (§2.3) and borrows the append-only generation-log precedent for auditing every AI-art call (§7.3), but the candidate/edit/approve mechanics around the actual image are new — no prior phase needed "keep every previous candidate, let the user pick an older one, and require a human click before anything downstream can proceed."

---

## 1. Surface Area — Cover Only, Not Full Interior Layout (works through hard question 2)

### 1.1 The literal spec text says two different-sized things

- Narrow: *"cover must be approved by Arman before a product can move to 'Ready to Download.'"* — scoped explicitly to the cover.
- Broad: *"Template-based layout engine as the primary system... deliberate typography pairing, real hierarchy, considered whitespace. Each product gets its own distinct look."* — reads as describing the whole product's visual identity, not just one image.

### 1.2 Reading adopted, and why

**Step 9 owns deciding and recording the product's visual identity (a "look": template + palette + font pairing) at the whole-product level, and owns rendering and approving exactly one artifact from it — the cover. It does not render interior pages into a final document.** Reasoning:

- Step 11 (Export) is the phase whose literal job, per spec, is producing the actual output file: *"PROTO recommends output format (PDF / Notion / Docx / ebook)... Fillable PDF if the product requires user input... Static PDF if it's pure information."* Assembling N subtopics' worth of `subtopic_contents.body` (Step 8) into a real multi-page PDF/Notion doc, with per-page layout, is squarely Export's job description, not Design's. If Step 9 also rendered every interior page, Step 11 would have nothing structural left to do beyond a format-conversion pass — that reads as a scope collision the spec doesn't actually describe.
- The "each product gets its own distinct look" language is fully satisfied by Step 9 **deciding** the look (template/palette/font choice, persisted as structured data) even without physically laying out every interior page in *this* phase. The look decision is the input Export will need later to render interior pages consistently — Step 9 produces that input; a later, unscoped increment of Export consumes it.
- The approval-gate language is unambiguous and cover-specific, and it's the only concretely testable deliverable named in the spec for this step. Treating "each product's own distinct look" as requiring full interior rendering here would mean inventing a second, unstated deliverable (interior page rendering) that has no approval mechanism, no explicit spec language, and duplicates Export's stated job.

**Confirmed by Arman, 2026-08-25** — the spec text alone doesn't force this reading, but it's the reading that avoids inventing unscoped work and avoids duplicating Step 11, and Arman agreed.

### 1.3 What "in scope" concretely means under this reading

| In scope for Step 9 | Out of scope for Step 9 |
|---|---|
| Selecting/recommending one "look" (template + palette + font pairing) for the product, persisted as structured data | Rendering every interior page/chapter/tracker-category into the final document — Step 11's job |
| Generating AI art (Nano Banana 2) for the cover specifically | Generating AI art for interior hero images, section dividers, carousel art per spec's "carousel art" mention — spec names this under Nano Banana 2's general use cases, but no pipeline step besides Step 9 (cover) and possibly Step 10 (social promo formats) currently owns it; not claimed here |
| Rendering one real cover image artifact (not just parameters) | Rendering a full cover-to-back-matter print-ready file |
| The manual approval gate, scoped to the cover | Any approval mechanism for interior pages (none exists because none are rendered here) |

---

## 2. What "Template-Based Layout Engine" Means as a Buildable System (hard question 1)

### 2.1 The realistic range, evaluated against this project's actual stack

`package.json` (read directly) has **zero rendering/design libraries** — no `@vercel/og`, `satori`, `puppeteer`, `playwright`, `sharp`, `canvas`, `pdf-lib`, `@react-pdf/renderer`, nothing. Every dependency is Next.js/React/Supabase/Groq plumbing. This is a real gap that has to be filled with *something* if Step 9 renders any actual image — the question is how much.

| Option | What it means | Buildability against this stack | Recommendation |
|---|---|---|---|
| **Lightest** — parameters only | Persist `template_id`/palette/font-pairing choices as structured data; no pixel rendering happens in PROTO at all — a human (Arman) does final layout in an external tool | Trivial (no new dependency), but **fails the spec's own bar**: "cover must be approved" and "upload own image / AI-assist edit" all presuppose PROTO can actually show and manipulate a real image, not just a spec sheet | **Rejected as insufficient** — the approval gate literally cannot function without a real artifact to approve |
| **Middle** — real single-artifact rendering via an off-the-shelf compositor | A small library (4–8) of hand-built template *layouts* (JSX/CSS: title placement, hierarchy, whitespace, font-pairing baked in per template) rendered to a real PNG using an established HTML/CSS-to-image library, with the AI-generated art layered in as a background/hero image within that layout | **Realistic.** [Satori](https://github.com/vercel/satori) (the library underlying Vercel's own OG-image generation, `@vercel/og`) converts JSX+CSS to SVG using a flexbox layout engine, runs in serverless/edge runtimes (no headless browser needed), and is exactly this "compose text + image into one designed static image" use case — it's an established, widely-used tool for precisely this problem, not something invented for this phase. Supports a real subset of CSS (flexbox, custom fonts via TTF/OTF/WOFF, absolute positioning) — enough for real typography pairing and whitespace control, per spec's Anti-Slop layout rules | **Recommended in-scope option** |
| **Heaviest** — custom layout algorithm | PROTO makes its own per-product typography/hierarchy/whitespace *decisions* algorithmically (not picking from a human-predesigned library, but generating novel layouts) | Not realistic to build well in this phase — real layout algorithms (auto-balancing whitespace, dynamic hierarchy based on content length, collision-avoiding text/image composition) are a multi-month specialized effort, and a bad attempt would produce exactly the "default-centered/templated" look the Anti-Slop rules explicitly prohibit — the very failure mode a hand-designed template library avoids by construction | **Explicitly out of scope.** Do not build a novel layout algorithm — same "don't overbuild past what's realistic" posture Step 8 applied to source-verification (§2.4 of phase6) |

### 2.2 What's concretely in scope, stated plainly

- **New dependency required:** `satori` (or `@vercel/og`, which wraps it) — a genuinely new piece of infrastructure, same category of addition `groq-sdk` was in Phase 1, needs its own `package.json` entry and its own smoke test (mirroring every prior phase's `smoke:*-ai.ts` pattern) before being trusted.
- **A small, hand-built template library — this is real design work, not code, and this document does not do it.** Building even 4–8 genuinely well-designed templates (real typography pairing, real hierarchy, considered whitespace, per Anti-Slop) is a design task that has to happen before Step 9's rendering code has anything to render *into*. **Confirmed by Arman, 2026-08-25 (decision 16, §9): Arman will design the templates himself**, likely with AI design assistance, once the build reaches that stage — not blocking the engine/infrastructure work now.
- **Each template is a complete "look"** — layout + palette + font pairing bundled together as one coherent unit, not three independently mixable choices (§2.3 explains why).
- **The AI-generated art (Nano Banana 2) is composited *into* a template**, as a background/hero image region the template layout defines — consistent with spec's framing ("AI-generated art... layered into templates"), not a freestanding generated image with no template involvement.

---

## 3. Nano Banana 2 / Gemini Connector (hard question 3) — resolved live, §3.2

**How this section started — stated plainly, not glossed over:** this document could not resolve the connector precondition on its own when first drafted.

### 3.1 Which tier — confirmed, not left ambiguous

"Nano Banana" names a family of three genuinely different API models, not one:

| Tier | API model | Positioning |
|---|---|---|
| Lite | `gemini-3.1-flash-lite-image` | Speed/cost — ~5x faster generation (~4s vs. ~20s), lower fidelity |
| **Standard ("Nano Banana 2")** | **`gemini-3.1-flash-image`** | Generalist — the tier the product spec's own naming refers to |
| Pro | `gemini-3-pro-image` | Highest fidelity, up to 4K — ~3x the standard tier's cost |

**This document targets the standard tier, `gemini-3.1-flash-image`, throughout §4 and §7** — not a blend across tiers, and not Lite or Pro. Reasoning for why standard (not Lite or Pro) is the right default for cover generation specifically, given §4.2's cost-cap discussion depends on it:

- **Lite is rejected as the default.** Cover art is the one artifact this whole phase exists to get right — it's directly customer-facing (the thing a buyer sees on an Etsy/Gumroad listing) and is exactly what the Anti-Slop imagery rule ("avoid generic AI-stock-photo look") is guarding. Defaulting to the cheapest/fastest tier to save ~$0.03/image works against the phase's actual quality bar for its one deliverable.
- **Pro is not the default, confirmed by Arman (2026-08-25).** At ~3x standard cost, using Pro tier across every initial candidate *and* every edit round (§4.2 — this is an iterative flow by design) would multiply the phase's real dollar cost significantly for marginal fidelity gain during iteration. **Reserved as an idea for a possible future final-polish step** (e.g. one Pro-tier upscale pass at approval time) — not decided, not scoped, not part of this build. Noted here so it isn't lost, not tracked as an open question.
- **Standard tier matches Step 9's own scope boundary.** §1.3 already excludes "rendering a full cover-to-back-matter print-ready file" from this phase (that's Export's job) — so a working-resolution image for on-screen approval, not a print-ready 4K master, is what this phase actually needs. Standard tier at 1K resolution (§4.1) fits that need without paying for resolution this phase doesn't use.

### 3.2 The connector precondition — resolved live, 2026-08-25

**No longer an open blocker.** A real Gemini API key now exists, and a standalone precondition-clearing script (`scripts/verify-gemini-connector.ts`, not part of any built module — mirrors exactly how `lib/ai/groq.ts`'s actual model had to be checked live in Phase 1) made one real, billable call against `gemini-3.1-flash-image` via `ai.interactions.create()`. Findings, live-confirmed not researched:

- **SDK and method confirmed:** `@google/genai` (now a real dependency in `package.json`), `ai.interactions.create({ model, input, response_format })`. Real requests hit `https://generativelanguage.googleapis.com/v1beta/interactions`.
- **Response shape confirmed:** the image comes back at `interaction.output_image.data`, base64-encoded, plus `interaction.output_image.mime_type`. Also present on the response: `id`, `status`, `created`/`updated`, `service_tier`, `steps`, `model`, and — importantly — a real `usage` field (see below).
- **Real, live-caught correction #1 — response format:** the first attempt used `mime_type: 'image/png'`, matching Google's own documented example. The live API rejected it with a 400 before any generation occurred (not billed): `"The value 'image/png' is not supported for 'response_format.mime_type'. Supported values: 'image/jpeg'."` **Only `image/jpeg` actually works**, despite what the docs show. Fixed in the script; §7.3's model column and any future generation code must target `image/jpeg`.
- **Real, live-caught correction #2 — cost metadata:** this document's own earlier research (via a documentation fetch) concluded the API response exposes no usage/cost data, recommending a manual check against the AI Studio billing dashboard instead. **That was wrong.** The real response includes a `usage` object with real token counts (`total_input_tokens`, `total_output_tokens`, `total_tokens`, plus a per-modality breakdown) — cost is computable directly from every real response, not just checkable after the fact on a dashboard.
- **Real per-call cost, measured, not estimated (§4.1 has the full breakdown):** one 1K-resolution call cost **$0.0891** by the official published rates, not the $0.067 flat "per 1K image" figure this document had been citing — a real ~33% gap, explained in §4.1.
- **A real billing gap was also hit and resolved along the way:** the first live attempt (after fixing the mime-type issue) failed with a 429 — *"Your prepayment credits are depleted"* — a genuine account-level blocker, not a code issue. Resolved once Arman funded the AI Studio project's prepayment balance; the verification call above succeeded immediately after.

The one-time precondition (a funded, working Gemini connector) is now cleared. Every specific model/endpoint/pricing detail in this document should still be treated as current-as-of-2026-08-25, not permanently pinned — the same "re-verify, don't assume" posture `groq.ts`'s own history (a 404 a day after being chosen) established for every connector in this codebase.

---

## 4. Cost Model — Paid-Per-Image Changes the Cap Conversation (hard question 4)

### 4.1 Real, measured cost (2026-08-25) — not just researched

**Official published rates for the standard "Nano Banana 2" tier** (`gemini-3.1-flash-image`, confirmed at [ai.google.dev/gemini-api/docs/pricing](https://ai.google.dev/gemini-api/docs/pricing)): **$0.50 per 1M input tokens, $60.00 per 1M output tokens** — equivalent to the per-image figures this document already cited (~$0.045 at 0.5K/512px, ~$0.067 at 1K, ~$0.101 at 2K, ~$0.151 at 4K), roughly 50% off via the Batch API (non-interactive, unsuitable for the "generate, review, edit" flow this phase needs). For comparison, at the same resolution the Lite tier runs ~$0.034/image and Pro runs ~$0.13–0.24/image (§3.1).

**Real measured result from the live verification call (§3.2), 1K resolution: $0.0891** — computed directly from the response's own `usage` field (32 input tokens, 1,485 output tokens) against the official rates above: `32/1M × $0.50 + 1,485/1M × $60.00 = $0.0891`. **This is ~33% higher than the $0.067 flat "per 1K image" figure** this document had been citing. The gap is real, not a rounding error: the response's `output_tokens_by_modality` breakdown shows only **1,120** of the 1,485 total output tokens are attributed to the `image` modality (1,120 × $60/1M = $0.0672 — matches the published $0.067 figure almost exactly). The remaining **365 output tokens** are billed at the same output rate but aren't captured by the simplified per-image marketing number — likely per-request/protocol overhead specific to the newer Interactions API surface. **Practical implication: budget closer to ~$0.09/image at 1K for this connector, not the ~$0.067 headline figure**, until more calls establish whether 365 tokens of overhead is a fixed per-call cost or varies with prompt complexity.

**Recommended target resolution: 1K, ~$0.09/image (real, measured) — not ~$0.067 (published headline rate)** — matches §3.1's reasoning that this phase needs a working/approval-quality image, not a print-ready master (that's Export's concern), and sits well below Pro-tier cost for the iterative candidate/edit-round flow §4.2 caps, even at the corrected real-world number.

The spec's cited "~$0.02/image" doesn't match any single point on the standard tier's own real pricing curve, published or measured — it's closest to the Lite tier's batch rate, not the standard tier's real interactive cost this document recommends budgeting against.

Sources: [ai.google.dev — Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (official, live-fetched); earlier survey research from [eesel AI](https://www.eesel.ai/blog/nano-banana-2-lite-pricing), [OpenRouter](https://openrouter.ai/google/gemini-3.1-flash-lite-image), and [Curlscape](https://curlscape.com/blog/google-gemini-api-pricing-guide-2026) — useful for the cross-tier comparison in §3.1, superseded by the official page for exact standard-tier rates.

### 4.2 Why this changes the regenerate-cap conversation

Every prior phase (Steps 2–8) used a flat **5 regenerations per project soft cap**, justified only by "consistent with every prior phase" — never independently re-derived, because every prior call was free (Groq). Step 9 is the first phase where each additional attempt has a **real, non-trivial dollar cost** (potentially $0.05–$0.15+ per attempt at standard resolution). Carrying the same "5" forward without reconsidering it would be applying a free-tier heuristic to a paid-tier decision without checking whether the reasoning still holds — exactly the trap the brief calls out explicitly.

**Two separate caps are needed, not one** (the existing phases only ever had one kind of regenerate action; Step 9 has two structurally different ones — see §5):

| Cap | Confirmed default | Reasoning | Status |
|---|---|---|---|
| **Initial candidate generations** (fresh AI cover attempts, not edits of an existing one) | **3 per project** (down from the standard 5) | Real $ per attempt; a candidate that's structurally wrong (wrong template/mood entirely) is better solved by picking a different template/look and regenerating once, not brute-forcing five variations at ~$0.09 each | **Confirmed by Arman, 2026-08-25** |
| **Style-edit rounds** (AI-assisted edits to an existing candidate — "recreate in Eiko Ojala style," etc.) | **5 per project** (same as text-phase precedent) | Edits are typically cheaper in intent (refining, not regenerating from scratch) and the spec explicitly describes edit-style iteration as the expected normal flow ("AI-assist edit... move the title header to middle-left") — capping this too aggressively would work against the spec's own described UX | **Confirmed by Arman, 2026-08-25** |

At the real measured cost (§4.1), worst case is **3 × $0.09 + 5 × $0.09 ≈ $0.72 per project** — confirmed as acceptable.

**Decision, confirmed by Arman 2026-08-25: these are HARD caps, not soft warnings** — the first departure from every prior phase's soft-cap-only precedent, since real money (not just audit-log noise) is at stake once a cap is exceeded. Mechanism: once `candidate_count`/`edit_round_count` reaches its cap, the corresponding action (**Regenerate candidate** / **Style-edit**, §7.8) is rejected unless the caller passes an explicit `acknowledgeAdditionalCost: true` — the same per-call acknowledgment-gate *shape* Steps 7/8 already use for hand-curation-overwrite protection (`acknowledgeOverwrite`), reused here for a different trigger (cost overrun, not content loss). The acknowledgment is required on every call past the cap, not a persistent "unlocked" state — consistent with how `acknowledgeOverwrite` already works nowhere in this codebase as a sticky flag.

### 4.3 New data requirement this creates

No prior phase's generation log needed a cost column, because no prior phase's calls cost anything. `cover_generations` (§7.3) needs a `cost_usd numeric` column — the first real per-call cost-tracking field anywhere in this codebase.

---

## 5. The Approval Flow's Data Shape (hard question 5)

### 5.1 Single-candidate-then-iterate vs. multi-candidate-then-pick

The spec names three options at approval time (accept PROTO's version / upload own / AI-assist edit) — this describes an **iterate-on-one-artifact** flow, not a **generate-N-simultaneously-then-pick** flow. Nothing in the spec text implies PROTO ever shows multiple candidates side by side for a single generation event.

**Recommendation: single-candidate-then-iterate.** Reasoning, given §4's real cost:

- Generating N candidates simultaneously multiplies cost by N *per generation event*, on top of whatever edit-round cost follows. At $0.05–$0.15/image, a 3-candidate simultaneous batch costs 3x for a choice the edit-round mechanism can likely reach anyway via targeted natural-language instructions ("try this in a different style") at lower incremental cost per step.
- The spec's own language ("accept... upload... or AI-assist edit") reads as three alternative *next actions* on one current cover, not as picking among several.

**Confirmed by Arman, 2026-08-25: single-candidate-then-iterate.** Cheaper, and fits how he works.

### 5.2 Revision lineage is a genuinely new relationship shape

Unlike every prior phase's regenerate action (which always replaces "the" current content wholesale, with no notion of "based on which prior attempt"), a style-edit ("move the title header to middle-left") is inherently **based on a specific prior candidate**, not a fresh generation from scratch. This needs a `parent_generation_id` self-referencing FK on the generation log (§7.3) — the first lineage/tree relationship in this codebase's generation-log pattern, vs. every prior phase's flat append-only list.

### 5.3 Upload path needs file storage — new infrastructure, not present anywhere yet

Reading `workspace/03_build/supabase/migrations/0001_init_schema.sql`, `0005_subtopics.sql`, and `0006_content.sql` directly: **no Supabase Storage bucket, no storage-policy migration, and no binary/blob-holding table exists anywhere in this build.** Every artifact so far has been text stored directly in Postgres columns. An uploaded cover image (and every AI-generated candidate) is a binary asset that does not belong in a Postgres text/jsonb column at meaningful scale.

**This requires introducing Supabase Storage as new infrastructure**, specifically:
- A storage bucket (e.g. `product-covers`).
- Storage-level RLS policies analogous to (but mechanically distinct from) `is_workspace_member()` — Supabase Storage policies are evaluated against the object path/metadata, not a Postgres table, so the existing `is_workspace_member()` function's *pattern* (not literal reuse) needs to be re-expressed as a storage policy, e.g. gating on a `{workspace_id}/...` path prefix matching the requesting user's workspace membership.
- A decision on public vs. signed URLs for serving covers.

**Process decision, confirmed by Arman 2026-08-25: the concrete bucket structure, policy design, and public-vs-signed-URL choice are deferred to DEV's build-planning stage for this phase, not decided blind here** — DEV proposes the specific approach when Step 9 build work starts, Arman reviews it before anything ships, same "auth flow and RLS policies get checked before anything ships, every time" principle the product spec already states for every other security-critical piece, extended here to storage policies. This document's job is flagging that the infrastructure is needed and why (done above), not designing it end-to-end before a single line of Step 9 code exists.

**Flagged explicitly per the brief's instruction: this is new infrastructure this document cannot silently assume into existence.** It needs its own migration/setup step, separate from (but alongside) the Postgres table migration in §7.

### 5.4 What "upload own image" means for the data model

Treated as a **generation-log entry with no AI call** — `trigger_scope='user_upload'`, `model=null`, `cost_usd=null`, `prompt_sent=null`, `generation_status='succeeded'` trivially (a completed upload is either persisted or the action never completes), `asset_storage_path` populated from the uploaded file. This reuses the same append-only log table rather than inventing a separate "uploaded covers" table — direct analog to how `subtopic_source` distinguishes `ai_generated`/`manual`/`ai_regenerated` within one table rather than splitting manual edits into their own table (`phase5-requirements.md` §1.7 precedent).

---

## 6. Style-Edit Natural-Language Instructions (hard question 6)

### 6.1 Is this blocked on the unbuilt router?

Spec §6 lists the natural-language router (intent classification **between Claude and Nano Banana tasks**) as explicitly not built. The router's job is resolving *cross-connector* ambiguity — deciding whether a user's free-text request should go to Claude (reasoning/writing) or Nano Banana 2 (visual). **Within Step 9's own UI, that ambiguity does not exist**: every instruction entered at the cover-approval step ("recreate in Eiko Ojala style," "move the title header to middle-left") is, by construction of where the user typed it, an image-edit instruction. There is only one connector Step 9 would ever route a style-edit instruction to.

**Conclusion: Step 9 does not need the router, and is not blocked on it.** What it needs instead is a narrow, scoped prompt-construction step — take the user's free-text instruction, combine it with the current cover's context (which template/look is active, the current image as the edit target) and pass it to Nano Banana 2's edit call. Spec itself supports this being low-effort: Nano Banana 2 "responds well to natural-language edit instructions" is stated as a property of the model itself, not something PROTO needs to build a classifier for.

### 6.2 What is genuinely in scope vs. what stays deferred

| In scope for Step 9 | Deferred / out of scope |
|---|---|
| A thin prompt-construction function: `{current image, active look/template context, user's free-text instruction}` → Nano Banana 2 edit call | Any general-purpose router deciding *which connector* handles a request — genuinely still blocked on spec §6's unbuilt item, but that item was never Step 9's dependency to begin with |
| Persisting the raw instruction text (`cover_generations.edit_instruction`) for audit, same "keep the literal input" posture as every prior phase's `inputs_snapshot` | Any semantic validation of whether the instruction was "understood correctly" — not deterministically checkable (§6, next section) |

### 6.3 No guardrail is possible on instruction interpretation quality

Unlike every prior phase's inputs (which fed a text-generation call whose *output* PROTO could then check against deterministic rules), a style-edit instruction feeds an image-edit call whose output is a picture — there is no deterministic check for "did the model actually move the title to middle-left." **This is stated plainly as a real, uncloseable gap, not solved by clever engineering**: it's exactly why the spec puts a mandatory human approval gate immediately after every edit attempt, rather than trusting the edit and auto-advancing.

**Decision, confirmed by Arman 2026-08-25: add an explicit "Undo last edit" action, not just "the previous candidate is still browsable."** Browsing the full log (§7.8's "Pick an older candidate") is sufficient in principle — every prior artifact survives — but confirmed as real friction against the specific, common case of "that edit made it worse, go back exactly one step." Cheap to add: `parent_generation_id` (§5.2/§7.3) already records the immediate prior candidate, so this is a scoped convenience wrapper around the existing revert mechanism, not new schema — sets `current_cover_generation_id` to the current generation's `parent_generation_id`, available only when that field is non-null (i.e., only undoes a `style_edit`; an `initial_candidate` or `user_upload` has no parent to undo to). See §7.8.

---

## 7. Data Model

### 7.1 Real shape, not force-fit

Per §0, this needs a **recommend/confirm-shaped style-profile record** for the look decision, plus a **candidate-artifact log with lineage** for the cover image itself, plus an **approval gate** on the header. This is genuinely two concerns living in one header table (the look decision and the approval state), because both are properties of "this project's one cover," not two separately-cardinalitied things.

### 7.2 `cover_designs` (header, 1:1 with `projects`)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | RLS tenant key |
| `project_id` | uuid (fk → projects, **unique**) | no | 1:1, same pattern as `content_builds.project_id` |
| `title_candidate_id` | uuid (fk → title_candidates) | no | Staleness input — same snapshot pattern as every prior header |
| `format_recommendation_id` | uuid (fk → format_recommendations) | no | Format informs template/look eligibility (e.g. a tracker cover vs. an ebook cover reads differently) |
| `content_build_confirmed_at` | timestamptz | no | Staleness snapshot — page-length/depth signal (word counts) from Step 8 feeds template selection (denser content may favor a different template than a slim one) |
| `recommended_look_id` | text | no | Code-registry key (§7.5) — PROTO's proposed look, with a stated reason, same recommend/confirm shape as Step 4's format recommendation |
| `recommendation_reason` | text | no | Plain-English reason, mirrors Step 4's format-recommendation reason field |
| `confirmed_look_id` | text | no | Defaults to `recommended_look_id`; overwritten if Arman picks a different registered look. **Never** an arbitrary mix of template+palette+font — always one registered look-bundle (§7.5) |
| `look_is_overridden` | boolean | no, default `false` | Same "is_edited"-style flag precedent, applied to a pick instead of a text field |
| `current_cover_generation_id` | uuid (fk → cover_generations) | yes | Which artifact is "the" current cover right now — nullable until a first attempt exists. FK added via `alter table` after `cover_generations` exists (same circular-reference pattern as migration 0005/0001) |
| `candidate_count` | int, default 0 | no | Cap tracking for §4.2's initial-candidate cap |
| `edit_round_count` | int, default 0 | no | Cap tracking for §4.2's edit-round cap |
| `approval_status` | enum `cover_approval_status` (`pending`, `approved`) | no, default `pending` | The mandatory gate |
| `approved_at` / `approved_by` | timestamptz / uuid (fk → users) | yes | Null until approved. Set only by an explicit approve action, never inferred |
| `status` | enum `transformation_map_status` (**reused**) | no | `draft` (still iterating) / `confirmed` (same reuse convention as Phase 3/5/6) — note this tracks the *header's* edit-lock state, distinct from but related to `approval_status` (§7.6 explains the relationship) |
| `created_at` / `updated_at` | timestamptz | no | |

### 7.3 `cover_generations` (append-only log — every AI attempt and every upload)

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid (pk) | no | |
| `workspace_id` | uuid (fk) | no | |
| `project_id` | uuid (fk → projects) | no | |
| `cover_design_id` | uuid (fk → cover_designs) | no | |
| `generation_number` | int | no | Sequential per `cover_design_id`, same pattern as every prior log |
| `trigger_scope` | enum `cover_trigger_scope` (`initial_candidate`, `style_edit`, `user_upload`) | no | The single field distinguishing all three approval-time options from spec §Step 9 |
| `parent_generation_id` | uuid (fk → cover_generations, self-referencing, `on delete set null`) | yes | **New relationship shape (§5.2)** — which prior candidate a `style_edit` is based on. Null for `initial_candidate`/`user_upload` |
| `look_id` | text | yes | Frozen snapshot of the registered look used. Null for `user_upload` (no template involved) |
| `edit_instruction` | text | yes | The raw natural-language instruction (§6.2). Null except for `style_edit` |
| `prompt_sent` | text | yes | The actual constructed prompt sent to Nano Banana 2, sanitized for audit. Null for `user_upload` |
| `asset_storage_path` | text | yes (populated on success) | Supabase Storage object path (§5.3) — never a raw binary in Postgres |
| `model` | text | yes | `gemini-3.1-flash-image` — the standard "Nano Banana 2" tier, **live-confirmed working 2026-08-25** (§3.2), not Lite or Pro. Null for `user_upload` |
| `cost_usd` | numeric(6,4) | yes | **New field type in this codebase** (§4.3) — null for `user_upload` (free), populated for AI calls once real billing is confirmed |
| `generation_status` | enum `cover_generation_status` (`succeeded`, `failed_fallback`, `failed_blocked`) | no | Simpler 3-value set than text phases' 4-value sets — there is no length-miss-equivalent outcome for an image; either an artifact exists or it doesn't |
| `error_detail` | text | yes | Sanitized only |
| `created_at` / `completed_at` | timestamptz | created_at no, completed_at yes | |

### 7.4 `projects.status` extension

| Status | Meaning |
|---|---|
| `content_confirmed` | (existing) Step 8 done, Step 9 not yet started — a genuine resting state, same as Step 8's own break from auto-fire |
| `design_generating` | **New.** Step 9 in progress — `cover_designs` row exists, `status='draft'`, candidates/edits being attempted, awaiting explicit approval |
| `cover_approved` | **New.** Terminal state for this phase — `cover_designs.approval_status='approved'`. **Deliberately not named `ready_to_download`** — per spec, "Ready to Download" requires content *and* design finalized, and pricing (Step 12) is explicitly described as coming "at the very end" — this document does not claim Step 9 alone is sufficient to reach that Product-Library-level status. Confirmed by Arman as a future (Step 12+) concern, not Step 9's to solve (decision 5, §9) |

**No auto-fire on reaching `content_confirmed`**, extending Step 8's own precedent-break — if anything, the case is *stronger* here: Step 8 broke auto-fire because of call-volume blast radius on a free connector; Step 9's calls cost real money per attempt, which is a more direct reason not to fire anything automatically.

### 7.5 The template/look registry — code, not a database table

**Recommendation: templates are a small, code-level registry (a constant array of look definitions), not a database table.** Reasoning:

- A template is a physical JSX/CSS artifact (a React component defining the layout) plus its bundled default palette and font pairing — it's code, the same way `GROQ_MODEL` is a code constant rather than a database-configurable value. There's no scenario in this phase where a look needs to be created or edited by an end user at runtime (Arman is not designing new templates through a UI in v1).
- `cover_designs.recommended_look_id`/`confirmed_look_id` are plain `text` columns referencing registry keys (e.g. `'editorial-serif-01'`), validated at the application layer against the registry's known keys — analogous to how `content_builds.confirmed_format` references the `format_type` enum, except a full Postgres enum is avoided here because the registry is expected to grow/change more frequently than a locked pipeline-stage enum should (adding a template shouldn't require a schema migration).
- **Each registry entry bundles layout + palette + font pairing as one coherent unit** — never independently mixable. This is a direct anti-slop safeguard: the Anti-Slop rule demands *deliberate* font pairing and *considered* whitespace; allowing a user (or an AI recommender) to freely combine an arbitrary palette with an arbitrary font pairing with an arbitrary layout reintroduces exactly the "default/templated" risk the rule exists to prevent. A human (or a careful AI-assisted design pass, per §2.2) makes that coherence decision once, at registry-authoring time, not at runtime per-product.

### 7.6 Enums

| Enum | Values | Status |
|---|---|---|
| `cover_approval_status` | `pending`, `approved` | New |
| `cover_trigger_scope` | `initial_candidate`, `style_edit`, `user_upload` | New |
| `cover_generation_status` | `succeeded`, `failed_fallback`, `failed_blocked` | New — 3-value, simpler than every text phase's 4-value set (§7.3) |
| `transformation_map_status` | `draft`, `confirmed` | **Reused** for `cover_designs.status`, same convention as Phase 3/5/6 |

### 7.7 Relationship between `cover_designs.status` and `approval_status`

Distinct fields, not redundant: `status` (`draft`/`confirmed`) governs whether the header row is *edit-locked* (same RLS-gating pattern as `content_builds.status`/`subtopic_lists.status` — draft rows are mutable, confirmed rows are read-only pending an explicit unlock). `approval_status` (`pending`/`approved`) is the actual human sign-off. **Confirming the header and approving the cover happen in the same action** — there is no scenario where a header is `confirmed` but the cover is still `pending`, or vice versa; the "Approve" button is the single action that sets both (`status='confirmed'`, `approval_status='approved'`, `approved_at`/`approved_by`) atomically. Kept as two fields rather than one because `status` reuses the exact RLS-lock pattern every prior phase already relies on, while `approval_status` is a new, semantically distinct concept (human judgment, not just "is this row locked") worth keeping separately named and separately queryable (e.g. for a future "which products are awaiting my review" dashboard view).

### 7.8 Action Behaviors

| Action | What happens | Which table(s) change |
|---|---|---|
| **Explicit Generate Cover** (available once `content_confirmed`, no auto-fire) | Inserts `cover_designs` (computes `recommended_look_id` + reason from format/tone context, `status='draft'`). Fires one Nano Banana 2 call (`trigger_scope='initial_candidate'`, using the recommended or user-picked look). Inserts one `cover_generations` row. On success: sets `current_cover_generation_id`, `candidate_count`+1. `projects.status` → `design_generating` | Both tables, insert |
| **Regenerate candidate** (`draft` only, before approval) | Same as above, scoped to a fresh `initial_candidate` attempt against a (possibly different) look — subject to the 3-per-project **hard** cap (§4.2, confirmed). At the cap, rejected unless called with `acknowledgeAdditionalCost: true` | `cover_generations` insert, `cover_designs.candidate_count`+1, `current_cover_generation_id` updated |
| **Style-edit** (`draft` only) | User enters free-text instruction against the current candidate. Constructs edit prompt (§6.2), fires Nano Banana 2 edit call (`trigger_scope='style_edit'`, `parent_generation_id` = current). Subject to the 5-per-project **hard** cap (§4.2, confirmed). At the cap, rejected unless called with `acknowledgeAdditionalCost: true` | `cover_generations` insert, `cover_designs.edit_round_count`+1, `current_cover_generation_id` updated on success |
| **Upload own image** (`draft` only) | No AI call. Inserts `cover_generations` row (`trigger_scope='user_upload'`, `generation_status='succeeded'`), stores the file via Supabase Storage (§5.3/§5.4) | `cover_generations` insert, `current_cover_generation_id` updated |
| **Pick an older candidate** (`draft` only) | User can revert `current_cover_generation_id` to any prior row in the log without generating anything new — no new AI call, no new log row, since the artifact already exists (§5.2's "keep every previous candidate" property) | `cover_designs.current_cover_generation_id` only |
| **Undo last edit** (`draft` only, requires the current generation's `parent_generation_id` to be non-null) | Convenience wrapper around "Pick an older candidate" (§6.3), scoped to exactly one step back: sets `current_cover_generation_id` to the current generation's `parent_generation_id`. No new AI call, no new log row | `cover_designs.current_cover_generation_id` only |
| **Approve** (`draft` only, requires `current_cover_generation_id` not null — the one deterministic hard rule this phase has, §8) | Sets `cover_designs.status='confirmed'`, `approval_status='approved'`, `approved_at`/`approved_by`. `projects.status` → `cover_approved` | `cover_designs` only |
| **Unlock / "Edit Cover"** (only from `cover_approved`) | Reverts `cover_designs.status` to `draft`, `approval_status` to `pending`, `projects.status` to `design_generating`. Prior artifacts preserved, not cleared — same precedent as every prior phase's unlock | `cover_designs` only |

### 7.9 RLS — no new authorization mechanism for Postgres tables

Both `cover_designs` and `cover_generations` carry `workspace_id`, gated by `is_workspace_member()`, following the exact convention of every prior migration — no exception for this phase's Postgres tables. **Supabase Storage is the one place a genuinely new authorization mechanism is required** (§5.3), because storage policies are evaluated against object paths/metadata, not Postgres rows — this is a real, new piece of security-critical infrastructure that needs its own explicit review pass per the product spec's Architecture Principles ("auth flow and RLS policies get checked before anything ships, every time"), extended here to cover storage policies too.

### 7.10 Staleness — three dependencies, soft (confirmed 2026-08-25, added after the first review pass)

The data model already carried three staleness-snapshot columns on `cover_designs` (§7.2: `title_candidate_id`, `format_recommendation_id`, `content_build_confirmed_at`) but the first draft of this document never spelled out the treatment — a real gap, caught before build planning rather than silently filled in. **Confirmed by Arman: soft, matching every mature phase's precedent (Steps 6/7/8)** — a generated cover, and any hand-picked candidate history sitting behind it, represents real spend (§4) and real curation effort worth protecting from a forced redo, the same "expensive to lose" argument every prior soft-staleness phase made.

| Dependency | Detection | Why this mechanism |
|---|---|---|
| Title | FK equality: `cover_designs.title_candidate_id` vs. live `projects.selected_candidate_id` | Same technique every phase since Step 5 has used |
| Confirmed format | FK equality: `cover_designs.format_recommendation_id` vs. live `projects.current_format_recommendation_id` | Same technique |
| Content build | Timestamp comparison: `cover_designs.content_build_confirmed_at` vs. live `content_builds.confirmed_at`, **falling back to `content_builds.updated_at` when currently unconfirmed** | Direct reuse of Step 8's own precedent for depending on Step 7's list (`phase6-requirements.md`'s `loadGenerationContext` fallback) — `content_builds` can be legitimately unlocked/unconfirmed at the moment this check runs, same unresolved cross-phase interaction decision 25 of Step 8 already flagged, extended here rather than re-litigated |

**Precedence when multiple are stale simultaneously: title > format > content-build** — same ordering convention established since Step 5, continued through Steps 7/8's `detectStalenessReason`/`detectDocumentStalenessReason`.

**Effect, identical regardless of which dependency triggered it:** none of `cover_generations`' rows or the stored assets are touched. If `cover_designs.status='confirmed'`, it reverts to `draft` (`approval_status` reverts to `pending`, `approved_at`/`approved_by` cleared) and `projects.status` reverts to `design_generating` — a `getCurrentCoverDesign()` orchestration function, mirroring `getCurrentContentBuild()`/`getCurrentSubtopicList()`, is in scope for this build's core-orchestration increment.

---

## 8. Guardrail Layer — Honest About What's Actually Checkable

Per the constraint to be explicit about which parts of this phase can be deterministically guardrailed at all: **far less than any prior phase.** There is no equivalent of Step 8's specificity score or compliance keyword scan for an image — nothing in this pipeline inspects pixels.

| # | Rule | Deterministically checkable? | On failure |
|---|---|---|---|
| 1 | `current_cover_generation_id` must be non-null before `approval_status` can be set to `approved` | **Yes** — a hard, mechanical existence check | Approve action rejected at the app/RLS layer |
| 2 | `confirmed_look_id` must be a valid key in the code-level template registry (§7.5) | **Yes** — string membership check against a known set | Reject the pick, fall back to `recommended_look_id` |
| 3 | Cap enforcement (`candidate_count`/`edit_round_count` vs. §4.2's confirmed limits) | **Yes**, mechanically — and **confirmed hard**, unlike every prior phase's soft-cap treatment (§4.2) | Rejected unless called with `acknowledgeAdditionalCost: true` — a real per-call acknowledgment gate, not a warning |
| 4 | Approval fields (`approved_at`/`approved_by`) are only ever set by an explicit approve action, never inferred from any other state change | **Yes** — enforceable via app-layer logic and RLS `with check` clauses scoping the update to that specific action | N/A — structural, not a runtime rejection |
| 5 | "Is this cover any good" (Anti-Slop layout/imagery rules — real hierarchy, deliberate pairing, avoiding the AI-stock-photo look) | **No — explicitly, honestly not checkable by this pipeline.** This is prompt-engineering responsibility at generation time (constructing Nano Banana 2 prompts that request stylized/illustrative art, not photorealistic stock-photo framing) and template-authoring responsibility at registry-build time (§7.5) — **not** a runtime guardrail. This is the entire reason the spec makes approval mandatory and manual rather than automated, and this document does not attempt to build an AI-judges-its-own-image quality pass to compensate — doing so would add cost (another paid call) to substitute for a check the spec already assigns to a human |

---

## 9. Decisions Locked (2026-08-25)

| # | Decision |
|---|---|
| 1 | **Shape: a fifth, genuinely new shape** — recommend/confirm for the style/look pick, plus a candidate-artifact append-only log with parent/edit lineage, plus a mandatory human approval gate. Does not force-fit any of the four established shapes. §0. |
| 2 | **Surface area: cover only, confirmed.** Step 9 decides the product's "look" (template+palette+font, as structured data) and renders/approves exactly the cover artifact. Interior page rendering is Step 11 (Export)'s job, explicitly deferred. §1. |
| 3 | **Layout engine scope: middle option.** Real single-artifact rendering (the cover) via an off-the-shelf HTML/CSS-to-image compositor (Satori/`@vercel/og`-class library), against a small hand-built template library. No custom layout algorithm — explicitly out of scope. §2. |
| 4 | Templates are a code-level registry (constant, not a DB table), each bundling layout+palette+font as one coherent, non-mixable "look" — direct anti-slop safeguard against incoherent combinations. Confirmed code-only for v1, no runtime template editing — Arman-only usage, small template count don't justify the extra flexibility yet. §7.5. |
| 5 | `projects.status` gains `design_generating` and `cover_approved` — **not** `ready_to_download`, which this phase does not claim sufficiency to set. Mapping the Product Library's `Ready to Download` status onto the pipeline's `projects.status` enum is confirmed as a future (Step 12+) concern, not Step 9's to solve. §7.4. |
| 6 | No auto-fire on reaching `content_confirmed` — extends Step 8's precedent-break, with a stronger justification here (real per-call cost, not just call volume). §7.4. |
| 7 | **Single-candidate-then-iterate, confirmed.** Cheaper, and fits how Arman works. §5.1. |
| 8 | Approval and header-confirm happen atomically via one "Approve" action, tracked as two distinct fields (`status`, `approval_status`) for different structural reasons. §7.7. |
| 9 | Style-edit instructions are handled by a narrow, Step-9-scoped prompt-construction step, **not blocked on the unbuilt cross-connector router** (spec §6) — no cross-connector ambiguity exists within this phase's UI context. §6. |
| 10 | Guardrail layer is existence/state-machine checks only (cap enforcement, non-null artifact, valid registry key) — **no** AI-judgment quality pass on the image itself, deliberately not built, per the spec's own framing that this gate stays manual. §8. |
| 11 | Cover-generation log reuses the append-only pattern from every prior phase, with two new properties no prior log needed: `cost_usd` (real per-call cost) and `parent_generation_id` (edit lineage). §7.3. |
| 12 | Upload path is modeled as a zero-cost, zero-AI-call row in the same generation log (`trigger_scope='user_upload'`) rather than a separate table. §5.4. |
| 13 | **Connector tier and resolution: standard "Nano Banana 2" (`gemini-3.1-flash-image`) at 1K, confirmed** — live-verified working 2026-08-25 (§3.2), real measured cost **~$0.09/image** (not the ~$0.067 headline estimate, §4.1). Not moving to Lite (quality risk against the Anti-Slop imagery bar) or Pro (not worth the cost during iteration). Pro reserved as an idea for a possible future final-polish step — not decided, not built now. §3.1. |
| 14 | **Regenerate caps confirmed: 3 initial candidates + 5 edit rounds per project**, ~$0.72 worst-case at the real measured cost. §4.2. |
| 15 | **Caps are HARD, confirmed** — the first departure from every prior phase's soft-cap-only precedent. Exceeding a cap requires an explicit `acknowledgeAdditionalCost: true` on that specific call (same per-call acknowledgment-gate shape as `acknowledgeOverwrite` in Steps 7/8, applied to a cost trigger instead of a content-loss trigger). §4.2, §7.8, §8. |
| 16 | **Template library (4–8 real designs): Arman will design these himself** (likely with AI design assistance), once Step 9's build reaches that stage — not blocking the engine/infrastructure build now. §2.2, §7.5. |
| 17 | **Supabase Storage bucket/policy/URL design: deferred to DEV's build-planning stage**, with an explicit review checkpoint before it ships — not decided blind in this document, per the product spec's own "auth/RLS reviewed before shipping" principle extended to storage. §5.3. |
| 18 | **Add an explicit "Undo last edit" action**, beyond just relying on "the previous candidate is still browsable" — cheap to add (reuses `parent_generation_id`, no new schema), reduces user error. §6.3, §7.8. |
| 19 | **Staleness: three dependencies (title, format, content-build), all soft** — a real gap in the first draft, caught and confirmed before build planning rather than during it. Same detection/precedence/effect pattern as Steps 6/7/8; content-build uses a timestamp comparison with the same unconfirmed-fallback Step 8 already established for the identical cross-phase situation. §7.10. |

**Status: Step 9 requirements are locked. Not yet built** — DEV work starts now. All 19 items above confirmed by Arman on 2026-08-25, including the connector-tier/cost figures verified live against a real, funded Gemini API key (§3.2) — not left as research-only estimates the way every other item in this table started out.
