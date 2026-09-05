# Heartland Sales Reporting System — Build Status

_Last updated: 2026-09-05_

A Next.js/TypeScript rebuild of the heartland-harvest-v3 demo on real data,
deployed to Vercel from `main`. Every view reads through the repository seam
(`lib/repo`), so the move from local JSON/browser storage to Supabase is a
swap, not a rewrite — migrations `00001`–`00009` are already authored under
`supabase/migrations/`.

## Data loaded

| Source | Contents |
| --- | --- |
| NIQ ALBSCO weekly pull | 157 weeks (Jul 2023 → Jul 2026) across 13 Albertsons divisions · 100 items (82 own-brand) · base/actual units & dollars, base price, ACV, feature/display/TPR measures |
| Telus FY2026 promo book | 1,187 promotions · 5,117 component lines · planned & actual spend |
| Item crosswalk workbook | 209 Telus item # ↔ NIQ UPC pairs · 403 NIQ item attribute rows |
| Price list workbook | 213 dated list-price records, initial list effective 2026-01-01 |

## Base & Lift Lab

- Weekly base/actual trend with promo bands and lanes, seasonality engine,
  alignment controls; the item picker offers only items with volume in the
  last 52 weeks for the selected customer × brand.
- Metric selector: units, retail dollars, or gross dollars at list price.
  The four KPI cards show % change vs year-ago for the selected timeframe.
- **Plan years (2027/2028):** the actualized 2026 base carries in as a blue
  line, the seasonality-shaped projection continues in orange, year-ago
  actuals overlay on demand, and each customer's plan registration is logged.
- **Key insights** (collapsible): ACV drops, base-price moves, unexplained
  volume breaks, delists, promo-support swings, and dated list-price changes,
  ranked by base-volume impact, each with an "Adjust in Plan" link.
- **Planner adjustments** directly under the insights in plan years:
  distribution / base-price / trend levers by item per customer, drawing an
  adjusted-plan line on the chart.
- **Lift engine + Predict-a-lift** on measured data (through-origin
  depth-vs-lift fit with per-tactic multipliers), with a hide/show toggle.
- Promotion windows table with header filters and predicted-vs-actual lift
  columns.
- **Export** base units to Excel/CSV: week or month granularity, all periods
  including projected plan years, brand-by-item, optional adjusted-volume and
  Δ% rows.

## Promotion Planner

- **FY2026 monitor:** planned vs actual pace by month, top customers, and the
  full Telus book as a filterable table or Gantt calendar with line-level
  drill-down.
- **Plan builder (future years):** budget bar with an editable fund, 1.5× ROI
  guardrails, carry-FY2026-forward (brands derived from Telus component
  lines, items resolved through the crosswalk, bases scored at each event's
  own customer), undo-carry and clear-plan resets, CSV template + import, and
  a step-through event wizard with a live economics rail.
- Lift edits move rate-funded spend; spend and incremental volume display as
  exact numbers. Tactic chips show measured lift per performance type.
- **Item-level planning:** customer and item selectors narrow the entire page
  down to a single UPC, event rows name their items, and "+ New event"
  pre-fills the wizard from the selectors.

## Sales Dashboard

- Real KPIs by division and brand, gross-dollar basis, a plan-year selector
  comparing Plan 2027/2028 to the latest measured year, and a Key insights
  section with deep links into the Base & Lift Lab.

## Data & Integrations

- **Tie List:** Telus↔NIQ tie table with tie statuses and FY dollar exposure;
  the item crosswalk lives here as its access point.
- **Price List:** dated prices maintained by both workbook re-ingest
  (`scripts/ingest_price_list.py --effective`) and UI edits, wired into
  planner ROI, plan gross revenue, chart price-change markers, and insights.
  A CSV of the 50 Albertsons items still unpriced has been delivered.

## Shared, held plan state

Planner work — plan events, budgets, planner adjustments, plan-year
registrations, and price edits — persists **server-side** through
`/api/state`, so changes hold until Undo carry / Clear plan removes them and
everyone using the tool sees the same plan. Existing browser-held work lifts
to the shared store automatically on first load. Backend: Supabase
(`app_state`, migration `00010`) when `SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` are set; a `data/store/` file store otherwise.
On the Vercel deployment the Supabase env vars are required for durability —
until they're set, the tool falls back to per-browser storage there.

## Open items

- **Supabase provisioning** — migrations `00001`–`00010` are ready; setting
  the two env vars on Vercel makes the shared plan state durable in
  production (see above).
- **Remaining stub views** — Promo Analysis (workflow step 4) is the natural
  next build; then Deduction Center, Foodservice, Objectives & KPIs,
  Approvals, Latest Estimate, and Sales Leader View.
- **Data gaps to close on the business side** — the RC Taylor territory
  assignment, the Telus "Safeway Mountain West" ↔ NIQ "Safeway IMW" name
  match, and extending the crosswalk and price-list workbooks per the
  unpriced-items CSV.
- **Vercel deployment protection** — whether the deployed site sits behind
  SSO is still an open decision.
