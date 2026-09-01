# PROTO — Frontend Requirements: Batch 1 (Steps 0–3)

**Scope:** Frontend UI for Steps 0 (Discovery) through 3 (Selection). Backend is fully built (483 passing tests); this spec covers the Next.js app that calls it. No auth flows, no later pipeline steps (Steps 4+), no marketing pages.

**Context:** PROTO is a personal validation tool (single user: Arman) for digital product research. The backend lib functions exist at `/workspace/03_build/lib/`. This doc specifies the React components, API routes, state management, and UX flow needed to surface those functions in a browser.

---

## 1. Global Layout & App Shell

### 1.1 Tech Stack (locked)

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 14 (App Router) | Already initialized via create-next-app |
| Styling | Tailwind CSS | No component library — raw Tailwind only |
| State | React hooks + URL params | No Redux/Zustand; server state via Next.js Server Actions or API routes |
| Database | Supabase client (browser) | Read-only queries for listing candidates; writes via API routes |
| Auth | **Skipped for v1** | Hardcode `workspace_id` in API routes; no login, no user switcher |

### 1.2 App Shell Structure

**File:** `/workspace/03_build/app/layout.tsx`

```tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body className="bg-gray-50 text-gray-900">
        <div className="min-h-screen flex flex-col">
          <Header />
          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
```

**Header component (`/workspace/03_build/components/Header.tsx`):**
- Logo / "PROTO" text (left)
- Navigation: "Dashboard" | "Discover Niches" (Step 0) | No user menu (auth skipped)
- Sticky top, white background, subtle border-bottom

### 1.3 Routing Map

| Route | Purpose | Page file |
|---|---|---|
| `/` | Dashboard (list of projects) | `app/page.tsx` |
| `/discover` | Step 0: Niche Discovery | `app/discover/page.tsx` |
| `/projects/[id]` | Step 1: Input (title + rationale) | `app/projects/[id]/page.tsx` |
| `/projects/[id]/research` | Step 2: Research & Scoring (4 candidates) | `app/projects/[id]/research/page.tsx` |
| `/projects/[id]/select` | Step 3: Selection (pick one of 4) | `app/projects/[id]/select/page.tsx` |

**Navigation flow:**
1. Dashboard → "Discover Niches" → Step 0 → select niche → Step 1 (auto-filled)
2. Dashboard → "New Project" → Step 1 (manual input) → Step 2 → Step 3

**[LOCKED — decision 1]:** Show status badges (`draft` / `researching` / `title_selected`) per project.

---

## 2. Step 0 — Niche Discovery Screen

**Route:** `/discover`

**Purpose:** Let user explore 50 curated niches + optional AI-generated seeds, batch-score them via Etsy research, review results sorted by combined score, and select one to auto-fill Step 1.

### 2.1 Screen Layout

**Top:** Page title "Discover Niches" + subtitle: "Explore validated digital product niches. Select seeds to analyze, then pick one to start a project."

**Seed Selection Panel (left 1/3 or top half on mobile):**
- Category filter checkboxes (e.g., "Notion Productivity", "Finance Templates", "Wedding Planning")
- Displays `SEED_CATEGORIES` from `/lib/discovery/seeds.ts` — each category is a checkbox
- On check, auto-selects all seeds in that category; user sees "X seeds selected" counter
- "Suggest More Niches (AI)" button below filters — triggers AI generation modal (see §2.3)

**Analyze Button:**
- Disabled if 0 seeds selected
- Label: "Analyze [X] Niches" (dynamic count)
- On click → POST to `/api/discover` with selected seed titles → show loading state

**Results Panel (right 2/3 or full-width after loading):**
- Shows top 10 scored niches by default (sorted by `combinedScore` descending)
- Expandable "Show All [X] Results" toggle
- Each result card displays (see §2.2)

### 2.2 Niche Result Card

**Visual structure (Tailwind):**
```
┌─────────────────────────────────────────────────────┐
│ Notion Budget Tracker for Freelancers              │ (title, text-lg font-semibold)
│ Overall: 7.0/10 ███████░░░ (70% width bar)          │
├─────────────────────────────────────────────────────┤
│ Demand:      8/10 ████████░░ (green badge)          │
│ Competition: 6/10 ██████░░░░ (amber badge)          │
├─────────────────────────────────────────────────────┤
│ Why: Freelancers need expense tracking; Notion      │ (rationale, text-sm text-gray-700)
│      format underserved vs Excel (127 listings).    │
│                                                     │
│ Market: 127 exact-angle listings, $12–$29 range     │ (market size + price, text-xs text-gray-600)
│                                                     │
│ Examples:                                           │ (top 3 listing titles, text-xs italic)
│  • Freelance Budget Planner | Notion Template      │
│  • Notion Budget Tracker + Expense Log             │
│  • Monthly Budget Template for Self-Employed       │
│                                                     │
│ [Select This Niche →]                              │ (primary button, full-width)
└─────────────────────────────────────────────────────┘
```

**Color coding (decision 8 from step0-requirements):**
- Green: `bg-green-100 text-green-800 border-green-300`
- Amber: `bg-amber-100 text-amber-800 border-amber-300`
- Red: `bg-red-100 text-red-800 border-red-300`

**"Select This Niche →" button behavior:**
1. POST to `/api/projects` with `{ title: niche.seed, rationale: niche.rationale, workspace_id }`
2. Creates a new project row + title_ideas row
3. Redirects to `/projects/[new_project_id]` (Step 1 with fields pre-filled)

### 2.3 AI Seed Generation Modal

**Trigger:** "Suggest More Niches (AI)" button in seed selection panel

**Modal contents:**
- Title: "AI-Generated Niche Ideas"
- Input: Number of seeds (slider: 10–30, default 20)
- Warning text: "AI suggestions are experimental. Review before analyzing." (decision from step0-requirements §11)
- "Generate" button → POST to `/api/discover/generate` → loading spinner → appends results to seed pool
- Generated seeds appear as new checkboxes below curated categories (label: "AI-Generated")
- User can then select/deselect AI seeds like curated ones before clicking "Analyze [X] Niches"

**[LOCKED — decision 2]:** Session-ephemeral. AI-generated seeds are lost on page refresh.

---

## 3. Step 1 — Input Screen

**Route:** `/projects/[id]`

**Purpose:** Capture or edit the project's original title + rationale. Can arrive here from Step 0 auto-fill or manual "New Project" creation.

### 3.1 Screen Layout

**Header:**
- Breadcrumb: "Dashboard > [Project ID or Title]"
- Step indicator: "Step 1 of 3: Title Idea Input"

**Form Fields:**
- **Title** (text input, required, 10–100 chars)
  - Placeholder: "e.g., Notion Budget Tracker for Freelancers"
  - Label: "Product Title Idea"
  - Helper text: "Describe the product concept — be specific enough for research."
- **Rationale** (textarea, required, 20–500 chars)
  - Placeholder: "e.g., Freelancers need expense tracking tailored to irregular income..."
  - Label: "Why This Niche?"
  - Helper text: "Explain the gap, audience, or trend this product addresses."

**Buttons:**
- "Save Draft" (secondary) → PUT to `/api/projects/[id]` → updates `title_ideas` row, stays on page
- "Research This Title →" (primary) → triggers Step 2 research (see §4.1)

**Auto-fill behavior (from Step 0):**
- If user arrived via "Select This Niche" in Step 0, fields are pre-populated from discovery result
- User can edit before clicking "Research This Title"
- No visual indicator that this was auto-filled vs manually entered (it's just initial state)

**[LOCKED — decision 3]:** Add "I don't have an idea yet" link that redirects to `/discover`.

### 3.2 Mutability (per phase1-requirements §1.3)

- `title_ideas` is **mutable** — user can edit title/rationale before or between research runs
- "Save Draft" updates the DB without triggering research
- "Research This Title" also saves the current values before starting Step 2

---

## 4. Step 2 — Research & Scoring Screen

**Route:** `/projects/[id]/research`

**Purpose:** Show the 4-candidate scoring results (original + 3 variants). Display demand/competition scores, market context, and allow re-running research or proceeding to selection.

### 4.1 Triggering Research

**From Step 1:** Clicking "Research This Title →" button:
1. POST to `/api/research` with `{ projectId, workspaceId, originalTitle, rationale }`
2. Backend calls `runResearch()` (from `/lib/research/runResearch.ts`) — creates `research_run` + 4 `title_candidates`
3. Redirects to `/projects/[id]/research` with loading state → polls or SSE to show progress

**[LOCKED — decision 4]:** Async with polling. POST returns `runId` immediately, frontend polls `/api/research/[runId]/status` every 2s until complete.

### 4.2 Screen Layout (Research Complete)

**Header:**
- Breadcrumb: "Dashboard > [Project Title] > Research"
- Step indicator: "Step 2 of 3: Research & Scoring"
- Run number badge: "Run #2" (if user re-ran research)

**Candidate Cards (4 total, vertical stack):**

Each card shows:
```
┌─────────────────────────────────────────────────────┐
│ [ORIGINAL] Notion Budget Tracker for Freelancers   │ (is_original badge if applicable)
│                                                     │
│ Demand:      8/10 ████████░░ (green)                │
│ Competition: 6/10 ██████░░░░ (amber)                │
│                                                     │
│ Market Context:                                     │ (collapsed by default, expandable)
│  • 127 exact-angle listings found                   │
│  • Price range: $12–$29                             │
│  • Avg favorites: 42, Avg views: 1,203              │
│                                                     │
│ [View Details] [Select This Candidate →]           │
└─────────────────────────────────────────────────────┘
```

**3 variant cards show their generation_axis:**
- "Niche Down" badge for `niche_down`
- "Format Variant" badge for `format_hint`
- "Keyword Optimized" badge for `keyword_optimized`

**Bottom Actions:**
- "Re-run Research" (secondary) → confirms "This will generate 4 new candidates. Proceed?" → POST to `/api/research` → reloads page
- "I'm Ready to Choose" (primary) → redirects to `/projects/[id]/select`

**[LOCKED — decision 5]:** Human-readable summary bullets by default, with optional "Show raw data" toggle for debug.

### 4.3 Re-run Behavior (per phase1-requirements §1.3)

- Re-running research creates a **new `research_run`** and new set of 4 candidates
- Old runs remain in DB but are not shown by default (UI shows latest run only)
- `projects.selected_candidate_id` is **cleared** on re-run (Step 3 must be redone)
- No confirmation modal if project is in `draft` or `researching` state; confirmation required if `status = title_selected` (warns "You already selected a title; re-running will clear that selection")

---

## 5. Step 3 — Selection Screen

**Route:** `/projects/[id]/select`

**Purpose:** User reviews the 4 candidates side-by-side and picks one to lock in.

### 5.1 Screen Layout

**Header:**
- Breadcrumb: "Dashboard > [Project Title] > Select Title"
- Step indicator: "Step 3 of 3: Select Your Title"

**Candidate Comparison Table (desktop) or Card Stack (mobile):**

**Desktop (table):**
| Candidate | Demand | Competition | Overall | Actions |
|---|---|---|---|---|
| [ORIGINAL] Notion Budget Tracker for Freelancers | 8/10 🟢 | 6/10 🟡 | 7.0 | [Select] |
| [Niche Down] Notion Budget Tracker for Crypto Freelancers | 6/10 🟡 | 8/10 🟢 | 7.0 | [Select] |
| [Format Variant] Notion Freelance Budget System | 7/10 🟢 | 7/10 🟢 | 7.0 | [Select] |
| [Keyword Opt.] Freelance Budget Planner Notion Template | 9/10 🟢 | 5/10 🟡 | 7.0 | [Select] |

**Mobile (cards):**
Same card structure as Step 2, but with "Select This Title" button in footer.

**Selection Flow:**
1. User clicks "Select" button on a candidate
2. Confirmation modal: "Lock in this title? You can change it later but will need to unlock first."
3. On confirm → POST to `/api/projects/[id]/select` with `{ candidateId }`
4. Backend:
   - Sets `projects.selected_candidate_id = candidateId`
   - Sets `projects.status = 'title_selected'`
   - Inserts row into `title_selections` log
5. Redirects to `/projects/[id]` with success banner: "Title selected! [Next: Format Recommendation →]" (grayed out, not implemented in Batch 1)

**[LOCKED — decision 6]:** Show generation axis labels ("Niche Down", "Format Variant", "Keyword Optimized") in selection table.

### 5.2 Lock/Unlock Behavior (per phase1-requirements §1.4)

**If `status = title_selected`:**
- Show banner: "Title locked. [Change Selection] to pick a different candidate or re-run research."
- All "Select" buttons disabled except "Change Selection" link
- "Change Selection" link:
  1. Confirms "This will unlock your selection. You'll need to re-select a candidate."
  2. On confirm → PUT to `/api/projects/[id]/unlock`
  3. Backend sets `projects.status = 'researching'`, clears `selected_candidate_id`
  4. Reloads page → selection buttons re-enabled

**If user re-runs research from Step 2 while `status = title_selected`:**
- Confirmation modal (from §4.3) warns about clearing selection
- If user proceeds, new research run auto-unlocks selection

---

## 6. API Routes Needed

All routes return JSON. Authentication skipped for v1 — hardcode `workspace_id` in API logic.

### 6.1 Discovery Routes

| Route | Method | Purpose | Request Body | Response | Backend Call |
|---|---|---|---|---|---|
| `/api/discover` | POST | Batch-score selected seeds | `{ seeds: string[] }` (array of seed titles) | `{ niches: ScoredNiche[], elapsedMs: number }` | `runDiscovery({ seeds: [CuratedSeed objects], concurrency: 6 })` |
| `/api/discover/generate` | POST | AI seed generation | `{ count: number }` | `{ seeds: GeneratedSeed[] }` | `generateSeeds({ count })` |

**Implementation notes:**
- `/api/discover` POST handler:
  1. Receives array of seed title strings
  2. Maps to `CuratedSeed` objects by looking up in `CURATED_SEEDS` array
  3. Calls `runDiscovery()` from `/lib/discovery/runDiscovery.ts`
  4. Returns ephemeral results (no DB writes per decision 12)

- `/api/discover/generate` POST handler:
  1. Calls `generateSeeds()` from `/lib/discovery/generateSeeds.ts`
  2. Returns array of `{ title, rationale }` objects
  3. Frontend appends to seed selection pool (no persistence)

### 6.2 Project Management Routes

| Route | Method | Purpose | Request Body | Response | Backend Call |
|---|---|---|---|---|---|
| `/api/projects` | POST | Create new project (from Step 0 or manual) | `{ title: string, rationale: string, workspace_id: string }` | `{ projectId: string }` | INSERT into `projects` + `title_ideas` |
| `/api/projects/[id]` | GET | Fetch project + latest research run | - | `{ project: {...}, titleIdeas: {...}, latestRun?: {...} }` | Supabase SELECT with joins |
| `/api/projects/[id]` | PUT | Update title/rationale (Step 1 edit) | `{ title: string, rationale: string }` | `{ ok: true }` | UPDATE `title_ideas` |
| `/api/projects/[id]/unlock` | PUT | Unlock selection (§5.2) | - | `{ ok: true }` | UPDATE `projects` SET `status='researching'`, `selected_candidate_id=null` |
| `/api/projects/[id]/select` | POST | Lock in a candidate (Step 3) | `{ candidateId: string }` | `{ ok: true }` | UPDATE `projects`, INSERT `title_selections` |

### 6.3 Research Routes

| Route | Method | Purpose | Request Body | Response | Backend Call |
|---|---|---|---|---|---|
| `/api/research` | POST | Run full research (4 candidates) | `{ projectId: string, workspaceId: string, originalTitle: string, rationale: string }` | `{ runId: string, candidates: [...] }` | `runResearch()` from `/lib/research/runResearch.ts` |
| `/api/research/[runId]/status` | GET | Poll research progress (if async) | - | `{ status: 'pending' \| 'completed' \| 'failed', candidates?: [...] }` | SELECT `research_runs` + `title_candidates` |

**Implementation notes:**
- If research is synchronous (decision pending in §4.1), `/api/research` POST blocks until `runResearch()` completes (~10-20s)
- If async, POST returns immediately with `runId`, frontend polls `/api/research/[runId]/status` every 2s

**[LOCKED — decision 4]:** Async with polling. POST `/api/research` returns `runId`, frontend polls every 2s.

---

## 7. Shared Components

All components in `/workspace/03_build/components/`.

### 7.1 `<ScoreBadge>`

**Props:** `{ score: number, color: ScoreColor, label?: string }`

**Renders:**
```tsx
<div className="inline-flex items-center gap-2">
  {label && <span className="text-sm font-medium">{label}:</span>}
  <span className={`px-2 py-1 rounded text-sm font-semibold ${colorClass}`}>
    {score}/10
  </span>
  <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
    <div className={`h-full ${bgColorClass}`} style={{ width: `${score * 10}%` }} />
  </div>
</div>
```

**Color mapping:**
- `green`: `bg-green-100 text-green-800` badge, `bg-green-500` bar
- `amber`: `bg-amber-100 text-amber-800` badge, `bg-amber-500` bar
- `red`: `bg-red-100 text-red-800` badge, `bg-red-500` bar

### 7.2 `<CandidateCard>`

**Props:** `{ candidate: TitleCandidate, onSelect?: () => void, showDetails?: boolean }`

**Renders:** Card structure from §4.2, with optional "Select" button if `onSelect` provided.

**Expandable details:** Click "View Details" toggles visibility of `demand_signal_detail` and `competition_signal_detail` JSON (pretty-printed or summary bullets — see open decision §4.2).

### 7.3 `<LoadingSpinner>`

**Props:** `{ message?: string }`

**Renders:** Centered spinner (Tailwind `animate-spin` on SVG) + optional message below.

### 7.4 `<ConfirmModal>`

**Props:** `{ title: string, message: string, confirmLabel: string, onConfirm: () => void, onCancel: () => void }`

**Renders:** Overlay modal with title, message, two buttons (Cancel / Confirm).

**Used for:**
- Re-run research confirmation
- Selection lock-in confirmation
- Unlock selection confirmation

---

## 8. State Management

**No global state library (Redux/Zustand).** Data flow per screen:

### 8.1 Step 0 (Discovery)

**Client state (React `useState`):**
- `selectedSeeds: string[]` — which seeds are checked
- `discoveryResults: ScoredNiche[] | null` — API response after "Analyze" clicked
- `loading: boolean`
- `aiModalOpen: boolean`
- `generatedSeeds: GeneratedSeed[]` — appended after AI generation

**Persistence:** None (ephemeral per decision 12). Page refresh resets selection.

**[LOCKED — decision 2]:** Session-ephemeral. Re-generate required after refresh.

### 8.2 Step 1 (Input)

**Server state (fetch on page load via Next.js server component or `useEffect`):**
- Load project + title_ideas from `/api/projects/[id]`
- Pre-fill form with existing `title` / `rationale`

**Client state:**
- `title: string`, `rationale: string` — controlled inputs
- `saving: boolean` — "Save Draft" loading state

**Mutations:**
- "Save Draft" → PUT `/api/projects/[id]` with current form values
- "Research This Title" → POST `/api/research` then redirect

### 8.3 Step 2 (Research)

**Server state:**
- Load latest research run + 4 candidates from `/api/projects/[id]`
- Display candidates sorted by `display_order`

**Client state:**
- `expandedCandidateId: string | null` — which card's details are expanded

**No writes** (read-only screen) — user either re-runs research (new POST) or proceeds to Step 3.

### 8.4 Step 3 (Selection)

**Server state:**
- Load project + latest candidates from `/api/projects/[id]`
- Check if `selected_candidate_id` is set (locked state)

**Client state:**
- `confirmingCandidateId: string | null` — which candidate's selection is pending confirmation

**Mutation:**
- "Select" → opens confirm modal → POST `/api/projects/[id]/select` → redirects

---

## 9. Tailwind Styling Conventions

**No component library.** All styling via Tailwind utility classes.

### 9.1 Typography Scale

| Element | Classes |
|---|---|
| Page title | `text-3xl font-bold text-gray-900` |
| Section heading | `text-xl font-semibold text-gray-800` |
| Card title | `text-lg font-semibold text-gray-900` |
| Body text | `text-base text-gray-700` |
| Helper text | `text-sm text-gray-600` |
| Label | `text-sm font-medium text-gray-700` |

### 9.2 Button Styles

| Type | Classes |
|---|---|
| Primary | `bg-blue-600 text-white px-4 py-2 rounded-md font-medium hover:bg-blue-700 disabled:opacity-50` |
| Secondary | `bg-gray-200 text-gray-800 px-4 py-2 rounded-md font-medium hover:bg-gray-300` |
| Danger | `bg-red-600 text-white px-4 py-2 rounded-md font-medium hover:bg-red-700` |

### 9.3 Card Styles

```
border border-gray-200 rounded-lg bg-white p-4 shadow-sm hover:shadow-md transition-shadow
```

### 9.4 Input Styles

```
border border-gray-300 rounded-md px-3 py-2 text-base focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none
```

**Textarea:** Same + `resize-none min-h-[100px]`

---

## 10. Decisions (All Locked)

All 6 decisions confirmed by Arman on 2026-09-01.

| # | Decision | Context | Resolution |
|---|---|---|---|
| 1 | Dashboard project status badges | §1.3 | **Show badges** — display `draft`/`researching`/`title_selected` status per project |
| 2 | AI seed persistence | §2.3 | **Session-ephemeral** — lost on refresh, aligns with Step 0 ephemeral design |
| 3 | "I don't have an idea" link placement | §3.1 | **Add link** — "I don't have an idea yet" in Step 1 redirects to `/discover` |
| 4 | Research sync vs async | §4.1 | **Async with polling** — POST returns `runId`, frontend polls `/api/research/[runId]/status` every 2s |
| 5 | Market context detail level | §4.2 | **Human-readable bullets** + optional "Show raw data" toggle for debug |
| 6 | Generation axis visibility | §5.1 | **Show labels** — "Niche Down" / "Format Variant" / "Keyword Optimized" visible in selection table |

---

## 11. Hardcoded Workspace ID (Auth Bypass)

**For v1 (single-user localhost):**

All API routes hardcode:
```ts
const HARDCODED_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';
```

**Where used:**
- POST `/api/projects` — insert with this `workspace_id`
- POST `/api/research` — passed to `runResearch()`
- All GET queries — filter by `workspace_id = HARDCODED_WORKSPACE_ID`

**Supabase RLS:** Disable RLS policies in dev (or create a service-role bypass) since no `auth.uid()` exists yet.

**Migration to multi-tenant:**
When auth is added later, replace hardcoded ID with `auth.uid()` → `workspace_id` lookup via `workspace_members` table (already in schema per phase1-requirements §1.1).

---

## 12. File Structure Overview

```
workspace/03_build/
├─ app/
│  ├─ layout.tsx                 (root layout with Header)
│  ├─ page.tsx                   (dashboard)
│  ├─ discover/
│  │  └─ page.tsx                (Step 0: Discovery)
│  ├─ projects/
│  │  └─ [id]/
│  │     ├─ page.tsx             (Step 1: Input)
│  │     ├─ research/
│  │     │  └─ page.tsx          (Step 2: Research)
│  │     └─ select/
│  │        └─ page.tsx          (Step 3: Selection)
│  └─ api/
│     ├─ discover/
│     │  ├─ route.ts             (POST batch scoring)
│     │  └─ generate/
│     │     └─ route.ts          (POST AI seeds)
│     ├─ projects/
│     │  ├─ route.ts             (POST create, GET list)
│     │  └─ [id]/
│     │     ├─ route.ts          (GET, PUT project)
│     │     ├─ unlock/
│     │     │  └─ route.ts       (PUT unlock selection)
│     │     └─ select/
│     │        └─ route.ts       (POST lock selection)
│     └─ research/
│        ├─ route.ts             (POST run research)
│        └─ [runId]/
│           └─ status/
│              └─ route.ts       (GET poll status)
├─ components/
│  ├─ Header.tsx                 (global nav)
│  ├─ ScoreBadge.tsx             (demand/competition score display)
│  ├─ CandidateCard.tsx          (reusable candidate UI)
│  ├─ LoadingSpinner.tsx         (spinner + message)
│  └─ ConfirmModal.tsx           (reusable modal)
├─ lib/                          (existing backend — DO NOT MODIFY)
│  ├─ discovery/
│  │  ├─ types.ts
│  │  ├─ seeds.ts
│  │  ├─ generateSeeds.ts
│  │  └─ runDiscovery.ts
│  ├─ research/
│  │  ├─ runResearch.ts
│  │  └─ researchTitle.ts
│  └─ scoring/
│     └─ types.ts
└─ ...
```

---

## 13. Success Criteria (Definition of Done)

Frontend Batch 1 is complete when:

1. User can navigate `/discover` → select curated seeds → analyze → see scored niches → select one → auto-fills Step 1
2. User can manually create project via dashboard → fill Step 1 → research → see 4 candidates with scores → select one
3. All 6 API routes (§6) return correct data from backend lib functions
4. Step 0 generates AI seeds via "Suggest More" button
5. Step 2 displays demand/competition scores with color badges (green/amber/red)
6. Step 3 locks selection into `title_selected` state, blocks re-selection without unlock
7. Re-running research clears prior selection and creates new run
8. No console errors, no broken styles, mobile-responsive (Tailwind breakpoints)

**Not in scope for Batch 1:**
- Authentication (hardcoded workspace_id)
- Steps 4+ (format recommendation, transformation map, etc.)
- Real-time collaboration, multiplayer features
- Export/CSV features
- Admin dashboard, analytics

---

## 14. Technical Debt & Future Enhancements

**Known limitations to revisit post-v1:**

| Item | Description | Future Solution |
|---|---|---|
| Hardcoded workspace_id | Auth bypass for single user | Implement Supabase Auth + RLS before multi-user |
| Ephemeral Step 0 results | No history of past discovery runs | Add `niche_discovery_runs` table per step0-requirements §5.2 |
| Synchronous research (if chosen) | 20s blocking request | Migrate to async + SSE or polling |
| No partial-signal degradation | Research fails entirely if Etsy errors | Revisit once Google Trends is added (independent fallback signal) |
| Raw JSON signal details | Developer-facing, not user-friendly | Build human-readable "Why this score?" explanation UI |
| No undo on selection lock | Must unlock explicitly | Add selection history / undo stack |

---

## 15. Migration from Boilerplate

**Current state:** `/workspace/03_build` is Next.js create-next-app boilerplate.

**Migration steps:**
1. Install Tailwind CSS (if not already present): `npm install -D tailwindcss postcss autoprefixer`, `npx tailwindcss init -p`
2. Configure `tailwind.config.js` content paths: `content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}']`
3. Add Tailwind directives to `app/globals.css`: `@tailwind base; @tailwind components; @tailwind utilities;`
4. Install Supabase client: `npm install @supabase/supabase-js`
5. Create `.env.local` with:
   ```
   NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
   ETSY_DATA_SOURCE=mock  # or 'real' once Etsy key is live
   ETSY_API_KEY=<keystring:sharedSecret>
   GROQ_API_KEY=<your-groq-key>
   ```
6. Create `/lib/supabase.ts` client singleton:
   ```ts
   import { createClient } from '@supabase/supabase-js';
   export const supabase = createClient(
     process.env.NEXT_PUBLIC_SUPABASE_URL!,
     process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
   );
   ```
7. Delete boilerplate pages, replace with structure from §12

---

## 16. Decisions Locked

All decisions marked as locked (not `[OPEN]`) are final unless explicitly flagged for PD review.

| # | Decision | Notes |
|---|---|---|
| 1 | Tailwind CSS only, no component library | Locked per user requirement |
| 2 | Steps 0-3 only (no later pipeline in Batch 1) | Locked per scope definition |
| 3 | Skip auth, hardcode workspace_id | Locked for v1 (single user, localhost) |
| 4 | Exactly 4 candidates per research run | Locked per phase1-requirements decision 7 |
| 5 | Combined score = (demand + competition) / 2 | Locked per step0-requirements decision 8 |
| 6 | Step 0 results ephemeral (no DB writes) | Locked per step0-requirements decision 12 |
| 7 | Selection locks project into `title_selected` state | Locked per phase1-requirements decision 11 |
| 8 | Re-run research clears prior selection | Locked per phase1-requirements §1.3 |
| 9 | Discovery uses `runDiscovery()` from lib | Locked (calls existing backend function) |
| 10 | Research uses `runResearch()` from lib | Locked (calls existing backend function) |

---

**End of Frontend Requirements — Batch 1 (Steps 0–3)**

**Next Steps:**
1. Resolve 6 open decisions (§10)
2. Implement API routes (§6) to bridge frontend ↔ backend lib
3. Build React components per screen specs (§2–5)
4. Test end-to-end flow: Discovery → Input → Research → Selection
5. Deploy to localhost, smoke-test with real Etsy API (decision 17 confirmed working)
