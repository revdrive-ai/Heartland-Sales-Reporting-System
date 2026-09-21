# Kroger — which facts to collect

_Drafted 2026-09-21 against “Glossary of Measures with calculations” (314
measures). That glossary is the **card/loyalty** side (84.51° Stratum).
Kroger exposes a second, separate body of data — **Market6** — covered in
“Two Kroger sources” below; it changes which source should feed the engine._

## Two Kroger sources, and which one feeds the engine

Kroger gives suppliers two different things, and they answer different
questions:

| | **84.51° Stratum (card)** | **Market6** |
| --- | --- | --- |
| Basis | Loyalty-card transactions | **Total store scan** — every sale through the register |
| Grain | Item × division × promotion week | **Daily, item × store** (and warehouse) |
| Strengths | Uplift/baseline modelling, promo tactic flags (Ad/Display/TPR/Mega), margin, household and shopper diagnostics | Raw scanned units and dollars, store and DC **inventory**, out-of-stocks, days of supply, forecasts |
| Missing | Total-store sales, inventory, daily grain | Household measures, uplift/baseline, margin |

84.51° and Market6 merged in 2016, so both may appear inside one portal, but
they remain distinct datasets with distinct licensing.

**This resolves the biggest concern in this document.** Concern 2 said their
uplift comes from a model we cannot see, so lift would not be comparable to
NIQ. Market6 gives **raw scan** — which is exactly what our seasonality
engine wants as input. So:

- **Market6 scanned units and dollars become the fact table**, the NIQ
  equivalent: item × geography × week. We compute the baseline ourselves,
  with the same engine we run on NIQ, so lift stays comparable across every
  retailer.
- **The card data becomes the overlay**: promo tactic flags and store-on-promotion
  percentages for the windows, their uplift as a published cross-check
  against our baseline, margin for joint business planning, and the shopper
  diagnostics in Tier 3.
- Concern 4 (loyalty-card basis) also goes away for the headline numbers,
  because Market6 is total-store scan rather than card-only.

### What Market6 carries

Verified from public material: daily item/store-level sales and operational
data for every Kroger store and warehouse; warehouse inventory on hand by
case and case GTIN; store and DC inventory with future sales forecasts for
promoted items; days-of-supply thresholds, out-of-stock alerting and
min/max target inventory; year-over-year dollar sales at enterprise,
division and vendor level; new-item sales and out-of-stock frequency.

Where Kroger delivers the same content over EDI rather than the portal, the
852 Product Activity Report carries it as qualifier codes — **QS** quantity
sold, **QA** quantity on hand/available, **QP** on order not yet received,
**QO** out of stock — by Kroger division and store number, daily or weekly.

**The definitive list is in our own Market6/Stratum instance**, not in public
documentation: export the measure picker from the ad-hoc report builder, the
same way the card glossary was produced. Everything above should be treated
as the shape to expect, not as the contract.

### What to request from Market6

Required, at item × division × week (store level only if we decide we need it):

- Scanned units, scanned dollars
- Store count selling the item, and the division store universe
- Store inventory on hand, DC inventory on hand
- Out-of-stock indicator / count
- Retail price actually scanned, if available separately from dollars ÷ units

Valuable:

- Days of supply, on-order quantity
- Kroger’s own store-level forecast (a second opinion beside ours)
- New-item first-sale dates (feeds distribution verification directly)

### Market6-specific concerns

1. **Scan data carries no promo flags.** Market6 tells us what sold, not what
   was on Ad/Display/TPR. Those come from the card side at EPG/RBP group
   grain, so Concern 6’s crosswalk is still required — now as the join
   between two Kroger systems as well as to our items.
2. **Daily grain, and an unknown week.** We aggregate to our Saturday weeks,
   which is only safe once Kroger’s week-ending day is confirmed (Concern 5).
   Daily data is an advantage — it lets us build any week definition — but
   only if we know theirs.
3. **Store-level volume.** ~2,700 stores × items × days is far more data than
   the tool needs. Division × week is the grain that matches NIQ; store-level
   should be pulled only where it earns its keep (distribution verification,
   out-of-stocks).
4. **Still no ACV weighting.** Market6 gives store counts, like the card data.
   If it can supply store-level category or total-store sales, we can build a
   proper ACV-style weight ourselves — worth asking, since it would fix
   Concern 3 rather than working around it.
5. **History depth is usually shorter than syndicated data.** Our year-ago
   carry and seasonality engine want two years. Confirm retention.
6. **Separate licensing.** Market6 access is not implied by Stratum access.
7. **Inventory is the bridge to SYSPRO.** Store and DC inventory plus
   out-of-stocks are exactly what `docs/design/shipments-forecasting.md`
   needs to reconcile shipments against consumption — buy-in, safety stock
   and sell-down stop being inferred and become measured. This is the
   strongest argument for taking Market6 beyond the scan facts.

---

## The card glossary (84.51° Stratum) — measure-by-measure

The goal is a Kroger feed that drives the **same** tool as NIQ: base & lift,
the seasonality engine, promo-window lift reads, distribution verification,
the forecast, and the LE lock. This lists exactly what to request, and the
places where Kroger’s model does not line up with NIQ.

## What the tool actually consumes today

Everything in the app reads these NIQ columns (`nielsen_weekly`), at
**item × trading area × week**:

| Field | Drives |
| --- | --- |
| `units`, `dollars` | every actual, KPI, chart and YoY |
| `base_units` | **the baseline** — base & lift, the forecast carry, plan bases, LE |
| `base_dollars` | base dollars, insights |
| `acv_any_promo` | “promoted week” test (≥ 10), measured lift per window, fallback lift |
| `acv_dist` | distribution insights, %ACV in distribution verification |
| `acv_feature`, `acv_display`, `acv_feat_disp`, `acv_tpr` | tactic breakouts, the lift engine’s per-tactic multipliers |
| `price_per_unit`, `base_price_per_unit` | price-change insights, discount depth |
| `eq_units`, `tdp` | declared in the pull spec, not yet consumed |

So the Kroger request has to answer five questions per item per week: how
much sold, what would have sold without promotion, how widely it was
distributed, how widely and by what tactic it was promoted, and at what
price.

## Tier 1 — required for parity (request these)

| Kroger measure | Maps to | Notes |
| --- | --- | --- |
| `$ Sales` | `dollars` | Loyalty-card basis — see Concern 4 |
| `Units` | `units` | |
| `$ Sales Uplift` | `incr_dollars` | Their model’s incremental |
| `Units Uplift` | `incr_units` | |
| `$ Sales Expected` | `base_dollars` | Given directly as `$ Sales − $ Sales Uplift` |
| *(derive)* `Units − Units Uplift` | `base_units` | **No “Units Expected” exists** — see Concern 1 |
| `Stores Selling` | distribution | Distinct stores that sold the item |
| `Distribution Points` | `tdp` analogue | `Sum[Stores Selling]` over the period |
| `% of Stores on Promotion` | `acv_any_promo` analogue | Store count, **not** ACV — see Concern 3 |
| `% of Stores on Ad` | `acv_feature` analogue | |
| `% of Stores on Display` | `acv_display` analogue | |
| `% of Stores on TPR` | `acv_tpr` analogue | |
| `% of Stores on Mega` | *(new)* | No NIQ or Telus analogue — see Concern 9 |
| `Average Price Paid` | `price_per_unit` | Includes all discounts and coupons |
| `White Tag Price` | `base_price_per_unit` | Modal **non-promoted** shelf price — better than a modelled base price |
| `Yellow Tag Price` | *(new)* | Modal promoted price, excludes coupons |
| `Price Reduction Percent` | discount depth | `(Yellow − White) / White`; today we infer depth from price vs base |

Also request the raw store counts (`Stores on Ad / Display / TPR / Mega /
Promotion`) alongside the percentages, so the denominator is auditable and
we can re-weight if the store universe changes mid-year.

## Tier 2 — high value, request in the same pull if it is free

| Kroger measure | Why |
| --- | --- |
| `$ Margin`, `Margin Uplift`, `Margin Uplift %` | Retailer profitability — the language joint business planning is conducted in, and the basis of their own `Promotion Strength` grade |
| `Promotion Strength` | Kroger’s own red/yellow/green verdict on an event; a useful cross-check against our ROI guardrail |
| `Ad Description`, `Display Description`, `TPR` flag | Tactic detail per week; maps to Telus performance types |
| `Manufacturer Coupon Discount $ Sales` | **Ties to our trade spend** — manufacturer-funded discounts are our money |
| `Kroger Loyalty Discount $ Sales`, `Kroger Coupon Discount $ Sales` | Separates retailer-funded from manufacturer-funded price support |
| `Mega Discount per Unit` | The per-unit give on mega events |

## Tier 3 — for Promo Analysis (workflow step 5), not needed for parity

`Households`, `Trips`, `$ Sales per Household`, `Units per Household`,
`Non-Incremental Sales`, `Incremental Category / Manufacturer / Major Brand
Consumption $ Sales`, and the trial / repeat / retained / lost / sourced
families. These are shopper diagnostics with **no NIQ analogue** — they
answer “where did the volume come from and did it stick”, which our promo
post-mortem cannot answer today. Worth having, but they are additive, not
parity.

## Not needed

The rank measures, `Product 1–4` comparison measures, daypart/hour `% of
Units`, `Share of Requirements` families, `Mega Units Requirement`,
`X Quantity`, and `Pounds` / `Adjusted Pounds` (random-weight only — no
Heartland item is random weight).

## Key concerns

**1. There is no baseline measure, and no “Units Expected”.**
Kroger publishes *uplift*, not baseline. `$ Sales Expected` is given, but the
only expected-units measure is `Adj Units Expected`, and “Adjusted Units” is
defined as *units sold by stores on promotion while the product was on
promotion* — a promoted-store subset, not the total. Using it as `base_units`
would understate the baseline badly. We must take `Units` and `Units Uplift`
and compute the baseline ourselves, and confirm with Kroger that
`Units Uplift` is reported on the same total-store basis as `Units`.

**2. Their baseline is their model — lift will not be comparable to NIQ.**
84.51’s uplift comes from a proprietary promotion methodology that differs
from NIQ’s baseline algorithm. A “+25% lift” at Kroger and at Albertsons are
not the same measurement, yet our planner scores events, pre-fills tactic
lifts and computes ROI across customers on one scale. **Recommendation:**
build our own baseline from Kroger weekly units using the seasonality engine
we already run, and keep their uplift as a published cross-check rather than
as the engine input. That keeps one methodology across every retailer and
keeps the planner’s ROI comparable. Adopting their baseline instead would be
faster but would quietly split the tool into two incomparable halves.

**3. Store counts are not %ACV.**
NIQ weights stores by all-commodity volume; Kroger’s “% of Stores on …” is an
unweighted store count. 60% of stores at Kroger is not 60% ACV at Albertsons
— a chain’s large stores carry far more volume than its small ones. Every
threshold we have is calibrated on %ACV: the ≥ 10 promoted-week test, the
≥ 10-point ACV drop insight, and the %ACV column in distribution
verification. These need per-source thresholds and the UI needs to say which
basis it is showing. There is also no true TDP analogue.

**4. Sales are loyalty-card based.**
`$ Sales` is “the net total dollar sales based on loyalty card sales”. We must
establish whether Kroger projects this to 100% of store sales or reports
card-only. If it is card-only, every absolute number understates the real
business by the non-carded share — which matters most when we tie consumption
to SYSPRO shipments. Ask for the projection factor or a total-store control
total.

**5. The week and the calendar may not match.**
Our entire engine assumes **Saturday-ending weeks** and aligns year-ago at
exactly 364 days. Kroger reports by “promotion week” / “AdWeek”, which is not
necessarily the retail week and not necessarily Saturday-ending. **Confirm
the week-ending day and whether promotion week equals retail week.** If they
differ, the two sources cannot share a week axis; we would hold a calendar
per source and reconcile at month level — which also affects the LE lock,
since the lock reads whatever weeks have landed.

**6. Promotion measures are reported at EPG / RBP group, not at item.**
Sales measures are item-level, but the promotion measures are defined “by
division, EPG group, and promotion week”. If promo support and uplift arrive
at group grain while sales arrive at item grain, there is no clean item-level
join. We need the grain of every requested measure in writing, plus an
**EPG/RBP ↔ UPC mapping** — a new crosswalk we do not have, analogous to the
Telus ↔ NIQ item crosswalk, and it will need the same maintenance.

**7. “Sensitive” measures are limited to our own products.**
`$ Margin` and `Promotion Strength` return values only for Heartland items.
Our NIQ pull deliberately includes the competitive set so the tool can show
share. Establish what competitive coverage Kroger permits — category and
commodity share measures appear available, item-level competitive detail
probably is not.

**8. No equivalised volume.**
NIQ `eq_units` is how pack sizes add up at brand level. Kroger offers only
`Pounds`, and only for random-weight items. We would have to compute EQ from
our own item master (units × size) — doable, but it is a build, and it must
match the NIQ EQ basis or brand-level comparisons across retailers will drift.

**9. Two promotion vocabularies, and “Mega” is new.**
Kroger: Ad / Display / TPR / Mega. Telus: Feature / Display / F&D / TPR /
EDLP / Slotting / Shopper Marketing / Other. We need a mapping table, and
**Mega** (multi-item mega events) has no Telus analogue — closest is a
multi-buy. We also need the Kroger equivalent of our “funding vehicle” rule
(EDLP and Slotting carry no lift): a Kroger always-on price investment must
not be credited with the lift of the events running inside it.

**10. Depth, cadence and delivery are unknown.**
The year-ago carry and the seasonality engine want **two years** of weekly
history. Confirm the depth available, the refresh cadence, and the delivery
mechanism (API, scheduled export, or manual download). The LE lock assumes
data lands predictably before the second Friday; a Kroger feed that arrives
late or irregularly changes what “locked” means for those accounts.

## Questions to put to Kroger

1. Is `Units Uplift` on the same total-store basis as `Units`?
2. Are `$ Sales` and `Units` projected to total store sales, or loyalty-card
   only? If card-only, what is the projection factor?
3. What day does the reporting week end, and is promotion week the same as
   retail week?
4. What is the grain of each promotion measure — item or EPG/RBP group — and
   can we get the EPG/RBP ↔ UPC mapping as a maintained file?
5. How many years of weekly history can be delivered, how often, and how?
6. What competitive/category coverage is permitted beyond our own items?
7. Is the promotion (uplift) methodology documented in enough detail to
   reconcile against a baseline we compute ourselves?

## Suggested build order

1. **Contract** — answers to the questions above, plus a sample weekly
   extract, before any schema work.
2. **Land it** — a `kroger_weekly` table on the same item × geography × week
   shape as `nielsen_weekly`, with a `source` column so the repository seam
   can serve either; EPG ↔ UPC crosswalk in the Tie List.
3. **Own baseline** — run our seasonality engine over Kroger units, publish
   their uplift beside ours, and reconcile the two on a known event.
4. **Parity** — Kroger divisions appear in the market selector and every view
   works unchanged, with %ACV-vs-store-count labelled per source.
5. **Shopper diagnostics** — Tier 3 measures into Promo Analysis.
