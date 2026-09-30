@AGENTS.md

# Project notes

- This is a Next.js (App Router, TypeScript) rebuild of the single-file trade-platform mockup
  kept at `reference/heartland-harvest-v3.html`. When rebuilding a view, extract its markup,
  data consts and behavior from that file — it is the source of truth for parity.
- `app/globals.css` is the demo's stylesheet with the alternate mockup themes removed — the
  platform ships one theme (the `:root` palette). Prefer reusing its classes over writing new
  CSS; rebuild-specific additions go in `app/rebuild.css`.
- Demo data consts port to typed modules in `lib/data/` (see `nielsenPull.ts`,
  `alignmentKey.ts` for the pattern). localStorage keys keep the demo's names
  (`hhAlign`, `hhObj`, `hhWelcomeDone`).
- **Views never touch data directly** — they import from `lib/repo/` only.
  `lib/repo/index.ts` is server-only (reads `data/nielsen/*.json.gz` via fs); call it from
  server components and pass props down. `lib/repo/client.ts` holds the shared stores
  (plan events, budgets, adjustments, registrations, price edits) — server-side via
  `/api/state` (`lib/server/appstate.ts`: Supabase when `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` are set, else `data/store/` on disk), with localStorage
  only as offline fallback + one-time legacy lift. When Supabase exists only repo bodies change. Row
  shapes are snake_case (`lib/types/db.ts`) matching `supabase/migrations/*.sql`, authored
  as files ahead of the database — keep all three in lockstep when adding tables.
- **The Nielsen data is real**: the full ALBSCO NIQ pull (52,524 rows, 13 divisions,
  157 weeks, 100 items) lives in `data/raw/` and is transformed by
  `scripts/ingest_albsco.py` (python3 + pandas) into `data/nielsen/` and
  `lib/fixtures/{markets,items}.json`. Never hand-edit the outputs; re-run the script.
- **Leadership team report** (`/leadership`, nav group Leadership): sales for the President
  by customer, brand and item — one selection in the URL (period, cust, brand, item, m, sort),
  one page at a time or every page as a printable presentation (`page=all`), and the same
  pages as one Excel workbook (`/api/leadership/export`). Pages are defined in
  `lib/leadership/report.ts`; the numbers come through ONE seam, `lib/server/salesFacts.ts`,
  which today reads NIQ retail dollars/units for own items and will read the internal sales
  table loaded from Fabric — nothing above the seam changes when it does.
- **Shipments (sell-in)** come from the Retail Planner export in `data/raw/` (Publix and
  Jewel, weekly by item, Actual + Last Year) via `scripts/ingest_shipments.py` into
  `data/shipments/<ACCOUNT>.json.gz` + `meta.json` (unmatched item codes listed there);
  table `shipments_weekly` (migration 00014). One row per account × item × real week
  (NIQ week-ending Saturday); the workbook's Last Year row is stored on its own week
  (−364 days), so a 2026 export fills 2025 and 2026 and last year is read by date.
  The workbook ships cases; rows keep `cases` and convert to `units` by the item's case
  pack (price list first, then the pack in the description), null when unknown. Only
  weeks with shipments are stored. Publix is a shipments-only account with no NIQ
  market. `lib/weeks.ts` is the week calendar and the only place year-ago arithmetic lives:
  `yearAgoWeek` (−364 days) for dates, `comparableYearAgo` (null for a 53rd week) for
  comparisons, `priorYearWeek` (a 53rd week borrows last year's final week) for carried
  shape, `saturdaysOfYear` for the week axis. Next 53-week years: 2028, 2033, 2039.
- **Global scope**: the topbar's five cascading selectors (lib/scope.ts + components/ScopeBar)
  persist in the `hh-scope` cookie; server pages call `getScope()` (lib/server/scope.ts) and
  intersect their reads with `marketCodes` / `telusCustomerIds`. New views must do the same.
  The crosswalk fixture is the source of truth for cross-system customer identity
  (re-run scripts/ingest_crosswalk.py after replacing the raw workbook).
- Build-out order is Albertsons division by division; Randy directs which piece comes
  next. `docs/HANDOFF.md` holds the full teardown.
