# PROTO — Phase 9 Technical Requirements: Step 11 (Export)

**Scope:** Spec Step 11 only — PROTO recommends an output **file container** (PDF / Notion / Docx / "ebook," with the ebook-naming collision resolved explicitly in §2.5) with a stated reason tied to Step 4's locked format decision, lets the user confirm or override that recommendation, and then **assembles the actual downloadable product file** from the already-confirmed upstream content and the already-approved cover — including, for fillable-delivery products (trackers/worksheets/quizzes per Step 4), the harder sub-problem of injecting real interactive form fields, not just static pages. This is the first phase in the entire pipeline whose primary output is a real, multi-page, downloadable document file rather than structured data, a single image, or short-form copy — treated with the corresponding seriousness in §3.

**Does not cover:**
- **Step 12 (Pricing)** — no price is known or referenced at this stage.
- **The Bundle Engine** — no cross-product packaging logic.
- **Actually distributing or hosting the final file to a buyer** beyond generating it and making it retrievable to Arman (e.g., Etsy's own "Instant Download" delivery mechanism, per `phase8-requirements.md` §2.1, is Etsy's job once Arman uploads the file there — PROTO does not integrate with any storefront's delivery pipeline). Scope ends at "a real file exists, safely stored, retrievable via a signed URL" — same boundary Step 9 drew around cover storage.
- **Any file storage/CDN concerns beyond what Step 9's `product-covers` bucket precedent already establishes** — Export needs its own bucket (§9.4), but the storage *architecture* (private bucket + signed URLs, RLS-analog path-prefix policies) is not reinvented here, only extended.
- **Step 10's copy (`copywriting_builds`/`platform_copies`)** — see §1.1 for why this is a checked exclusion, not a silent omission.
- **Any general-purpose Notion OAuth integration product surface** — confirmed out of scope, decision 2, §9. Only a Markdown/HTML export is built.
- **Touching Step 8's content-generation pipeline** — confirmed out of scope, decision 1, §9. The fillable-field structure problem is solved entirely on Export's own side, never by retroactively constraining already-locked upstream content generation.

**Status: Decisions Locked (2026-08-27).** All 7 items in §9 confirmed by Arman. DEV work starts now.

---

## 1. Inputs Consumed

| Input | Source | Included? | Role |
|---|---|---|---|
| Selected title text | `title_candidates.candidate_text` | Yes | Cover page title text (if not already baked into the cover image itself), document metadata (PDF title/author fields, Docx core properties, Notion page title) |
| **Confirmed format + delivery mode** | `format_recommendations.confirmed_format` / `confirmed_delivery_mode` | **Yes — the single most load-bearing input in this phase** | Drives (a) the fillable-vs-static branch the spec's own decision rule names directly, and (b) the ebook-naming-collision question, §2.5 |
| Confirmed subtopics (title, description, `display_order`, `depth`) | `subtopics` | Yes | Chapter/section headings and ordering for the assembled document's table of contents and page sequence |
| **Confirmed content bodies** | `subtopic_contents.body` (Step 8) | **Yes — the literal interior-page text this phase renders into pages** | This is the artifact Step 9 explicitly deferred ("interior page rendering is Step 11's job," `phase7-requirements.md` decision 2) — Export is where that deferred work actually happens |
| **Approved cover — the actual image bytes, not just metadata** | `cover_generations.asset_storage_path` (via `cover_designs.current_cover_generation_id`), retrieved via a storage read (service-role or `getSignedCoverUrl`) | **Yes, and this is a genuine escalation vs. every prior consumer of Step 9's output** | Step 10 only ever needed `cover_designs.confirmed_look_id` as light textual context (`phase8-requirements.md` §2.5) — it never touched pixels. Export is the **first** downstream phase that needs to actually download and embed the real cover image inside the assembled file (full-bleed first page/cover block, §3.4). This is a materially different consumption pattern worth naming explicitly, not silently assumed to be "the same kind of dependency" Step 10 already had |
| Confirmed format's delivery mode → fillable-field requirement | `format_recommendations.confirmed_delivery_mode = 'fillable'` | Yes, conditionally | Triggers the AcroForm-injection sub-pipeline (§3.1) only when true; static/`printable` skips it entirely |
| **Step 10's copy** (`copywriting_builds` / `platform_copies`) | Step 10 | **No — checked exclusion, not a silent omission** | Step 10's own scope line states this copy is store-listing/social-promo text for Arman to manually paste into each platform's UI, explicitly **not** part of the product file itself (`phase8-requirements.md` scope line). Nothing in Step 11's spec text or in the product file's contents needs a hook or CTA — those live on the storefront page, not inside the download. Confirmed here as excluded on inspection, matching this codebase's convention of naming checked exclusions rather than leaving them implicit |
| Demand/competition signals, lead magnet decision, transformation map | — | No | Same reasoning as every downstream phase since Step 8 — already acted on upstream, no new signal at file-assembly time |
| Arman's own source material | — | No | Never an input anywhere in this pipeline |

### 1.1 The pipeline-sequence gate vs. a real data dependency — worth separating cleanly

`projects.status` reaching `copy_confirmed` (Step 10 done) is the **entry gate** for Step 11 purely because Step 10 occupies pipeline position 10 and Step 11 occupies position 11 — a user cannot reach the Export screen without having passed through Copywriting first, by construction of the pipeline's own linear UI flow. This is a **sequencing fact, not a data dependency**: Export's actual generation logic never reads a single field out of `copywriting_builds` or `platform_copies` (§1 table above). Stated explicitly so a future reader doesn't infer a real dependency from the gate alone — the same distinction Step 10 itself drew around Step 9's cover (`phase8-requirements.md` §2.5's "does copy need to see the cover" treatment, applied here in reverse).

---

## 2. Output Format Research

Researched 2026-08-27 via WebSearch against current, dated sources. Same posture as `phase7-requirements.md` §3.2 and `phase8-requirements.md` §2: confidence graded explicitly per claim, nothing here should be treated as permanently pinned, and library capabilities that could not be verified live are flagged for a technical spike rather than assumed to work.

### 2.1 PDF — the fillable-vs-static split, honestly worked through

**No single library in this ecosystem does both "well-designed multi-page layout" and "real interactive AcroForm fields" in one step.** This is the same shape of finding Step 9 had to work through for its own layout-engine decision (§2 of `phase7-requirements.md`) — a middle option assembled from two individually well-proven tools, not one turnkey library.

| Capability needed | Library | What's confirmed | Confidence |
|---|---|---|---|
| Real AcroForm creation (`createTextField`, `createCheckBox`, etc., added to an existing page at explicit x/y/width/height coordinates) | **`pdf-lib`** | Confirmed via its own documented API (`PDFForm.createTextField`/`createCheckBox`/`createRadioGroup`/`createDropdown`, each with `.addToPage(page, {x, y, width, height})`) — [pdf-lib docs](https://pdf-lib.js.org/docs/api/classes/pdfform), [GitHub](https://github.com/Hopding/pdf-lib). Real capability, not a stub | **High** on the API existing. **Medium** on it handling anything beyond simple text fields/checkboxes cleanly — independent commentary ([Nutrient's own comparison blog](https://www.nutrient.io/blog/how-to-fill-pdf-form-in-nodejs/), a competing vendor, so read with that bias in mind) specifically flags pdf-lib as "weak on radio groups + checkbox variants + flattening" for complex forms. Trackers/quizzes plausibly need radio-group-style single-choice inputs, so this caveat is directly relevant, not a hypothetical edge case |
| Multi-page layout with real typography control, matching Step 9's anti-slop bar (deliberate hierarchy, considered whitespace, font pairing) | **`@react-pdf/renderer`** (recommended) or **Puppeteer/Playwright printing styled HTML** (alternative) | See §2.2 for the comparison — both are real, but neither has any built-in AcroForm capability of their own | See §2.2 |
| Bridging the two (knowing *where* on a rendered page to place a form-field widget) | **Not solved by any existing library** — this is custom integration work | Genuinely unverified pattern; no example of "Puppeteer/react-pdf output + pdf-lib field injection working end-to-end" was found in this research pass, only each half independently documented | **Low — flagged for a live technical spike before this path is trusted, mirroring exactly how `phase7-requirements.md` flagged the unverified Nano Banana 2 connector before DEV built against it** |

**Confirmed shape: render static pages first, inject form fields as a second pass.**
1. Render every page as static, high-fidelity HTML/CSS → PDF (the layout/typography problem).
2. For fillable products, run a second, deterministic pass over the *same* rendered document using `pdf-lib`, placing real `PDFTextField`/`PDFCheckBox` widgets at coordinates derived from the layout pass (§2.2's "geometry export" problem — still a genuinely unverified step, needing a live spike, §2.3).
3. Static (`printable`) products skip step 2 entirely — the layout pass's output *is* the final file.

This mirrors the exact "middle option, real tradeoffs named, not oversold as turnkey" honesty `phase7-requirements.md` §2.1 used for Satori — the difference here is that Step 9 had already live-verified its chosen tool end-to-end before locking it; this document has **not** done that for the PDF path, and says so plainly (§8 guardrail 1). **What field a given span becomes (checkbox/text-entry/heading) is now resolved — decision 1, §9: a new AI structure-extraction pass, built entirely on Export's own side. Where that field lands on the rendered page (the geometry-bridging problem, §2.3) remains the one genuinely unverified technical step in this whole document, unaffected by decision 1 — a live spike is still needed before this path is trusted.**

### 2.2 Which layout engine — a genuinely new comparison, since this stack's existing tool (Satori) doesn't fit this job

`package.json` (read directly, 2026-08-27) already has `satori` + `@resvg/resvg-js` from Step 9, and **zero** of `puppeteer`, `playwright`, `@react-pdf/renderer`, `pdf-lib`, `docx`, or any EPUB library. This matters for a reason specific to this phase, not just "what's already installed":

- **Satori has no concept of pagination.** It composites one fixed-size canvas (the cover) using a flexbox subset — exactly right for Step 9's single-image job, structurally wrong for Step 11's job of flowing potentially tens of thousands of words of confirmed body text (Step 8's `subtopic_contents.body`, up to ~30k words for a 15-chapter deep ebook per `phase6-requirements.md`'s own word-count table) across an unknown, content-dependent number of pages. Reusing Satori here would mean hand-building a pagination algorithm on top of it — squarely the kind of "novel layout algorithm" `phase7-requirements.md` §2.1 already ruled out building as over-engineered, just relocated to a harder problem (page-breaking real prose, not laying out one image).
- **This is the actual hard, new problem this phase introduces**: something has to decide, for real confirmed prose of unpredictable length, where page breaks fall — ideally not mid-sentence, not mid-heading, respecting widow/orphan conventions.

| Option | What it means | Buildability | Recommendation |
|---|---|---|---|
| **`@react-pdf/renderer`** | A React-component-based PDF renderer (`<Document>`/`<Page>`/`<View>`/`<Text>`) with a **built-in automatic wrapping/pagination engine** — breakable components fill remaining page space and flow onto a new page automatically; unbreakable components jump to the next page if they don't fit ([react-pdf.org/advanced](https://react-pdf.org/advanced)) | Fits this stack well — same JSX-authoring mental model this codebase already uses for Satori's templates, no headless browser process to manage. **Genuinely new dependency**, needs its own `package.json` entry and smoke test, same as Satori did in Step 9 | **Recommended primary candidate** — purpose-built for exactly this "flow unpredictable-length content across N pages" problem, unlike Satori |
| **Puppeteer / Playwright printing real Chromium-rendered HTML/CSS to PDF** | Full CSS support (real `break-inside: avoid`, `page-break-after`, actual browser text-flow) via a real browser engine, not a flexbox-subset reimplementation | Heavier dependency (a full headless-browser binary, real memory/CPU cost per render — a new *kind* of per-call cost this codebase hasn't had to budget for, unlike Step 9's dollar-per-image cost) but the most capable/proven option for complex print CSS | **Recommended as the fallback if `@react-pdf/renderer`'s CSS/layout subset proves too limited against Step 9's anti-slop typography bar during a build-time spike** — not rejected, just not the first thing to reach for given the added operational weight |
| **Reuse Satori + hand-rolled pagination** | Manually chunk body text into per-page flex layouts | Not realistic — this is exactly the "custom layout algorithm" `phase7-requirements.md` §2.1 flagged as a multi-month specialized effort when it came up for a single cover image; doing it for arbitrary-length flowing prose is a harder version of the same rejected idea | **Not recommended** |

**Neither `@react-pdf/renderer` nor Puppeteer/Playwright has any native AcroForm support** (confirmed for Puppeteer/Playwright specifically: Chromium's own print-to-PDF flattens form inputs to static visual text — [GitHub puppeteer/puppeteer#3646](https://github.com/puppeteer/puppeteer/issues/3646), corroborated by multiple independent HTML-to-PDF vendor writeups; no equivalent claim found for `@react-pdf/renderer` either, and its own docs make no interactivity claim). Both funnel into the same §2.1 hybrid shape regardless of which is chosen for the static-layout half.

### 2.3 The unsolved geometry-bridging problem, named plainly

Neither `@react-pdf/renderer` nor Puppeteer/Playwright is designed to hand back "here is the exact page/x/y/width/height where this specific form field belongs" in a form `pdf-lib` can consume directly:
- Puppeteer *can* in principle read a marked DOM element's `getBoundingClientRect()` before printing and translate CSS pixels to PDF points, but this is a documented technique for browser automation generally, not a documented recipe for this specific PDF-form-injection use case — it was not found working end-to-end anywhere in this research pass.
- `@react-pdf/renderer` renders directly to a PDF byte stream; it does not expose an intermediate "computed layout geometry of this named node" API in anything surfaced by this research.

**This remains the single most consequential unverified technical claim in this entire document** — more so than the layout-engine choice or the structure-detection question (§4.1, now resolved as decision 1). If a live spike shows this bridging step is unworkable cleanly, the fixed-template-field-zone fallback described in earlier drafts of this document is **not available as a fix** — decision 1 explicitly rules out constraining Step 8's content generation to fit pre-declared template shapes. If the dynamic geometry-bridging approach doesn't hold up in a spike, the fallback has to be found entirely within Export's own rendering choices (e.g., a layout engine with more predictable, queryable geometry), not by reaching back into Step 8.

### 2.4 Notion — a real feature exists, but its shape doesn't match this pipeline's own distribution model

Two genuinely different things both answer to "export to Notion," researched separately:

| Option | What it actually requires | Confidence | Fit with this pipeline |
|---|---|---|---|
| **(a) Real Notion API integration** — creating pages/blocks/databases programmatically via the Notion API, including its newer "apply a template to a page" capability | Requires a **public OAuth 2.0 integration** ([Notion's own integration docs](https://www.notion.com/help/create-integrations-with-the-notion-api)) — each end user (in PROTO's case, each eventual *buyer* of a product) would need to connect their own Notion workspace before receiving anything. Real, ongoing engineering surface: token storage/security, a 3 req/sec rate limit requiring a job queue, and webhook listening (`page.created`/`page.content_updated`) to know when a template finish applying | Confirmed real capability, current as of this research | **Poor fit, confirmed by inspection, not assumed.** Every one of Step 10's four storefront targets (Etsy, Gumroad, StanStore, Whop, `phase8-requirements.md` §2) sells a **file** a buyer downloads once — none of them have any mechanism for "buyer connects their personal Notion account before receiving the product." Building this integration would solve a distribution problem none of PROTO's actual sales channels can even present to a buyer. This is the same category of judgment call Step 9 made when it declined to build a general-purpose router it wasn't blocked on (`phase7-requirements.md` §6.1) — except here the blocker is the *business model*, not an unbuilt dependency |
| **(b) A Markdown (or HTML) export the buyer manually imports themselves** | Notion's own native Import feature accepts `.md` files directly, including bulk `.zip`-of-markdown-files imports (up to 5GB), alongside DOCX/CSV/HTML/XLSX/EPUB — [Notion Help Center](https://www.notion.com/help/import-data-into-notion). No API key, no OAuth, no per-buyer connection step — the buyer downloads a file (or a small zip) exactly like every other storefront delivery, then runs Notion's own "Import" menu themselves | Confirmed, current, no ambiguity | **Realistic fit with the existing distribution model** — this is just another downloadable artifact, delivered the same way a PDF is |
| **A genuinely useful finding for (b) specifically, worth featuring**: literal Markdown checkbox syntax (`- [ ]`) **does become a real, interactive Notion to-do block on import**, not a static rendering of a checkbox character — confirmed via multiple independent sources on Notion's markdown-parsing behavior | This meaningfully closes part of the fillable-vs-static gap for Notion specifically: a "fillable tracker" exported as Markdown can plausibly ship with real, clickable Notion checkboxes without touching the OAuth/API route at all | Medium-high confidence (consistent across sources, matches Notion's well-known general markdown-shortcut behavior) | Strengthens option (b) as a legitimate v1 answer, not just a degraded fallback |

**Confirmed (decision 2, §9): (b) — a Markdown/HTML export — is the answer for "Notion" as an output format.** Matches how every one of PROTO's actual sales channels already works (buy and download, not a live account-to-account integration). (a) — the real OAuth API integration — is reserved as a flagged future idea, not built now, mirroring exactly how `phase7-requirements.md` §3.1 reserved Nano Banana 2's Pro tier the same way.

### 2.5 The ebook / `ebook` naming collision — resolved with a recommendation, not silently assumed

The product spec's own text creates a real, checkable inconsistency, not a hypothetical one:

> *"PROTO recommends output format (PDF / Notion / Docx / **ebook**)... Fillable PDF if the product requires user input... **Static PDF if it's pure information (guides, ebooks)**."*

Read literally, the spec's own second sentence already resolves ebook-style products to **PDF** (the "static PDF" branch), one sentence after listing "ebook" as if it were a fourth, independent container alongside PDF/Notion/Docx. These two sentences cannot both be taken at full face value simultaneously.

**Separately, and independently of that internal inconsistency**: Step 4's `format_recommendations.confirmed_format = 'ebook'` (`phase2-requirements.md` §1.1) describes the **product's content style** — a read-only reference/narrative product, the one format explicitly excluded from the printable/fillable axis entirely. This is a **different axis** from a file *container* choice. A `confirmed_format = 'tracker'` product could, in principle, still be delivered as a PDF, a Docx, or a Notion export — the content style and the file container are orthogonal questions, and nothing about Step 4's `ebook` value inherently implies a specific file type.

Three live readings, presented without picking one:

| Reading | What it means concretely | Tradeoff |
|---|---|---|
| **A — "ebook" the output format = EPUB, a genuinely distinct container** | A real, reflowable e-reader file (`.epub`), buildable via an HTML-to-EPUB library (`epub-gen-memory` is the actively-maintained fork of the historically common `epub-gen` — [npm](https://www.npmjs.com/package/epub-gen-memory), chapter-per-HTML-file input, real capability, not a stub) | Meaningfully different from a static PDF (reflows to any screen size, standard on every e-reader/retailer), but is a **fourth rendering pipeline** this phase would need to build and maintain, on top of PDF/Docx/Notion-markdown — real added surface area for a format whose actual demand (does Arman's buyer base want `.epub` files at all, vs. PDFs, which every platform in Step 10's list already handles natively) is unverified |
| **B — "ebook" the output format is just the spec's own shorthand for a specially-styled Static PDF**, and its appearance in the "PDF / Notion / Docx / ebook" list is imprecise phrasing rather than a fourth peer option | No new rendering pipeline — `confirmed_format='ebook'` products simply flow through the same static-PDF path every non-fillable product uses, possibly with a distinct template registry entry (book-style running headers/footers, chapter title pages) rather than a distinct file type | Textually the more internally-consistent reading of the spec's own two sentences (§2.5 opening quote) — but discards "ebook" as a real output-format value entirely, which may not be what was intended when it was written into the list explicitly |
| **C — Genuinely orthogonal, as Step 4's own taxonomy would suggest**: output format is a pure container choice (PDF/Notion/Docx/EPUB), independent of `confirmed_format`; the recommendation logic simply defaults ebook-*style* products toward the EPUB or static-PDF container (whichever reading A/B resolves), while other content styles remain free to pick any container | Most conceptually clean, matches how Step 4's own format axis and this phase's container axis are actually different questions | Requires explicitly deciding reading A or B underneath it anyway — doesn't avoid the choice, just states the axes are separate |

**Confirmed (decision 3, §9): reading B.** No new EPUB pipeline — `ebook`-style products ship as a distinctly-templated static PDF. Arman's buyers expect downloadable PDFs, not e-reader files. `export_output_format` therefore needs only 3 values (`pdf`, `notion_markdown`, `docx`, §8.3) — no `epub` value.

### 2.6 Docx

The `docx` npm package (current major version actively maintained, v9.7.1 as of this research — [npm](https://www.npmjs.com/package/docx)) is the standard, real, non-stub Node.js approach: supports paragraphs, headings, tables, images, headers/footers, and page-numbering — everything needed for a static workbook/ebook-style document. **Confidence: high** — this is the consistently-named default across every source surfaced (docxtemplater and docx-templates are template-fill-oriented alternatives, better suited to filling a pre-built .docx template with data than to generating a fully novel multi-page layout from scratch, so `docx` itself is the better-fitting choice here).

**A real, disclosed fidelity gap for Docx specifically**: true full-bleed cover imagery (an image extending to the physical page edge, beyond any margin) is a print-PDF-native concept without a clean equivalent in the Word/OOXML document model, which is built around a printable-margin page model. A Docx export's "cover" is realistically a full-page-but-margined image on the first page, not a true bleed — a lower-fidelity cover presentation than the PDF path gets. Worth naming now rather than discovering it as a surprise during build.

**Docx has no interactive-form-field story evaluated in this pass at all.** Word does have its own legacy form-field/content-control mechanism, but nothing in this research touched it — if Docx is ever expected to support the fillable branch (not just the static branch), that is a fully separate, unresearched technical question, flagged here as out of this document's confidence entirely rather than assumed to work by analogy to the PDF path.

### 2.7 Cover embedding — confirmed as a real requirement, mechanism differs per container

Per Step 9's own explicit framing ("interior page rendering is Step 11's job," `phase7-requirements.md` decision 2), the cover feeding into the same document Export assembles is the natural reading, not an invented requirement:

| Container | Mechanism | Fidelity |
|---|---|---|
| PDF | Full-bleed first page, image embedded directly via `pdf-lib`'s (or the chosen layout engine's) native `embedJpg`/`embedPng` support (Step 9's cover assets are `image/jpeg` per Nano Banana 2's real constraint, or `image/png` for uploads — `lib/cover/storage.ts` already branches on this) | High — this is exactly what PDF's fixed-layout model is good at |
| Docx | First-page image, margined not bled (§2.6) | Medium — a real, disclosed gap |
| Notion (Markdown export) | Notion's page object has a native "page cover" banner property, but that property is **not reachable via a plain Markdown-file import** — a markdown import can only place the image inline as ordinary page content, not populate the special cover-banner UI slot | Medium-low via the Markdown route (option b, §2.4); would require the real API route (option a) to set the actual `cover` property — another point favoring naming this a real, not cosmetic, tradeoff between (a) and (b) |
| EPUB (if reading A, §2.5, is chosen) | `epub-gen`-family libraries accept a cover image as a first-class input parameter | High, if this path is ever built |

---

## 3. Shape Determination

### 3.1 Does an established shape fit?

| Shape | Precedent | Defining property | Fits Step 11? |
|---|---|---|---|
| Recommend/confirm | Steps 4–5 | AI proposes one enum value from a small set, with a stated reason; user accepts/overrides; no binary artifact produced by the recommendation itself | **Partially.** The *output-container* pick (PDF/Notion/Docx/[ebook, pending §2.5]) genuinely fits this shape — small enumerated set, stated reason, override mechanism, exactly Step 4's own move. But nothing in Phase 2's shape ever produced a downloadable multi-page binary artifact — this covers only the front door of the phase |
| Single editable record + log | Step 6 | One project-level, freely re-editable prose record | No — Export produces no user-editable prose field of its own; every word it renders was already confirmed upstream in Step 8 |
| Live variable-length collection | Step 7 | N self-managed rows, user adds/deletes/reorders | No — Export doesn't manage a collection of its own; it consumes one already-fixed collection (subtopics) |
| Editable-content-per-row (fixed or inherited N) | Steps 8/10 | N rows, each independently regeneratable/editable content | No — there's nothing here shaped like "N independently-editable prose fields." An exported file isn't edited row-by-row; it's regenerated wholesale from upstream sources that are themselves already locked |
| Candidate-artifact + lineage + mandatory human-taste approval gate | Step 9 | A binary asset, iteratively AI-generated/edited, with a **subjective quality judgment** only a human can make | **Partially, and differently than it first appears — see §3.2** |

**None fit cleanly on their own.** The output-format pick genuinely is recommend/confirm. The file-assembly work resembles Step 9's "produces a real binary artifact, needs a generation log" shape structurally, but the *reason* Step 9 needed a mandatory human-approval gate — "PROTO cannot deterministically inspect whether an AI-generated image is any good" (`phase7-requirements.md` §0.2) — does not transfer directly here, because Export's interior content isn't newly AI-generated at all; it's a deterministic re-render of text and an image that were **already** reviewed and approved upstream (Step 8's compliance/specificity gate, Step 9's mandatory cover approval).

### 3.2 The real conclusion: recommend/confirm for the container choice, layered on a deterministic assembly pipeline whose own artifact needs a *lighter* check than Step 9's, not the same one

This is a genuinely new combination, not a forced fit into any prior shape:

1. **Recommend/confirm** (Step 4's exact shape) governs the *output-format decision* — small enumerated set (PDF/Notion/Docx/[ebook]), stated reason keyed to `confirmed_format`/`confirmed_delivery_mode`, override mechanism, confirm action. No new shape needed for this half.
2. **A deterministic document-assembly pipeline** — not a generation call in the AI sense — takes the confirmed inputs (§1) and produces a real file. Unlike Step 9's cover, there is no *creative* judgment being exercised at render time; the render either faithfully reproduces already-confirmed content and structure, or it has a bug. This is a categorically different failure mode than "is this image tasteful" — closer to "did the compile succeed" than "do I like this."
3. **Confirmed (decision 4, §9): a mandatory human visual-review/approval gate, mirroring Step 9's cover-approval precedent exactly.** Given §5's own honest admission that pagination/layout/field-semantic correctness isn't fully checkable by code (rules 3, 6, 9), Arman wants to see the actual assembled file before it's marked final — same two-field mechanics as `cover_designs` (`status` + `approval_status`, atomic single "Approve" action, `phase7-requirements.md` §7.7).

**No fifth data shape is invented here beyond what already exists** — this document reuses Step 4's recommend/confirm mechanics for the container decision and a header-plus-append-only-log shape, structurally identical to `cover_designs`/`cover_generations` including its mandatory-approval semantics (decision 4), for the assembly artifact itself.

---

## 4. Generation Approach — Honest About What's AI and What's Engineering

**This phase is, in real proportion, mostly engineering — not generation. Said plainly, matching the brief's own framing, because it is a legitimate and different shape from every AI-heavy phase before it.**

| Piece of work | AI-generated or deterministic? | Detail |
|---|---|---|
| Output-format recommendation + stated reason | **AI, small-scale** — a single Groq structured-JSON call, same connector/pattern/cost profile as Step 4's format-recommendation call (`phase2-requirements.md` §2.2) | Inputs: `confirmed_format`, `confirmed_delivery_mode`, plus perhaps total confirmed word count (a rough size signal). Output: one container value + a 1–2 sentence reason. **No new AI connector needed for this piece** — Groq's existing `openai/gpt-oss-120b` default is more than sufficient for a 4-way classification call, exactly as it was for Step 4 |
| Actual page/document assembly (text layout, pagination, cover embedding, table-of-contents generation) | **Deterministic** — a rendering/compilation pipeline (§2.2/§2.3), not a generative call. No prompt, no model, no "creativity" — takes already-confirmed structured inputs and produces a file | The bulk of this phase's real engineering effort lives here, not in any AI call |
| **Content-structure detection for fillable formats — a genuinely new, unresolved question** | **Unclear — likely needs either a new AI pass, or a retroactive data-model gap fix upstream, neither of which exists today** | See §4.1 below — this is the one place this phase might need real new AI generation capability, and it's not a small-scale recommend/confirm call the way the format pick is |

### 4.1 The unaddressed structural gap: nothing upstream ever marked *where* a fillable field belongs

Read directly against migration `0006_content.sql`: `subtopic_contents.body` is a single `text` column — **unstructured prose**, with no markup, span-tagging, or field-type metadata distinguishing "this sentence is instructional text" from "this is where the user is meant to write their own entry" or "this should become a checkbox." Step 8's entire content pipeline (`phase6-requirements.md`) was built and reviewed as a pure prose-generation problem — nothing in its guardrails, compliance pass, or specificity check ever needed to think about interactive-field placement, because static prose has no such concept.

**This means Export cannot deterministically know which parts of a `tracker`/`workbook`/`quiz` subtopic's confirmed body should become interactive PDF form fields (or Notion checkboxes) versus which parts stay static text.** Two live options, neither built anywhere in this codebase today:

| Option | What it means | Tradeoff |
|---|---|---|
| **Confirmed (decision 1, §9): a new, scoped AI structure-extraction pass** — a Groq (or similar) call per fillable subtopic, classifying spans of the confirmed body into semantic block types (heading / instructional paragraph / checklist item / user-input blank / table row) | Genuinely new AI-usage category this codebase hasn't needed before — not prose generation (Steps 6–10), not a small enum classification (Step 4), but a **structure-extraction/parsing task over already-confirmed text**. Buildable in principle (same Groq connector, structured JSON-mode output), but untested and adds a new failure mode: the extraction pass could misclassify a plain sentence as a fillable field or vice versa, and there is no deterministic way to check "was this classified correctly" (same honesty Step 9 applied to "is this cover any good," `phase7-requirements.md` §8 rule 5) | Chosen specifically because it keeps the fix entirely on Export's own side |
| ~~Template-defined fixed field zones~~ — **explicitly rejected** | Would have required Step 8's writer prompts to already know they're writing *for* a specific fillable template shape — a retroactive coupling to already-locked, already-confirmed upstream work | **Rejected per decision 1**: Arman does not want Step 8 reopened or touched unless something is actually broken there |

**Confirmed (decision 1, §9): the AI structure-extraction pass, built entirely new on Export's own side, never by reaching back into Step 8.** This remains a genuinely untested capability (no deterministic way to check "was this classified correctly," same honesty Step 9 applied to cover art) — flagged for its own live verification before any orchestration code trusts it, same posture as every new AI capability in this codebase.

---

## 5. Guardrails — What's Actually Checkable, Named Honestly

Document assembly is deterministic engineering, which sounds like it should be *more* checkable than Step 9's un-inspectable image, but real document-format failure modes split unevenly between "trivially checkable" and "no better than Step 9's honesty about pixels."

| # | Rule | Deterministically checkable? | On failure |
|---|---|---|---|
| 1 | A fillable-delivery export's assembled file contains **at least one** real interactive form field (existence check only) | **Yes** — a mechanical count, same shallow-existence-check shape as Step 9's `current_cover_generation_id` non-null rule | Reject; do not persist as a valid fillable export |
| 2 | Every declared form field's position corresponds to a location that actually exists on the rendered page (no field placed off-page or overlapping another) | **Yes, mechanically** — a bounds check against known page dimensions | Reject the specific field, log it, do not silently drop the whole export |
| 3 | The form fields' structure actually matches what the tracker/worksheet's content *means* (right number of checkboxes for a 7-day tracker, a text field where a text field belongs, not a checkbox) | **No — explicitly not checkable.** The new AI structure-extraction pass (decision 1) does the classification, but there is no deterministic way to check "was this classified correctly" — the same honesty Step 9 applied to "is this cover any good" (`phase7-requirements.md` §8 rule 5), a real, disclosed gap, not solved by clever engineering | Falls to the mandatory visual-review gate, decision 4 |
| 4 | The assembled document's page count is roughly proportional to its known confirmed word count (a sanity band, not an exact formula) | **Yes, as a coarse sanity check** — catches a catastrophic rendering bug (e.g., a broken CSS rule collapsing 30,000 words onto three pages) without claiming to validate layout quality | Non-blocking `succeeded_with_warnings` flag, surfaced for human review |
| 5 | No page in the assembled document is entirely blank (a common CSS/pagination-engine failure mode) | **Yes** — a mechanical per-page content-presence check | Non-blocking flag, same as above |
| 6 | A page break does not land mid-sentence or mid-heading | **Not deterministically checkable after the fact** in general — the real mitigation is upstream, at template/CSS-authoring time (`break-inside: avoid` rules on paragraph/heading blocks, per §2.2), not a runtime guardrail. Named here explicitly so it isn't mistaken for something this phase's guardrail layer can catch | Prevention via template CSS discipline; not caught by any check in this table |
| 7 | The cover image actually appears in the assembled file, resolved from a non-null asset path | **Yes** — existence check, same shape as rule 1 | Reject; do not persist an export missing its cover |
| 8 | The produced file is not corrupted — a `.docx`/`.pdf`/`.epub` opens/parses as a structurally valid file of its declared type | **Yes** — a real, cheap post-generation validation pass (re-open the file with the same library that wrote it, or a lightweight format-specific validator) | Reject, retry once, then surface as a hard failure — this is a "did the compile succeed" check, closer to Step 4's malformed-JSON retry than any prior phase's content-quality guardrail |
| 9 | "Is the overall layout/typography any good" (Step 9's own anti-slop layout bar, extended to interior pages) | **No — explicitly, honestly not checkable**, same admission as Step 9 made about cover art. This phase inherits that same limit for interior pages, and does not attempt an AI-judges-its-own-layout pass to compensate, for the identical reasoning `phase7-requirements.md` §8 rule 5 gave | Falls to whatever human-review mechanism §3.2 resolves toward |

---

## 6. Action Model

| Action | What happens | Which table(s) change |
|---|---|---|
| **Get output-format recommendation** (confirmed: explicit action only, no auto-fire — decision 5, §9) | Fires the small Groq recommend/confirm call (§4). Inserts an `export_builds` header row (`recommended_output_format`, `reasoning_summary`, `status='draft'`) | `export_builds`, insert |
| **Confirm output format** (accept-as-is or override) | Sets `confirmed_output_format` on the active header row, `is_override` flag set accordingly — exact mechanics of Step 4's confirm action (`phase2-requirements.md` §3.2) | `export_builds` only |
| **Change output format** (post-confirm) | Same supersede-and-carry-forward shape Step 4 uses (`phase2-requirements.md` §1.2) — no re-run of the recommendation call needed unless explicitly requested | `export_builds` |
| **Generate Export** (the actual assembly run for the confirmed format) | Fires the deterministic assembly pipeline (§4). For fillable delivery mode, also runs the new AI structure-extraction pass (decision 1) plus the field-injection sub-pipeline (§2.1). Inserts one `export_generations` row per attempt | `export_generations`, insert; `export_builds.current_export_generation_id` updated on success |
| **Generate additional format** (a second container for the same project — e.g., PDF already exists, also produce a Docx) | **Confirmed allowed (decision 6, §9)**: same assembly pipeline, different `output_format` value, generated independently without touching the primary confirmed format | `export_generations`, insert, tagged with its own `output_format` |
| **Regenerate Export** (same format, re-run after fixing something) | Same as Generate Export, new log row, same format value | `export_generations`, insert |
| **Approve Export** (confirmed: mandatory visual-review gate, decision 4, §9 — mirrors Step 9's cover-approval mechanics exactly) | Atomic single "Approve" action sets `status='confirmed'`, `approval_status='approved'`, `approved_at`/`approved_by` — same two-field shape as `cover_designs` (`phase7-requirements.md` §7.7). Cannot approve without a non-null current export generation for the confirmed format (existence check only, same honesty as Step 9's own guardrail) | `export_builds` only |
| **Unlock / re-export after an upstream change** | Reverts confirmed export status (and approval fields), same precedent as every prior phase's unlock action; prior artifacts preserved, not deleted | `export_builds` |
| **Download / retrieve current export** | A signed-URL read against the export storage bucket (§8.5) — not a table-mutating action, listed for completeness since every prior phase's action table includes read-only retrieval alongside mutations | None |

---

## 7. Staleness Dependencies

Following the exact soft-staleness convention established since Step 5, with the explicit intent of completing a **full** precedence order in this document's first pass — not leaving a gap the way Step 10's original draft initially did before its own subtopics-list dependency had to be retrofitted (`phase8-requirements.md` §8.3's own note about this).

### 7.1 Does export depend on each upstream artifact?

| Dependency | Depends? | Why |
|---|---|---|
| Title | Yes | Baseline, every phase since Step 5 |
| Confirmed format + delivery mode | **Yes — directly, not just indirectly** | This is the input that decides the fillable-vs-static branch and the output-format recommendation's own reasoning (§4). A format/delivery-mode change after an export was generated could make the existing export structurally wrong (a static export existing when the product is now `fillable`, for instance) |
| Confirmed content bodies | **Yes — the literal interior-page source text** | Direct analog to Step 9's and Step 10's own strongest dependency on Step 8's confirmed content — if body text changes materially after an export was generated, the exported file's pages no longer reflect the real product |
| Approved cover | **Yes** | Export embeds the actual cover pixels (§1); if the cover is unlocked/changed (a new `current_cover_generation_id`, or an unlock reverting `cover_designs.status`), the previously-assembled file's cover page is now stale |
| Confirmed subtopics list | **Not independently — covered transitively via content bodies**, mirroring how Step 9's own staleness set did not separately track the subtopics list once it already tracked `content_build_confirmed_at` (`phase7-requirements.md` §7.10) — a subtopic edit that hasn't yet propagated into regenerated body text is Step 8's own per-row staleness concern, not a second thing Export needs to track independently |
| Step 10's copy | **No** | Confirmed exclusion, §1.1 — no data dependency exists to become stale |

### 7.2 Detection and precedence

| Dependency | Detection | Effect |
|---|---|---|
| Title | FK equality: `export_builds.title_candidate_id` vs. live `projects.selected_candidate_id` | Same technique every phase since Step 5 |
| Format + delivery mode | FK equality: `export_builds.format_recommendation_id` vs. live `projects.current_format_recommendation_id` | Same technique |
| Content bodies | Timestamp comparison: `export_builds.content_build_confirmed_at` vs. live `content_builds.confirmed_at`, falling back to `content_builds.updated_at` when currently unconfirmed — direct reuse of the identical Step 8/9/10 fallback pattern | Same technique |
| Approved cover | Timestamp/FK comparison: `export_builds.cover_generation_id` (or `cover_designs.approved_at` snapshot) vs. live current cover state | Same soft-revert pattern |

**Precedence when multiple are stale simultaneously: title > format/delivery mode > content bodies > cover** — pipeline order, matching the established convention exactly (title first, format second, content third — cover placed last here specifically because it's the most recently-confirmed upstream artifact in pipeline order, consistent with how every prior phase ordered precedence by pipeline position, not by perceived importance).

**Effect, following the established soft-staleness convention:** a confirmed/finalized export reverts to a "needs re-export" state; no `export_generations` row or stored file is deleted — prior artifacts remain retrievable, same "expensive to lose" reasoning every phase since Step 6 has used, arguably stronger here since a full document render (potentially a real compute cost if Puppeteer/Playwright is the chosen engine, §2.2) is more expensive to redo than a text edit.

---

## 8. Data Shape Proposal (reasoning level, not SQL)

### 8.1 Header + append-only log — same shape family as Steps 4/6/9, not reinvented

| Table | Cardinality | Role |
|---|---|---|
| `export_builds` | 1:1 per project | Header — recommended/confirmed output format, reasoning, staleness snapshots (title/format/content/cover, §7), status/lock state |
| `export_generations` | Many per project (one per assembly attempt, across possibly multiple `output_format` values) | Append-only log of every assembly attempt — mirrors `cover_generations`/`copy_generations`' shape, adapted for a file-assembly outcome rather than an AI-generation outcome |
| `export_field_maps` (only if §4.1's dynamic-extraction option is chosen; not needed under the fixed-template-zone option) | Many per fillable `export_generations` row | Records which body-content spans were mapped to which form-field type/position — span-level audit, same granularity precedent as `content_compliance_changes`/`copy_compliance_changes`, applied to structural placement instead of a text rewrite |

### 8.2 Supporting multiple live output formats per project — confirmed, decision 6

Unlike Step 4's format decision (one confirmed value, ever, per project — a genuine either/or about the product's nature), an output-format container is plausibly something a creator wants **more than one of simultaneously** (a PDF for Etsy, a Docx for a buyer who explicitly wants an editable copy). Two shapes, presented without picking one:

| Option | What it means | Tradeoff |
|---|---|---|
| **Strict single-recommendation, Step-4 mirror** | Exactly one active/confirmed output format at a time; changing format supersedes the prior choice, same lifecycle as `format_recommendations` | Simple, consistent with the spec's literal "recommends output format" framing, but doesn't fit the realistic case of wanting a PDF **and** a Docx for the same product without an awkward "change format, lose the other" flow |
| **One recommended default + independently generatable additional formats (recommended)** | `export_builds` holds the Step-4-style recommend/confirm decision for the *primary* format; `export_generations` rows for *other* format values can be produced without touching that primary confirmation — no "current pointer" scalar needed at all, since "the current artifact for format X" can always be read as the most recent successful `export_generations` row for that `(project_id, output_format)` pair, avoiding a second junction table | More flexible, matches how creators plausibly actually work across multiple storefronts, but is a real interpretive stretch beyond the spec's literal single-recommendation phrasing |

**Confirmed (decision 6, §9): the second option.** Multiple output formats can coexist per project (a confirmed PDF and a confirmed Docx both live simultaneously) — more flexibility for Arman as the seller, at the cost of being a real interpretive stretch beyond the spec's literal single-recommendation phrasing.

### 8.3 New enums

| Enum | Proposed values | Notes |
|---|---|---|
| `export_output_format` | `pdf`, `notion_markdown`, `docx` | Confirmed 3-value set (decision 3, §9: reading B, no EPUB pipeline) |
| `export_generation_status` | `succeeded`, `succeeded_with_warnings`, `failed_fallback`, `failed_blocked` | The `succeeded_with_warnings` value is new relative to every prior phase's status enum — covers §5's non-blocking sanity-check failures (rules 4/5), a genuinely different outcome shape than any prior phase's "below target"/"below threshold" values, closer in spirit but not identical |

**Reused enum**: `cover_approval_status` (`pending`/`approved`, migration 0007) reused verbatim for `export_builds.approval_status` — decision 4's mandatory review gate needs exactly the same two-value shape Step 9's cover approval already established, not a new copy of an identical concept.

### 8.4 `projects.status` extension — confirmed (decision 7, §9)

Following the exact pattern every phase since Step 4 has extended `project_status`: `export_generating` (in-progress, analogous to `design_generating`/`copy_generating`) and **`ready_to_download`** (terminal, confirmed) — set the moment an export is approved (decision 4). Unlike Step 9's `cover_approved`, which deliberately declined to claim this exact status (`phase7-requirements.md` decision 5, reasoning that Pricing/Step 12 was also a named precondition), Export is confirmed as the phase that finally resolves this: it is the last content/design/format gate before Pricing, so the deferral ends here rather than continuing further.

### 8.5 Storage — a new bucket, same pattern as `product-covers`, deferred the same way

Export needs to persist real binary files (PDF/Docx/zip-of-markdown/EPUB), which do not belong in a Postgres column any more than Step 9's cover images did. **Recommendation: a new Supabase Storage bucket (e.g. `product-exports`), private, served via short-lived signed URLs** — the exact same shape `lib/cover/storage.ts` already implements for `product-covers` (path convention `{workspace_id}/{project_id}/{export_generation_id}.{ext}`, storage-level RLS policy gated on the same `is_workspace_member()`-equivalent path-prefix check). **Recommendation: defer the concrete bucket/policy design to DEV's build-planning stage, with an explicit review checkpoint before it ships — the exact same deferral Step 9 used** (`phase7-requirements.md` §5.3, decision 17), rather than re-litigating a storage-policy pattern that already worked once. This document's job is flagging the need and the precedent to follow, not re-designing storage policy from scratch.

---

## 9. Decisions Locked (2026-08-27)

| # | Decision |
|---|---|
| 1 | **Fillable field derivation: a new AI structure-extraction pass**, built entirely on Export's own side. Step 8 is not reopened or touched — the fixed-template-field-zone alternative is explicitly rejected because it would require retroactively constraining already-locked upstream content generation. Genuinely untested (no deterministic way to check "was this classified correctly"), flagged for live verification before any orchestration code trusts it. §4.1. |
| 2 | **Notion: a Markdown/HTML self-import export**, not a real OAuth API integration. Matches how every one of PROTO's actual sales channels already works. The OAuth route stays a flagged future idea, not built now. §2.4. |
| 3 | **"Ebook": a specially-styled static PDF, not a real EPUB file.** No new EPUB pipeline. `export_output_format` is a 3-value enum (`pdf`, `notion_markdown`, `docx`). §2.5. |
| 4 | **A mandatory human visual-review/approval gate, mirroring Step 9's cover-approval mechanics exactly** (two fields — `status`/`approval_status` — one atomic "Approve" action). Not a lightweight confirm. §3.2, §6. |
| 5 | **Explicit trigger only, no auto-fire** — consistent with every phase since Step 8, reinforced here by the new real-compute-cost shape a Puppeteer/Playwright-class render could carry. §6. |
| 6 | **Multiple output formats may coexist per project** (a confirmed PDF and a confirmed Docx both live simultaneously) — not a strict single-value, supersede-on-change shape. §8.2. |
| 7 | **Export's terminal `projects.status` value is `ready_to_download`, confirmed.** Unlike Step 9's `cover_approved`, which declined to claim this status pending Pricing (Step 12), Export is confirmed as the phase that resolves this deferral — it is the last content/design/format gate before Pricing. §8.4. |

**Status: Decisions Locked (2026-08-27).** All 7 items above confirmed by Arman. The two genuinely unverified technical claims flagged throughout this document — the PDF geometry-bridging problem (§2.3) and the AI structure-extraction pass's own reliability (§4.1/decision 1) — are not decisions to make, they're live spikes DEV needs to run before trusting either path, the same "verify live, don't trust research" posture every AI-facing or infrastructure-facing increment in this codebase has followed since Step 9. DEV work starts now.
