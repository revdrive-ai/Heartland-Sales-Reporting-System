# Handoff — Heartland Sales Reporting System

Prepared 2026-09-01 for the next Claude Code session. Target repo:
`RandyPronschinske/Heartland-Sales-Reporting-System` (start the new session with this repo as
the source — this session was tiered to `revdrive-ai` and could not attach it).

## The goal

Recreate the demo at **https://heartland-harvest-v3.vercel.app/** as a **Next.js / React app**,
working through **Albertsons divisions one at a time**. Vercel project name:
`heartland-sales-reporting-system` (create via Vercel MCP `create_git_project` against the repo
once the scaffold is pushed — pass `projectName` explicitly).

> Note: the demo URL is blocked by the remote-session egress proxy. Fetch it with the Vercel
> MCP tool `web_fetch_vercel_url` (returns the full ~627 KB HTML), not WebFetch/curl.

## What the demo is

`Heartland Foods — Trade Platform V3 (2027 Planning Mockup)` — a single-file (~5,474-line) SPA:
inline CSS + vanilla JS + **Chart.js 4.4.1** (cdnjs). All 16 views are template-literal
functions in a `views` map; `go(view)` re-renders `#main`, destroys/recreates charts, and
toggles `.navitem.active`. Two stores persist to localStorage: `hhAlign` (alignment key rows +
version) and `hhObj` (objectives by year). Portfolio is the **Splenda family** (brands:
Splenda, SlimFast, Java House, Equal, Whole Earth, Wholesome); customers: Walmart, Kroger,
Target, Costco, Albertsons, Sprouts, Publix.

### Shell

- **Topbar**: filter chips (`.fchip`), an “Ask” AI button, theme picker, avatar.
- **Themes** (`data-theme` on root): `bright` = “Splenda Bright” (default), `portfolio`,
  `refined` (dark navy with brand accent). All colors are CSS variables.
- **Sidebar** (sticky, grouped nav; badges/tags on items). Nav map (`data-view` → label):

| Group | Views |
|---|---|
| Trade Workflow | `base` Base & Lift Lab (step 1) · `planner` Promotion Planner (2) · `reporting` Sales Dashboard (3, default) · `analysis` Promo Analysis (4) · `deductions` Deduction Center (badge 50) |
| Segments | `foodservice` Foodservice |
| Planning Tools | `objectives` Objectives & KPIs · `approvals` Approvals (live badge) · `le` Latest Estimate (LE) |
| Leadership | `leader` Sales Leader View |
| Data & Integrations | `integrations` Integrations (badge 3) · `agents` Agent Runs (tag AI) · `tielist` Tie List · `alignkey` Customer Alignment Key · `catkey` Category Key (badge 3) · `nielsenpull` Nielsen Pull Spec (tag V1) |

- **Workflow strip** on the five Trade Workflow views:
  `Model the base → Plan promotions → Track the business → Measure & learn → Reconcile spend`,
  with “↺ learnings feed step 1”.

### Key data models (JS consts — port these to typed TS modules)

- `CATALOG` — items per brand with per-customer weekly base units, confidence 1–3
  (e.g. `{item:'Splenda 400ct', conf:3, base:{Walmart:103, Kroger:71, …, Albertsons:33}}`).
- `CAT_TAX` / `CAT_DEFAULT` / `CATQ` — category taxonomy (Super Category → Segment →
  Sub-segment → item, `SPL-###` ids, salesK/units/GM) plus an **intake quarantine** queue.
- `ALIGN_DEFAULT` / `ALIGN` — Customer Alignment Key: rows `{id:'ALN-###', ch, dv, rg, nm, ty, on}`.
  Channels **Retail** (6 regions: Northeast, Mid-Atlantic, Southeast, Southwest, Mountain,
  Pacific) and **Food Service** (4 regions, state-level rows). Customer nodes include
  Albertsons; per-node stats are hash-derived mock numbers. Versioned, editable, saved to
  localStorage.
- `NPULL_*` — **Nielsen Pull Spec — Albertsons** (from
  `Nielsen_Albertsons_Data_Pull_Template V1.xlsx`): `NPULL_MARKETS` = **13 ALBSCO division
  trading areas**: Acme, Denver, Eastern, Intermountain, Jewel, Nor Cal, Portland, Seattle,
  Shaws, So Cal, Southern, Southwest, United (all `ALBSCO … TA`); `NPULL_COLS` = 25 columns
  with type/required/description (week_ending Saturday ISO, upc-as-text, units, dollars,
  base_units/base_dollars, price, eq_units, incr_*, acv_dist, tdp, acv_any_promo / feature /
  display / feat_disp / tpr, promo/nonpromo units, brand, category…); sample rows use market
  codes like `ALB-JEWEL` (“Albertsons Jewel-Osco”), `ALB-VONS` (“Albertsons Vons SoCal”);
  an “export template” action (mockup toast).
- `OBJ_*` — Objectives by `year|brand` → customer × month rows (gross $K + trade %), years
  2026/2027, quick-fill tools, attainment tracking at the lowest level.
- `LE_*` — Latest Estimate: monthly cycle, version locks, LE walk, change log ranked by $
  impact, review pack per customer × brand cell.
- `APPR_*` — Approvals: roles KAM (“RP”), Director of Sales (D. Alvarez), Trade Finance/RGM
  (M. Okafor); ordered sign-off, policy reasons list, role switcher standing in for SSO.
- `EV_*` / `PROG_*` — Promotion Planner: tactics with lift multipliers (Feature 18, Display 24,
  TPR 11, BOGO 31, Endcap 22, F+D 34), fund sources (2026/2027 Trade Accrual, Incremental),
  $7/unit margin constant, guardrails, YoY over/under.
- `DEDQ` / `DED_*` — Deduction Center: AI review queue (badge 50), dispositions, tiers,
  tolerances, grace windows, flow diagram.
- `FLOW_*` — “System data flow — interactive” diagram (feeds → platform → consumers).
- `PUBLIX_*` — a worked base/lift dataset (Publix × Splenda) powering Base & Lift Lab and the
  Sales Dashboard examples; `BADJ`/`SADJ` base & seasonality adjustment logs;
  `CONF_*`/`PROJ_*` base-engine confidence/projection constants.
- `ASKS` — canned “Ask” assistant responses.

## Proposed Next.js architecture

- `create-next-app` (App Router, TypeScript, no Tailwind unless Randy wants it — the demo’s
  design system is bespoke CSS variables; port it as CSS modules or a global stylesheet with
  the three `data-theme` palettes).
- Charts: **react-chartjs-2 + chart.js@4** for parity with the demo.
- Route per view: `app/(platform)/{base,planner,reporting,analysis,deductions,foodservice,objectives,approvals,le,leader,integrations,agents,tielist,alignkey,catkey,nielsenpull}/page.tsx`
  with a shared shell layout (topbar, sidebar, workflow strip component, theme provider).
- Data layer: `lib/data/*.ts` — port each JS const to a typed module (`catalog.ts`,
  `alignmentKey.ts`, `nielsenPull.ts`, `objectives.ts`, …). Keep localStorage persistence
  behind a small store hook (`useLocalStore('hhAlign', …)`) so swapping to a real backend later
  is one seam.
- Division dimension: add `division` (the 13 ALBSCO TAs) as a first-class field on Nielsen
  rows, alignment nodes and (eventually) planner/objective scopes — that is the “one division
  at a time” axis.

## Division-by-division workplan (Randy directs; suggested order)

1. Scaffold + shell + themes + nav (no view content) → deploy to Vercel
   (`heartland-sales-reporting-system`).
2. Alignment Key + Nielsen Pull Spec views with the Albertsons division TA list — the two
   places the 13 divisions already live in the demo.
3. Then per division (e.g. start ALBSCO Jewel Div TA, matching the demo’s `ALB-JEWEL` sample
   rows): seed Nielsen-shaped weekly data, wire it through Sales Dashboard → Base & Lift Lab →
   Planner scopes for that division; repeat division by division.
4. Workflow views (planner/approvals/LE/deductions) once the data spine holds.

## Kickoff prompt for the new session (paste as-is)

> We are recreating the trade-platform demo at https://heartland-harvest-v3.vercel.app/ in this
> repo (Heartland-Sales-Reporting-System) as a Next.js + TypeScript app, per the
> HANDOFF-Heartland-Sales-Reporting-System.md teardown. Fetch the demo HTML with the Vercel MCP
> tool `web_fetch_vercel_url` and keep a copy at `reference/heartland-harvest-v3.html` for
> exact CSS/data extraction. Scaffold the app (App Router, react-chartjs-2, the three
> demo themes as CSS variables, shell + sidebar with all 16 views stubbed), then stop and wait
> for my direction — I’ll work Albertsons divisions one at a time, starting with the Alignment
> Key and Nielsen Pull Spec views where the 13 ALBSCO division trading areas live. Name the
> Vercel project heartland-sales-reporting-system.

## Loose ends from this session

- Nothing was pushed anywhere. An earlier, superseded draft (a static rep/manager dashboard
  site in the leadership-site style) lives only in this session’s scratchpad and can be
  ignored — the demo recreation replaces that direction.
- The `claude/heartland-sales-reporting-67ztqm` branch in `Heartland-Leadership-Reporting`
  has no new commits.
