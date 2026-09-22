# Shipment-based forecasting & planning — design plan

_Draft for review · 2026-09-19_

SYSPRO shipments (customer × item × day, in **cases**) become the actual-sales
basis for forecasting and planning. This plan covers how that data lands, how
it ties to the customers and items the tool already knows, how the
consumption-based plan for NIQ customers gets re-timed into shipment months,
how customers with **no** consumption data get a weekly base projection built
backwards from shipments + Telus, and how the monthly feedback loop changes.

The guiding principle: **one planning loop, two measurement lenses.**
Base Business Review → Planner → Dashboard → Monthly Review → LE stays exactly as built.
What changes per customer is the lens the numbers are read through:

| | NIQ customers (Albertsons divisions) | Shipment-only customers (everyone else) |
| --- | --- | --- |
| Base | NIQ weekly base (consumption) | Weekly **shipment base** derived from shipments with Telus windows removed |
| Lift | NIQ actual vs base | Buy-in cases vs shipment base ("ship lift") |
| Plan is built in | Consumer weeks (sell-through) | Ship weeks (sell-in) |
| Month attribution | Consumption month → **translated** to ship month via supply parameters | Ship month directly |
| Monthly feedback | NIQ actuals vs forecast **and** shipments vs shipment forecast | Shipments vs shipment forecast |
| Ties to P&L | Through the shipment translation | Directly |

---

## 1. Data model

All new tables follow the existing conventions: idempotent migrations, RLS
deny-by-default with authenticated read, service-role writes only, and a
fixture + `lib/server/supaload.ts` registry entry so the Integrations loader
can upsert them.

### 1.1 `shipments_daily` — the raw grain, as SYSPRO delivers it

```
ship_date          date        -- invoice/ship date (decision 1)
syspro_customer    text        -- SYSPRO sold-to or ship-to code (decision 2)
fg                 text        -- SYSPRO stock code = Heartland FG# (matches price_list.fg)
cases              numeric     -- shipped cases; negative rows = returns/credits
ext_dollars        numeric     -- invoice $ if present (optional)
doc_ref            text        -- invoice / order number for audit
batch_id           uuid        -- intake batch
natural key (ship_date, syspro_customer, fg, doc_ref)
```

Stored **exactly as delivered, in cases**. Nothing is converted at rest; the
conversion lives in the view below, so a corrected `units_per_case` never
means a reload.

Intake mirrors the NIQ pattern: `shipment_staging` → validate → promote, with
`intake_rejects` catching rows whose customer or FG is not yet mapped. The
Integrations screen gets a **Shipments** card (rows, date span, last load,
unmapped customers / FGs as an exception queue with a "map now" link).

### 1.2 `shipments_weekly` — the working grain (view, later materialized)

```
week_ending (Saturday, matching nielsen_weekly), customer_id (crosswalk id),
fg, upc_core, cases, units (= cases × units_per_case), list_dollars
(= units × unit_price in force that week, from price_list)
```

Weeks are Saturday-ending so shipments line up on the same axis as NIQ weeks
and Telus windows without any re-bucketing.

### 1.3 Identity — two small crosswalk tables

- **`crosswalk_syspro_customers`** `(crosswalk_id, syspro_customer, syspro_name, role)` —
  one `customer_crosswalk` row can own several SYSPRO accounts (multiple
  ship-tos, a DC and a direct account). Same shape as
  `crosswalk_telus_customers`. Maintained in the **Alignment Key** view.
- **`fg_items`** `(fg, upc_core, units_per_case, description, active)` — the
  case pack per FG, seeded from `price_list` (which already carries
  `fg`, `upc_core`, `units_per_case`). Kept separate from prices because a
  pack change is a product fact, not a price fact. Maintained in the
  **Tie List** next to the Telus ↔ NIQ item crosswalk.

With these two, a shipment row resolves to *customer (crosswalk) × NIQ UPC ×
Saturday week × units*, which is the exact key every existing view uses.

### 1.4 `customer_supply_params` — how a customer buys

Per crosswalk customer, effective-dated, edited by the sales team:

| Field | Meaning | Default |
| --- | --- | --- |
| `lead_time_days` | order → ship, for base replenishment | 7 |
| `buyin_lead_weeks` | how many weeks **before** a promo start the buy-in ships | 2 |
| `buyin_span_weeks` | how many weeks the buy-in is spread over | 2 |
| `buyin_share_pct` | share of a promo's incremental volume the customer takes as buy-in (vs replenished during the event) | 70 |
| `safety_stock_weeks` | weeks of cover the customer holds; drives the post-promo sell-down dip | 2 |
| `dip_weeks` | weeks after the event during which replenishment runs below base | 2 |
| `note`, `effective_from`, `updated_by` | audit | |

These are the "standard lead times" and "estimated buy-in periods" — one set
per customer, versioned, with **suggested values calibrated from history**
(§3.3) shown beside the fields so the team accepts or overrides rather than
guesses.

### 1.5 Per-event buy-in overrides

A promotion can differ from the customer standard (a Costco roadshow, a
one-time forward buy). `plan_events` and the Telus book both get an optional
override held in `app_state` first (`buyin:<customer>:<year>`, same pattern
as `adj:` and `distver:`), then normalized:

```
{ promo_id | event_id, buyin_start, buyin_end, expected_cases?, note }
```

---

## 2. Translating the NIQ plan into shipment months (Albertsons)

The consumption plan for a division is a weekly series of base + incremental
units (what Base Business Review and the Planner already produce, including LE
adjustments). The shipment forecast is a **re-timing** of that same volume,
driven by the customer's supply parameters — no new volume is invented and
the full-year totals reconcile (consumption units = shipped units over the
year, ± the change in customer inventory).

For each week _w_ of the plan, per item:

1. **Base** consumption in week _w_ ships in week _w − lead_time_ (rounded to
   the Saturday week).
2. **Incremental** consumption inside a Telus window:
   - `buyin_share_pct` of the window's total incremental ships as the
     **buy-in**, spread evenly over the `buyin_span_weeks` ending
     `buyin_lead_weeks` before the window starts (or over the event override
     window when one exists);
   - the remainder ships as replenishment during the event, lagged by
     `lead_time_days`.
3. **Sell-down dip**: after the window, shipments run below base for
   `dip_weeks` by the amount the buy-in overshot the actual event volume
   (bounded by `safety_stock_weeks` × weekly base). This is what keeps the
   translation honest — the year total does not change, only the timing.
4. Roll ship weeks to **fiscal months** (decision 3) in **cases**
   (units ÷ `units_per_case`) and list dollars.

Worked example — Jewel, one item, base 400 u/wk, a 3-week TPR in April
lifting +60% (720 incremental units total), params lead 7 d / buy-in 2 wks
ahead over 2 wks / 70% share / dip 2 wks:

| Week | Consumption | Shipments | Why |
| --- | --- | --- | --- |
| Mar 14 | 400 | 400 + 252 | buy-in week 1 (70% × 720 ÷ 2) |
| Mar 21 | 400 | 400 + 252 | buy-in week 2 |
| Mar 28 | 400 | 400 | lead-time week, no buy-in |
| Apr 4–18 (TPR) | 640 × 3 | 400 + 72 each | replenishment carries the remaining 30% |
| Apr 25, May 2 | 400 | 400 − 0…dip | sells down any overshoot |

March ships 504 units the consumption plan puts in April — exactly the
mismatch this design exists to fix for the monthly forecast and for O/I spend
timing (off-invoice accrues on shipped cases, so trade-spend forecasts move
with the buy-in too).

Where it shows up: the **Monthly Forecast Review** gains a basis selector
(*Consumption · NIQ* / *Shipments · SYSPRO*); in the shipments basis each
month shows forecast cases vs shipped cases to date. The **Sales Dashboard**
FY mode gets the same selector. The LE snapshot freezes both monthly series.

---

## 3. Shipment-only customers — working backwards from shipments + Telus

For customers with no consumption data, the goal is a weekly base projection
that behaves like the NIQ base so the rest of the loop is unchanged.

### 3.1 Decomposing history into base + promo

For each customer × item, over the weekly shipment history:

1. **Mark promo-affected weeks** from the Telus book for that customer:
   `[start − buyin_lead − buyin_span, end + lead_time + dip_weeks]` for every
   non-EDLP/Slotting window (funding vehicles are not volume events — same
   rule as today).
2. **Shipment base** = a robust trend through the *unaffected* weeks
   (rolling median, then the seasonality engine the tool already fits, so
   quiet months don't read as declines). Affected weeks get the interpolated
   base; the shipments above it are the **buy-in / incremental**.
3. **Ship lift** per window = incremental cases ÷ base cases over the
   affected span — the shipment-level analogue of predicted lift, labelled
   distinctly because it includes the retailer's inventory behaviour.

The result is persisted in the *same shape* as `nielsen_weekly`
(`week_ending, upc, market_code, units, base_units, dollars, base_dollars`
plus `source = 'shipments'`) so `getWeeklyFacts` serves it through the repo
seam and Base Business Review, the Planner's event scoring, the lift engine, the
export, distribution verification and the sign-off/LE snapshots all work
unchanged. The `markets` table grows to hold these customers (code = crosswalk
id, `source` column: `niq` | `shipments`).

### 3.2 Forecasting them

Same construction as today (`fyWeeklySeries`): year-ago shipment base carried
forward (engine-shaped run rate where unmeasured) × the expected ship lift of
the covering Telus windows, × LE adjustments. Because the base is already in
ship weeks, no translation step is needed — the buy-in timing is baked into
where the history put it, and the supply parameters only matter when a new
event has no history (then the standard buy-in profile from §1.4 is used).

### 3.3 Calibrating supply parameters from history (both customer types)

Where an NIQ customer also has shipments, the tool can **measure** its
parameters: cross-correlate weekly shipments against NIQ consumption around
past Telus windows; the lag that maximizes correlation is the buy-in lead,
the width of the shipment bump above base is the span, the bump's share of
the window's incremental is the buy-in share, and the depth/length of the
trough after is the dip. These appear as *suggested* values on the
Supply parameters panel with the evidence (n windows, R²), and the team
accepts or overrides. For shipment-only customers the same fit runs against
the derived base. A later Agent Run can re-fit quarterly and flag drift.

---

## 4. The monthly feedback loop, per lens

| Step | NIQ customer | Shipment-only customer |
| --- | --- | --- |
| Actuals land | NIQ weekly (consumption) + SYSPRO daily (shipments) | SYSPRO daily |
| Measured vs forecast | Consumption vs plan **and** shipments vs shipment forecast | Shipments vs forecast |
| Where | Monthly Forecast Review (basis selector) | Monthly Forecast Review (shipments basis only) |
| LE | Actuals-to-date + forecast-to-go, both series frozen | Same, shipments series |
| Explaining a miss | Consumption miss → lift/base; shipments miss with consumption on plan → **timing** (buy-in early/late) or inventory | Decompose against Telus windows: base miss vs event miss vs timing |

The new signal this gives leadership: when consumption is on plan but
shipments are not, the gap is inventory timing, not demand — and the tool can
say so.

---

## 5. UI changes by view

- **Integrations** — Shipments feed card + loader (CSV/Excel drop now, SYSPRO
  auto-feed later, same `/api/admin/load` chunking), exception queue for
  unmapped customers/FGs.
- **Alignment Key** — SYSPRO account mapping per customer and the **Supply
  parameters** panel (standard lead time, buy-in lead/span/share, safety
  stock, dip; suggested values with evidence; effective-dated history).
- **Tie List** — FG ↔ UPC ↔ case pack (`fg_items`) beside the Telus ↔ NIQ
  crosswalk; unmapped FGs from the exception queue land here.
- **Base Business Review** — lens toggle *Consumption (NIQ)* / *Shipments (cases)* for
  Albertsons; shipment-only customers open in the shipments lens with the
  derived base, buy-in bumps shaded on the Telus windows; units/cases display
  toggle. Total-year and LE adjustments work as they do today.
- **Promotion Planner** — event rows show the derived buy-in window and let
  the user override it (§1.5); the volume chart and O/I spend by month follow
  ship timing; "carry forward" carries overrides.
- **Sales Dashboard / Monthly Forecast Review** — basis selector; shipments
  basis shows cases and list dollars by fiscal month, forecast vs shipped.
- **Latest Estimate** — versions freeze both series; the versions table shows
  Δ consumption and Δ shipments.

---

## 6. Phased build

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| **0 — Contract** | Sample SYSPRO export → field mapping, natural key, returns handling agreed; `shipments_daily` migration + fixture | Decisions 1–3 |
| **1 — Land & reconcile** | Loader + Integrations card + exception queue; `crosswalk_syspro_customers`, `fg_items`; `shipments_weekly` view; shipments overlay (cases) on Base Business Review for Albertsons; reconciliation report: shipments vs NIQ consumption by month per division (sanity check on the mapping) | Phase 0, ≥ 1 year of history |
| **2 — Translate** | `customer_supply_params` + Alignment Key panel; consumption → shipment re-timing; shipments basis on Dashboard + Monthly Forecast Review; per-event buy-in override in the Planner; O/I spend timed to ship weeks | Phase 1 |
| **3 — Shipment-only customers** | Base/promo decomposition → `source='shipments'` weekly facts; those customers appear in the market selectors; Base Business Review, Planner, sign-off & LE work for them | Phase 1, Telus customer mapping |
| **4 — Calibrate & close the loop** | Suggested parameters from history; LE versions freeze both series; "timing vs demand" callouts in the Monthly Review; quarterly re-fit as an Agent Run | Phases 2–3, ≥ 2 years of history |

Phase 1 is valuable on its own (shipments visible against consumption, with
the mapping proven), and every later phase is additive.

---

## 7. Decisions needed

1. **Which date** is the actual: ship date, invoice date, or order date? (Ship
   date is assumed; invoice date usually ties to the P&L.)
2. **Which customer code** in SYSPRO maps to a crosswalk customer — sold-to,
   ship-to, or both? Do DCs (e.g. Safeway Denver vs IMW) ship from distinct
   codes so the division split survives?
3. **Fiscal calendar** — calendar months, or a 4-4-5 / retail calendar for
   month attribution?
4. **Returns and credits** — netted in the feed, or separate negative rows /
   separate document types to net in the view?
5. **FG codes** — confirm SYSPRO stock codes equal the Price List FG# and
   that `units_per_case` there is the shipped case pack (not an inner pack).
6. **History depth** available in the export (calibration wants two years;
   one year is enough for Phase 1).
7. **Default display unit** — cases everywhere on the shipments lens, or
   eaches with a cases toggle? (Cases assumed for shipments, units for
   consumption.)
8. **Trade-spend timing** — should the Planner's O/I spend forecast move to
   ship weeks now (Phase 2) or stay on event weeks until the shipment
   forecast is trusted?
