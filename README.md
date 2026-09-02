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
  three mockup themes (Splenda Bright / Portfolio / Refined), welcome overlay, toasts —
  ported 1:1 from the demo (`app/globals.css` is the demo stylesheet verbatim).
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
  customers, and the full sortable/filterable promotion book with drill-down to component
  lines (`/api/promos/[id]/lines`).
- ⬜ The other 15 views render as stubs (`components/PageStub.tsx`) — rebuilt view-by-view as
  directed. See [`docs/HANDOFF.md`](docs/HANDOFF.md) for the full demo teardown and plan.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000 → redirects to /reporting
npm run build
```

Charts use `chart.js` + `react-chartjs-2` (same Chart.js major version as the demo).
