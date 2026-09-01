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
- Build-out order is Albertsons division by division (the 13 ALBSCO TAs in
  `lib/data/nielsenPull.ts`); Randy directs which piece comes next. `docs/HANDOFF.md` holds
  the full teardown.
