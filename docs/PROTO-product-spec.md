# PROTO — Product Spec

*A SaaS tool that guides digital product creators through building, designing, pricing, and packaging Notion/PDF/Docx/ebook products — from raw idea to store-ready listing.*

Last updated: August 18, 2026

---

## 1. Vision & Positioning

PROTO productizes the workflow Arman already used to build the Low FODMAP Decoder — structured, research-backed, not "one AI prompt slop." Every stage feeds real data (demand signals, competition gaps, product depth) into the next stage, rather than each feature working in isolation.

**Who it's for:** Built for Arman first. Architected so it *can* open up to other digital product creators later — but that expansion is not committed to yet.

**Core philosophy carried into the product itself:** avoid generic, low-effort output at every stage — layout, imagery, and content all have explicit anti-slop rules (see Section 6).

---

## 2. Architecture Principles (apply across the whole build)

- **Multi-tenant-ready from day one.** Even as a single-user tool, the database is structured with proper user/workspace isolation (not one big personal table) so opening to other users later isn't a rebuild.
- **Offload security-critical logic to managed infrastructure.** Auth via Supabase Auth or Clerk. Payments via Stripe. Data access control via Supabase Row-Level Security (RLS) policies — not hand-written authorization checks scattered through the app. This shrinks the amount of security-critical code being generated from scratch.
- **One non-negotiable review gate before production:** auth flow and RLS policies get checked before anything ships, every time, regardless of which tool (Claude Code, Antigravity, etc.) generated the code.
- **Secrets and API keys** (including user-supplied BYOK keys) are encrypted at rest, never logged, never exposed in error messages or the frontend.
- **Behavioral testing over code review** for non-technical oversight: since Arman isn't reading the code, verification happens by testing behavior (e.g. does User A ever see User B's data) rather than auditing implementation.

---

## 3. Core Product Pipeline

### Step 1 — Input
User provides a **title idea + description/rationale** (why this topic, what trend/gap they're seeing). Not a bare topic — a formed starting concept.

### Step 2 — Title Research & Scoring
- PROTO researches:
  - **Demand signal** — Google autocomplete, related searches, "People Also Ask" (free proxy for active interest)
  - **Competition gap** — live search on Etsy, Gumroad, Google for existing products on that exact angle
- Generates **4 title candidates** (the original title is included in the pool if it scores well — not auto-excluded)
- Each candidate displays two independent scores, top-right: `[Demand X/10] [Competition Y/10]`
- Color-coded independently: green 7+, red under 5, amber in between
- No blended single score — user compares the 4 side by side and judges

### Step 3 — User selects one title

### Step 4 — Format Recommendation
PROTO recommends a format (tracker / workbook / ebook / quiz, printable vs. fillable) with a stated reason, based on the title. **User can override.**

### Step 5 — Lead Magnet Check
PROTO suggests a free companion product **only when the title/niche is clearly suited for it** (not automatic on every product). Two types, whichever fits:
- A stripped-down sample of the same paid product
- A smaller, complete standalone product that funnels into the paid one

### Step 6 — Visceral Transformation Map
Before/after customer journey generated for the chosen title. This shapes what the subtopics need to cover.

### Step 7 — Subtopic Generation
Count and depth driven by format + transformation map (fewer for a tracker, more for an ebook, ~15-ish for workbook+tracker combos).

### Step 8 — Content Builder
- Fresh content researched and written per subtopic (not from Arman's own source material)
- Writing rule baked into generation: **credible sources** (NIH, Mayo Clinic, etc.) **+ cautious framing** (general info, not medical advice) — especially relevant for health-adjacent niches
- **Compliance pass:** auto-detects risky/unsupported health claims and auto-rewrites them to safer versions
- **Visible change log** kept per document (plain-English: "Original → Rewritten, reason") — non-blocking, but gives Arman visibility without needing to read code or review every change

### Step 9 — Design
- **Template-based layout engine** as the primary system (not pure AI image generation) — deliberate typography pairing, real hierarchy, considered whitespace. Each product gets its own distinct look; no fixed brand kit.
- **AI-generated art** (Nano Banana 2) layered into templates for hero images/backgrounds where it adds value — avoids the "obvious AI stock photo" look
- **Required manual approval step:** cover must be approved by Arman before a product can move to "Ready to Download." Options at this stage: accept PROTO's version, upload own image, or AI-assist edit (e.g. "recreate in Eiko Ojala style," "move the title header to middle-left")

### Step 10 — Copywriting
Platform-specific store listings — Gumroad, Etsy, StanStore, Whop (each has different format/length conventions) — plus social promo formats (Pinterest, Instagram captions).

### Step 11 — Export
PROTO recommends output format (PDF / Notion / Docx / ebook) with a stated reason, tied to the format decision from Step 4.
- **Fillable PDF** if the product requires user input (trackers, worksheets, quizzes)
- **Static PDF** if it's pure information (guides, ebooks)

### Step 12 — Pricing Recommendation
Appears **at the very end**, after content and design are finalized (so real depth is known).
- Base price from comparable products currently selling (same source as competition research: Etsy/Gumroad/etc.)
- Adjusted up/down by the Demand/Competition scores from Step 2 (high demand + low competition → price higher)
- Further adjusted by product depth (page count, fillable vs. static — more depth justifies higher price)

---

## 4. Supporting Systems

### Product Library (home/dashboard on login)
- Status: **Draft → In Review → Ready to Download**
- Card view: title, status, last edited date, cover thumbnail (once designed)

### Quality Gate
- **Content:** auto-checked against specificity/voice rules (no genericness, no swappable-into-any-niche writing, matches "care not clout" tone) — handled entirely by PROTO, no manual review required
- **Design:** required manual approval (see Step 9) — the one place Arman stays actively in the loop, since visual taste is inherently subjective

### Anti-Slop Rules (baked into the Design & Content engines)
- **Layout:** no default-centered/templated layouts; real hierarchy; deliberate font pairing (never system defaults); considered whitespace
- **Imagery:** avoid generic AI-stock-photo look; prefer stylized/illustrative art matching brand tone over photorealistic AI images
- **Content:** specificity check — content must reference real, concrete details of the niche; fails if a sentence could paste unchanged into any other niche's product

### Bundle Engine
- Works both **retroactively** (scans the Library for products that pair well) and **proactively** (suggests companion products while building something new)
- Grouping logic: niche relevance **and** journey stage together (not just topic similarity — the actual insight is that buyers often miss related products or find full price prohibitive)
- Bundle price calculated via the same demand/competition pricing engine as single products, displayed as a discount vs. buying items separately

---

## 5. AI Connectors

- **Claude API** — reasoning/writing tasks: content, research, scoring, compliance, copy
- **Nano Banana 2** (Google Gemini image model) — visual tasks: cover generation, style edits, carousel art. Currently the cheapest high-quality image API on the market (~$0.02/image), responds well to natural-language edit instructions.
- **Natural-language router** sits in front of both — user describes what they want ("recreate the cover in Eiko Ojala style"), PROTO routes automatically to the right API. No manual tool-picking.
- **BYOK (Bring Your Own Key) model:** users connect their own Claude, Codex/OpenAI, Gemini, or Grok account and pay the provider directly. PROTO never carries AI usage cost, and never adds a markup.
- **Zero-setup default for users with no AI subscription:** Llama via Groq (genuinely free, no credit card, works out of the box). Understood to be lower quality/speed than paid options — offered as "better than starting with nothing," not a permanent recommendation.
- **Guided setup available** for users who want to upgrade from Llama to Claude/Gemini (simple walkthrough for creating a free-credit account — no technical docs).
- All connector keys encrypted at rest, regardless of provider.

---

## 6. Open Items / Not Yet Decided

- Whether PROTO ever opens to other users beyond Arman, and what that onboarding/pricing model looks like
- Exact technical stack specifics (confirmed direction: Supabase + Next.js, consistent with Arman's existing DEV subagent defaults)
- How the natural-language router is built (intent classification logic between Claude vs. Nano Banana tasks)
- Full guided-setup flow UX for non-technical users creating their first API key
- Mapping this spec onto the SME/DME/GD/DEV/PD subagent pipeline for actual build handoff

---

## 7. Decision Log Reference

Every section above reflects a specific decision made and locked during spec discussion — nothing here is a default assumption. If a future change is needed, revisit the relevant section rather than assuming the original reasoning still applies without checking.
