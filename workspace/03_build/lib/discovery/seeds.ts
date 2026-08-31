import type { CuratedSeed } from './types';

/**
 * 50-niche curated seed library for Step 0 discovery. AI-assisted curation from
 * real Etsy trend reports, marketplace data, and proven digital product categories
 * (decision 2). Organized by category for filtering in the UI.
 *
 * Each seed is a specific-enough product title to produce meaningful Etsy search
 * results and exact-angle classification — not a broad keyword like "planner" but
 * a targeted niche like "Notion Meal Planner for Families."
 *
 * Categories:
 *   notion-productivity  — Notion templates for workflows, tracking, and planning
 *   finance-templates    — Budget trackers, expense logs, financial planning tools
 *   wedding-planning     — Wedding checklists, guest lists, timelines, budgets
 *   digital-planners     — Digital planners for tablets (GoodNotes, Remarkable)
 *   education            — Study guides, lesson plans, student organizers
 *   small-business       — Business tools, invoicing, client management
 *   health-wellness      — Fitness trackers, meal plans, habit logs
 *   creative-freelance   — Portfolio trackers, project management for creatives
 *   social-media         — Content calendars, analytics trackers, post planners
 *   home-organization    — Cleaning schedules, home inventory, declutter guides
 */
export const CURATED_SEEDS: readonly CuratedSeed[] = [
  // ── notion-productivity ──────────────────────────────────────────────────
  {
    title: 'Notion Budget Tracker for Freelancers',
    category: 'notion-productivity',
    rationale: 'Freelancers need expense tracking tailored to irregular income; Notion format underserved vs Excel templates.',
  },
  {
    title: 'Notion Habit Tracker Dashboard',
    category: 'notion-productivity',
    rationale: 'Habit tracking is a proven self-improvement niche; dashboard format adds visual appeal over simple checklists.',
  },
  {
    title: 'Notion Project Management Template for Solopreneurs',
    category: 'notion-productivity',
    rationale: 'Solopreneurs want lightweight project management without enterprise tool complexity.',
  },
  {
    title: 'Notion Reading List and Book Notes Template',
    category: 'notion-productivity',
    rationale: 'Book lovers want organized reading logs with notes; Notion database format suits this well.',
  },
  {
    title: 'Notion Content Calendar for Creators',
    category: 'notion-productivity',
    rationale: 'Creators need multi-platform content scheduling; Notion offers flexible database views.',
  },

  // ── finance-templates ────────────────────────────────────────────────────
  {
    title: 'Monthly Budget Spreadsheet Google Sheets',
    category: 'finance-templates',
    rationale: 'Monthly budgeting is an evergreen need; Google Sheets format is accessible and shareable.',
  },
  {
    title: 'Savings Goal Tracker Printable',
    category: 'finance-templates',
    rationale: 'Visual savings trackers motivate consistent saving; printable format popular for physical planners.',
  },
  {
    title: 'Small Business Expense Tracker Excel',
    category: 'finance-templates',
    rationale: 'Small business owners need simple expense categorization before graduating to accounting software.',
  },
  {
    title: 'Debt Payoff Planner Spreadsheet',
    category: 'finance-templates',
    rationale: 'Debt snowball/avalanche methods are widely taught; spreadsheet tools make the math actionable.',
  },
  {
    title: 'Side Hustle Income Tracker Template',
    category: 'finance-templates',
    rationale: 'Gig economy workers juggle multiple income streams; a unified tracker simplifies tax prep.',
  },

  // ── wedding-planning ─────────────────────────────────────────────────────
  {
    title: 'Wedding Guest List Template Google Sheets',
    category: 'wedding-planning',
    rationale: 'Guest list management is the first planning task every couple faces; spreadsheet format allows RSVP tracking.',
  },
  {
    title: 'Wedding Budget Tracker Spreadsheet',
    category: 'wedding-planning',
    rationale: 'Wedding costs spiral without tracking; budget templates with category breakdowns are in high demand.',
  },
  {
    title: 'Wedding Day Timeline Template',
    category: 'wedding-planning',
    rationale: 'Day-of coordination is stressful; a structured timeline template reduces chaos for DIY weddings.',
  },
  {
    title: 'Bridal Shower Games Printable Bundle',
    category: 'wedding-planning',
    rationale: 'Bridal shower hosts want ready-to-print game packs; bundles command higher prices than singles.',
  },
  {
    title: 'Wedding Seating Chart Template',
    category: 'wedding-planning',
    rationale: 'Seating arrangements are logistically complex; drag-and-drop or printable templates save hours.',
  },

  // ── digital-planners ─────────────────────────────────────────────────────
  {
    title: 'Digital Planner for GoodNotes iPad',
    category: 'digital-planners',
    rationale: 'GoodNotes is the dominant iPad planner app; hyperlinked PDF planners are a proven Etsy category.',
  },
  {
    title: 'Digital Budget Planner for Tablets',
    category: 'digital-planners',
    rationale: 'Combines the appeal of digital planning with finance tracking; tablet-optimized format growing.',
  },
  {
    title: 'Student Digital Planner with Study Schedule',
    category: 'digital-planners',
    rationale: 'Students want academic planners that sync with tablet workflows; study schedule integration adds value.',
  },
  {
    title: 'Digital Fitness Planner with Workout Log',
    category: 'digital-planners',
    rationale: 'Fitness enthusiasts want progress tracking on tablets; workout log format complements meal planning.',
  },
  {
    title: 'Digital Recipe Book Template',
    category: 'digital-planners',
    rationale: 'Home cooks want organized recipe collections on tablets; hyperlinked categories add navigation.',
  },

  // ── education ────────────────────────────────────────────────────────────
  {
    title: 'Homeschool Lesson Planner Printable',
    category: 'education',
    rationale: 'Homeschooling families need structured lesson planning; printable format fits binder-based workflows.',
  },
  {
    title: 'Study Guide Template for College Students',
    category: 'education',
    rationale: 'College students want structured study guides; template format helps organize course material.',
  },
  {
    title: 'Teacher Lesson Plan Template Weekly',
    category: 'education',
    rationale: 'Teachers need weekly planning templates; pre-structured formats save hours of prep work.',
  },
  {
    title: 'Flashcard Template Printable Study Cards',
    category: 'education',
    rationale: 'Active recall via flashcards is a proven study method; printable templates are low-cost to produce.',
  },
  {
    title: 'IEP Goal Tracking Sheet for Parents',
    category: 'education',
    rationale: 'Parents of special needs students need IEP progress tracking; niche but underserved market.',
  },

  // ── small-business ───────────────────────────────────────────────────────
  {
    title: 'Client Onboarding Checklist Template',
    category: 'small-business',
    rationale: 'Service businesses need repeatable onboarding; checklists reduce missed steps and look professional.',
  },
  {
    title: 'Invoice Template for Freelancers',
    category: 'small-business',
    rationale: 'Freelancers want branded invoice templates before investing in invoicing software.',
  },
  {
    title: 'Social Media Audit Template',
    category: 'small-business',
    rationale: 'Businesses reviewing their social presence need structured audit frameworks; consultants resell these.',
  },
  {
    title: 'Business Plan Template for Startups',
    category: 'small-business',
    rationale: 'First-time founders need structured business plan outlines; template format reduces blank-page anxiety.',
  },
  {
    title: 'Etsy Shop Planner for New Sellers',
    category: 'small-business',
    rationale: 'New Etsy sellers need launch checklists and listing planners; meta-niche with built-in audience.',
  },

  // ── health-wellness ──────────────────────────────────────────────────────
  {
    title: 'Meal Prep Planner with Grocery List',
    category: 'health-wellness',
    rationale: 'Meal prepping saves time and money; combined planner + grocery list format is highly practical.',
  },
  {
    title: 'Fitness Workout Log Printable',
    category: 'health-wellness',
    rationale: 'Gym-goers want simple workout tracking; printable format works for those who prefer paper logs.',
  },
  {
    title: 'Mental Health Journal Prompts Printable',
    category: 'health-wellness',
    rationale: 'Mental health awareness drives demand for guided journaling; prompts lower the barrier to starting.',
  },
  {
    title: 'Water Intake Tracker Printable',
    category: 'health-wellness',
    rationale: 'Simple hydration tracking is a gateway wellness product; low production cost, high perceived value.',
  },
  {
    title: 'Sleep Tracker Template Monthly',
    category: 'health-wellness',
    rationale: 'Sleep quality awareness is growing; monthly tracking format helps identify patterns.',
  },

  // ── creative-freelance ───────────────────────────────────────────────────
  {
    title: 'Photography Client Contract Template',
    category: 'creative-freelance',
    rationale: 'Photographers need legal-sounding contracts without hiring lawyers; templates fill this gap.',
  },
  {
    title: 'Freelance Rate Calculator Spreadsheet',
    category: 'creative-freelance',
    rationale: 'Freelancers chronically underprice; a structured calculator helps set sustainable rates.',
  },
  {
    title: 'Portfolio Website Planner Template',
    category: 'creative-freelance',
    rationale: 'Creatives building portfolios need content planning before design; structured templates help organize.',
  },
  {
    title: 'Commission Pricing Guide for Artists',
    category: 'creative-freelance',
    rationale: 'Artists struggle with pricing commissions; guides with formulas and examples command premium prices.',
  },
  {
    title: 'YouTube Video Planning Template',
    category: 'creative-freelance',
    rationale: 'YouTubers need structured pre-production workflows; script + shot list templates save editing time.',
  },

  // ── social-media ─────────────────────────────────────────────────────────
  {
    title: 'Instagram Content Calendar Template',
    category: 'social-media',
    rationale: 'Consistent posting drives growth; calendar templates help plan content themes and posting schedules.',
  },
  {
    title: 'TikTok Content Ideas Planner',
    category: 'social-media',
    rationale: 'TikTok creators need content ideation frameworks; planners with trend hooks and posting cadence.',
  },
  {
    title: 'Pinterest Pin Tracker Spreadsheet',
    category: 'social-media',
    rationale: 'Pinterest marketers track pin performance manually; spreadsheet format suits metrics tracking.',
  },
  {
    title: 'Social Media Analytics Report Template',
    category: 'social-media',
    rationale: 'Agencies and freelancers need client-ready reporting templates; standardized format saves hours.',
  },
  {
    title: 'Email Newsletter Content Planner',
    category: 'social-media',
    rationale: 'Newsletter creators need editorial calendars; planning templates help maintain consistent sending.',
  },

  // ── home-organization ────────────────────────────────────────────────────
  {
    title: 'Weekly Cleaning Schedule Printable',
    category: 'home-organization',
    rationale: 'Cleaning routines reduce overwhelm; weekly schedules with room-by-room checklists are popular.',
  },
  {
    title: 'Home Inventory Spreadsheet Template',
    category: 'home-organization',
    rationale: 'Home inventory is essential for insurance claims; spreadsheet format allows room categorization.',
  },
  {
    title: 'Moving Checklist Planner Printable',
    category: 'home-organization',
    rationale: 'Moving is stressful and detail-heavy; timeline-based checklists reduce forgotten tasks.',
  },
  {
    title: 'Pantry Organization Labels Printable',
    category: 'home-organization',
    rationale: 'Pantry organization is a popular home improvement trend; printable labels are low-cost digital products.',
  },
  {
    title: 'Declutter Challenge 30 Day Printable',
    category: 'home-organization',
    rationale: 'Decluttering challenges drive engagement; 30-day format creates structured daily action.',
  },
] as const;

/** All unique category values in the seed library. */
export const SEED_CATEGORIES = [...new Set(CURATED_SEEDS.map((s) => s.category))].sort();
