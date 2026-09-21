# Kroger (84.51° Stratum) — which facts to collect

_Drafted 2026-09-21 against “Glossary of Measures with calculations” (314 measures)._

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
