@AGENTS.md

# Project notes

- This is a Next.js (App Router, TypeScript) rebuild of the single-file trade-platform mockup
  kept at `reference/heartland-harvest-v3.html`. When rebuilding a view, extract its markup,
  data consts and behavior from that file — it is the source of truth for parity.
- `app/globals.css` is the demo's stylesheet verbatim; prefer reusing its classes over writing
  new CSS so the rebuild stays pixel-consistent across all three themes
  (default `:root` = Splenda Bright; `[data-theme="portfolio"]`, `[data-theme="refined"]`).
- Demo data consts port to typed modules in `lib/data/` (see `nielsenPull.ts`,
  `alignmentKey.ts` for the pattern). localStorage keys keep the demo's names
  (`hhAlign`, `hhObj`, `hhTheme`, `hhWelcomeDone`).
- **Views never touch data directly** — they import from `lib/repo/` only.
  `lib/repo/index.ts` is server-only (reads `data/nielsen/*.json.gz` via fs); call it from
  server components and pass props down. `lib/repo/client.ts` holds browser stores
  (localStorage, mockup key names). When Supabase exists only repo bodies change. Row
  shapes are snake_case (`lib/types/db.ts`) matching `supabase/migrations/*.sql`, authored
  as files ahead of the database — keep all three in lockstep when adding tables.
- **The Nielsen data is real**: the full ALBSCO NIQ pull (52,524 rows, 13 divisions,
  157 weeks, 100 items) lives in `data/raw/` and is transformed by
  `scripts/ingest_albsco.py` (python3 + pandas) into `data/nielsen/` and
  `lib/fixtures/{markets,items}.json`. Never hand-edit the outputs; re-run the script.
- Build-out order is Albertsons division by division; Randy directs which piece comes
  next. `docs/HANDOFF.md` holds the full teardown.
