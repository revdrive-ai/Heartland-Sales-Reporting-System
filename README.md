# Heartland Sales Reporting System

Next.js rebuild of the **Heartland Foods — Trade Platform V3** mockup
(the single-file demo at https://heartland-harvest-v3.vercel.app/, kept verbatim at
[`reference/heartland-harvest-v3.html`](reference/heartland-harvest-v3.html)).

The platform covers the closed trade loop — **model the base → plan promotions → track the
business → measure & learn → reconcile spend** — plus planning tools (Objectives, Approvals,
Latest Estimate), a leadership view, and the data side (Integrations, Agent Runs, Tie List,
Alignment Key, Category Key, Nielsen Pull Spec).

The rebuild is worked **one Albertsons division at a time** along the thirteen ALBSCO division
trading areas defined in the Nielsen Pull Spec (`lib/data/nielsenPull.ts`).

## Status

- ✅ App shell: topbar (global filter chips, Ask Heartland panel), sidebar (all 16 views),
  single platform theme, welcome overlay, toasts —
  ported from the demo (`app/globals.css` is the demo stylesheet with the alternate themes removed).
- ✅ Data modules: `lib/data/nielsenPull.ts` (13 Albertsons division TAs + the 25-column NIQ
  contract), `lib/data/alignmentKey.ts` (customer alignment hierarchy + mock stats).
- ✅ **The data seam**: views read/write only through `lib/repo/` (async functions returning
  snake_case row shapes from `lib/types/db.ts`). Server reads in `lib/repo/index.ts`,
  browser stores in `lib/repo/client.ts`; when Supabase arrives only the repo bodies
  change. `supabase/migrations/` holds the schema as files, written ahead of the project —
  see [`supabase/README.md`](supabase/README.md).
- ✅ **Real data loaded: the full ALBSCO NIQ pull** — 52,524 rows, all 13 division TAs,
  157 weeks (Jul 2023 → Jul 2026), 100 items across 7 brands (82 HFPG own / 18
  competitive). Source workbook at `data/raw/`, per-market facts at
  `data/nielsen/<CODE>.json.gz`, rebuilt any time with `python3 scripts/ingest_albsco.py`.
- ✅ **Promotion Planner rebuilt** (`/planner`): KPIs, monthly planned-vs-actual pacing, top
  customers, and two modes over the same filtered book: the sortable table and a Gantt
  calendar (customer-grouped lanes, status colors, consumption fill, snapshot marker) —
  both with drill-down to component
  lines (`/api/promos/[id]/lines`).
- ✅ **Base & Lift Lab rebuilt** (`/base`): the Nielsen weekly trend (actual vs NIQ base) per
  division × brand with the Telus promotion windows overlaid — event windows shaded on the
  chart, always-on programs listed, NIQ-detected promo weeks dotted, URL-driven controls.
  Division ↔ Telus-customer mapping in `lib/data/albertsonsPromoMap.ts` (+ migration 00003).
- ✅ **Sales Dashboard rebuilt** (`/reporting`, the landing view): own-brand retail dollars /
  units / price / share-of-measured-set with true YoY (last 13/26/52 weeks vs the same NIQ
  weeks a year earlier), weekly TY-vs-LY trend, brand and division/category cuts, and
  item-level movers. All divisions or one; URL-driven controls.
- ✅ **Global customer scope** — the crosswalk (`data/raw/Nielsen_crosswalk.xlsx` →
  `lib/fixtures/crosswalk.json`) ties customers across systems, and five cascading
  selectors in the topbar (Territory → Parent → Sales account, Team lead, Account lead)
  scope every screen. Options facet on each other (pick Albertsons and only Albertsons
  choices remain); the selection persists in the `hh-scope` cookie and resolves
  server-side to Nielsen markets + Telus customers per view.
- ⬜ The other 13 views render as stubs (`components/PageStub.tsx`) — rebuilt view-by-view as
  directed. See [`docs/HANDOFF.md`](docs/HANDOFF.md) for the full demo teardown and plan.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000 → redirects to /reporting
npm run build
```

Charts use `chart.js` + `react-chartjs-2` (same Chart.js major version as the demo).
