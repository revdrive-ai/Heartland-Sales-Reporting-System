# Heartland Sales Reporting System — Build Status

_Last updated: 2026-09-19_

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

## Working mode — Analyze · LE · Plan

One decision, made once in the sidebar ("Working on"), decides which year
every workflow tab opens in: **Analyze** (measured history — rolling
windows and prior total years), **LE — FY<data-edge year>** (the in-flight
year: actuals + forecast to year-end, LE adjustments, monthly Latest
Estimates), **Plan — FY<next>** (the forward year: distribution
verification, plan adjustments, the plan builder, Plan of Record sign-off;
a small year picker sits under it for the second forward year). It is the
first thing in the **sidebar**, above Trade Workflow, and the chosen mode
is held green — so the year is picked before the view. The preference
lives in the `hh-mode` cookie beside the customer scope (`lib/mode.ts`,
`lib/server/mode.ts`, `components/Sidebar.tsx`); the per-page year
selectors are gone, and a stale `?win=`/`?yr=` in a link can't override the
sidebar. Card and button titles inherit the mode word. A **status strip**
at the top of the page (LE and Plan modes) says where the mode year stands across
every customer — LE: customers taken this month, NIQ edge, Telus book,
adjustments in play; Plan: distribution verified, Plan of Record signed,
adjustments, events — and links to the Latest Estimate view
(`lib/server/modeStatus.ts`, one batched `app_state` read).

## Base & Lift Lab

- Weekly base/actual trend with promo bands and lanes, seasonality engine,
  alignment controls; the item picker offers only items with volume in the
  last 52 weeks for the selected customer × brand.
- Metric selector: units, retail dollars, or gross dollars at list price.
  The four KPI cards show % change vs year-ago for the selected timeframe.
- **Plan mode (2027/2028):** the actualized 2026 base carries in as a blue
  line, the seasonality-shaped projection continues in orange, year-ago
  actuals overlay on demand, and each customer's plan registration is logged.
- **Key insights** (collapsible): ACV drops, base-price moves, unexplained
  volume breaks, delists, promo-support swings, and dated list-price changes,
  ranked by base-volume impact, each with an "Adjust in Plan" link.
- **Distribution verification** (plan years): a per-customer popup lists
  every item the source year sold — %ACV, last sale, base run-rate, sorted
  brand then ACV — with In plan / No volume decisions (quiet items pre-set to
  No volume), plus an Add-item flow: search the item master, pick a proxy for
  base volume with a %, set the first week sold, and enter a retail load-in
  volume + purchase date. Excluded items drop out of the carried base and
  projection; additions ride the proxy's weekly shape plus the load-in spike.
  Carry-by-default with a visible unverified pill; decisions are shared
  (`distver:<customer>:<year>`) and flow into the Promotion Planner: excluded
  items leave the event-scoring bases and the volume chart, additions score
  on their proxy, and the plan builder shows the verification rollup pill.
- **Planner adjustments** directly under the insights in plan years:
  distribution / base-price / trend levers by item per customer, drawing an
  adjusted-plan line on the chart.
- **Plan sign-off & Latest Estimates** (plan years): "Mark base complete"
  freezes v1 — the Plan of Record — per customer × year (per-brand monthly
  units, adjustment list, distver rollup); later snapshots are the monthly
  LE versions, append-only and diffable (Δ vs previous, Δ vs PoR). The
  header pill shows the latest version and turns amber when the working
  plan drifts from it; the versions doc (`plansnap:<customer>:<year>`) is
  the audit trail the LE view will consume. The **in-flight (data-edge)
  year** gets the same treatment on its Total-year view: every snapshot
  there is an LE (v1 is the baseline), and the adjustments card appears as
  **LE adjustments** — its levers move only the forecast-to-go weeks
  (measured weeks never move) and flow into the chart's LE-adjusted line,
  the full-year forecast KPI, the dashboard FY mode, and the Monthly
  Forecast Review (all through `lib/server/fyForecast.ts`).
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
- **Rate-funded spend follows volume.** Event bases are the plan-year weekly
  series at the event's customer (year-ago carried, engine-shaped after, with
  distribution verification and the Base & Lift plan adjustments applied,
  per item), summed over the event window. O/I and scan dollars are computed
  live from that base × (1 + lift) × $/unit plus fixed fees — so verifying
  distribution, adding an item, or a −20% trend lever moves EDLP O/I spend,
  the committed total and the monthly spend chart without anyone editing the
  event. Carried rows show the FY Telus planned $ beside the live number
  ("FY2026 $6,170 → −$2,160"). Fixed commitments keep their stored spend.
  **Off-invoice pays on every unit shipped**: an O/I line is also charged
  on the units other events at that customer lift on the same items in the
  same weeks (shown as "⊕ N u from overlapping events"); scan pays only on
  the deal's own units. **Always-on programs** (windows > 12 weeks — the
  Base & Lift lane rule: year-round signage, AMP fees, EDLP) carry 0 lift
  like funding vehicles, since their effect is already inside the base, and
  are excluded from the tactic-lift averages (`lib/data/nonPerformanceTypes.ts`).
  Tactic chips show measured lift per performance type.
- **Item-level planning:** customer and item selectors narrow the entire page
  down to a single UPC, event rows name their items, and "+ New event"
  pre-fills the wizard from the selectors.

## Sales Dashboard

- Real KPIs by division and brand, gross-dollar basis, a plan-year selector
  comparing Plan 2027/2028 to the latest measured year, an FY2026
  actuals + forecast mode (measured through the NIQ edge, then year-ago base
  × expected Telus window lift to year-end), and a Key insights section with
  deep links into the Base & Lift Lab.

## Monthly Forecast Review (workflow step 4)

- The FY forecast by calendar month vs prior-year actuals: status per month
  (actual / landing / forecast), Δ$ and Δ%, full-year totals, and a brand
  cut. Same construction as the dashboard FY mode and the Base & Lift
  Total-year view (shared `lib/server/fyForecast.ts`). Promo Analysis is now
  step 5 and Deduction Center step 6.

## Latest Estimate (LE) view — Planning Tools

- The LE-mode home: every customer's frozen versions side by side with the
  live working number (the same construction Base & Lift and the snapshot
  API use), Δ since the last version, adjustments, distribution rollup, and
  the take-LE action per customer or in bulk ("Take LE for N still open"),
  with a shared note. In Plan mode the same page is the **plan sign-off**:
  Plan of Record per customer, "Sign off N verified & unsigned" in bulk.
  A portfolio-by-month table sums the latest versions by brand against the
  previous versions and the live number. Read-only in Analyze mode.

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

- **Supabase connection** — the project is **Heartland Sales Reporting POC**
  (org REVDRIVE.AI INC, ref `bsmeqxypfvtcubytvrpw`,
  https://bsmeqxypfvtcubytvrpw.supabase.co). The Vercel integration is
  installed (env vars synced); the schema stands up with one idempotent
  `supabase/setup.sql` paste in the SQL Editor (safe over any partial state).
  The **Integrations screen** shows backend health and carries the one-click
  data loader (`/api/admin/load` + `lib/server/supaload.ts`, the in-app twin
  of `scripts/load_supabase.py`): *Load all* upserts every fixture table
  (~60K rows) server-side on Vercel, with per-table reload buttons for
  ongoing CSV/Excel drops. Remaining: run `setup.sql` once (health goes
  `writable: true`), press *Load all*, then swap the repo reads to Supabase
  view by view (`supabase/README.md` is the full runbook).
- **Shipment data (SYSPRO)** — design plan in
  `docs/design/shipments-forecasting.md`: cases-by-customer-by-item-by-day
  as the actual-sales basis, customer supply parameters (lead time, buy-in
  window, safety stock), consumption → shipment-month translation for NIQ
  customers, and a derived weekly shipment base for customers with no
  consumption data. Awaiting the decisions listed in §7 and a sample export.
- **Remaining stub views** — Promo Analysis (workflow step 5) is the natural
  next build; then Deduction Center, Foodservice, Objectives & KPIs,
  Approvals, and Sales Leader View.
- **Data gaps to close on the business side** — the RC Taylor territory
  assignment, the Telus "Safeway Mountain West" ↔ NIQ "Safeway IMW" name
  match, and extending the crosswalk and price-list workbooks per the
  unpriced-items CSV.
- **Vercel deployment protection** — whether the deployed site sits behind
  SSO is still an open decision.
