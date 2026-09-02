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
  snake_case row shapes from `lib/types/db.ts`). Today it's backed by generated fixtures
  (`lib/fixtures/`, from `scripts/generate-fixtures.mjs`) and localStorage; when Supabase
  arrives only the repo bodies change. `supabase/migrations/` holds the schema as files,
  written ahead of the project — see [`supabase/README.md`](supabase/README.md).
- ✅ First division dataset: **ALBSCO Jewel** — 8 items (6 Splenda + 2 competitive) × 52 NIQ
  weeks, deterministic, pinned to the demo's documented ALB-JEWEL sample rows.
- ⬜ The 16 views render as stubs (`components/PageStub.tsx`) — rebuilt view-by-view as
  directed. See [`docs/HANDOFF.md`](docs/HANDOFF.md) for the full demo teardown and plan.

## Develop

```bash
npm install
npm run dev     # http://localhost:3000 → redirects to /reporting
npm run build
```

Charts use `chart.js` + `react-chartjs-2` (same Chart.js major version as the demo).
