#!/usr/bin/env node
/**
 * Fixture generator — deterministic Nielsen-shaped weekly data, one Albertsons
 * division at a time. Output lands in lib/fixtures/ as JSON whose field names
 * are exactly the future nielsen_weekly column names (snake_case), so the
 * fixtures double as the Supabase seed source later.
 *
 * Run: node scripts/generate-fixtures.mjs
 *
 * The SPL-400 rows for 2026-04-04 / 2026-04-11 and the Equal row for
 * 2026-04-04 are pinned to the exact sample rows the reference mockup ships
 * in its Nielsen Pull Spec, so the fixture provably matches the documented
 * contract. Everything else is generated with a seeded RNG — re-running the
 * script reproduces the same bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "fixtures");

/* ---------------------------------------------------------------- MARKETS
   The 13 ALBSCO division trading areas. Codes follow the mockup's sample
   rows (ALB-JEWEL, ALB-VONS); the rest extend the same convention. */
const MARKETS = [
  { code: "ALB-ACME",      name: "Albertsons Acme",          ta_name: "ALBSCO Acme TA" },
  { code: "ALB-DENVER",    name: "Albertsons Denver",        ta_name: "ALBSCO Denver Div TA" },
  { code: "ALB-EASTERN",   name: "Albertsons Eastern",       ta_name: "ALBSCO Eastern TA" },
  { code: "ALB-INTMTN",    name: "Albertsons Intermountain", ta_name: "ALBSCO Intermountain Div TA" },
  { code: "ALB-JEWEL",     name: "Albertsons Jewel-Osco",    ta_name: "ALBSCO Jewel Div TA" },
  { code: "ALB-NORCAL",    name: "Albertsons Nor Cal",       ta_name: "ALBSCO Nor Cal Div TA" },
  { code: "ALB-PORTLAND",  name: "Albertsons Portland",      ta_name: "ALBSCO Portland Div TA" },
  { code: "ALB-SEATTLE",   name: "Albertsons Seattle",       ta_name: "ALBSCO Seattle Div TA" },
  { code: "ALB-SHAWS",     name: "Albertsons Shaws",         ta_name: "ALBSCO Shaws Div TA" },
  { code: "ALB-VONS",      name: "Albertsons Vons SoCal",    ta_name: "ALBSCO So Cal Div TA" },
  { code: "ALB-SOUTHERN",  name: "Albertsons Southern",      ta_name: "ALBSCO Southern Div TA" },
  { code: "ALB-SOUTHWEST", name: "Albertsons Southwest",     ta_name: "ALBSCO Southwest Div TA" },
  { code: "ALB-UNITED",    name: "Albertsons United",        ta_name: "ALBSCO United Div TA" },
];

/* ------------------------------------------------------------------- ITEMS
   Item master for the Jewel build-out: six Splenda items (taxonomy names
   from the mockup's Category Key) plus two competitive items, since the
   pull contract deliberately includes the competitive set. base_units /
   base_price are the ALB-JEWEL everyday baseline per week. */
const ITEMS = [
  { upc: "0007410000123", nielsen_item_code: "1234567", brand: "Splenda",     name: "Splenda Original Sweetener Packets 400ct",   category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Sucralose Packets",  base_units: 47800, base_price: 7.32, promo_weeks: 9, own: true },
  { upc: "0007410000456", nielsen_item_code: "1234570", brand: "Splenda",     name: "Splenda Original Sweetener Packets 200ct",   category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Sucralose Packets",  base_units: 26400, base_price: 4.86, promo_weeks: 8, own: true },
  { upc: "0007410000789", nielsen_item_code: "1234581", brand: "Splenda",     name: "Splenda Original Granulated Canister 9.7oz", category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Granulated",         base_units: 18900, base_price: 5.48, promo_weeks: 7, own: true },
  { upc: "0007410001012", nielsen_item_code: "1234592", brand: "Splenda",     name: "Splenda Original Granulated Pouch 19.4oz",   category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Granulated",         base_units: 11200, base_price: 8.94, promo_weeks: 6, own: true },
  { upc: "0007410001345", nielsen_item_code: "1234603", brand: "Splenda",     name: "Splenda Brown Sugar Blend 16oz",             category: "Sweeteners", super_category: "Baking Sweeteners / Blends", sub_category: "Brown Sugar Blend", base_units: 6800,  base_price: 6.12, promo_weeks: 5, own: true },
  { upc: "0007410001678", nielsen_item_code: "1234614", brand: "Splenda",     name: "Splenda Stevia Jar 5.6oz",                   category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Stevia",             base_units: 7900,  base_price: 7.44, promo_weeks: 5, own: true },
  { upc: "0009920000456", nielsen_item_code: "9876543", brand: "Equal",       name: "Equal Classic Packets 230ct",                category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Aspartame Packets",  base_units: 29800, base_price: 7.18, promo_weeks: 6, own: false },
  { upc: "0009930000789", nielsen_item_code: "9876551", brand: "Whole Earth", name: "Whole Earth Sweetener Blend 40ct",           category: "Sweeteners", super_category: "No/Low-Calorie Tabletop", sub_category: "Stevia",             base_units: 9600,  base_price: 5.20, promo_weeks: 4, own: false },
];

/* ------------------------------------------------------------ DETERMINISM */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const r2 = (v) => Math.round(v * 100) / 100;
const r1 = (v) => Math.round(v * 10) / 10;

/* 52 NIQ weeks (Saturday week-endings) ending 2026-08-29 — anchored to the
   mockup's documented 2026-04-04 Saturday so the pinned rows line up. */
const weeks = [];
{
  const end = new Date("2026-08-29T00:00:00Z");
  for (let i = 51; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 7 * 86400000);
    weeks.push(d.toISOString().slice(0, 10));
  }
}

/* Seasonality index by month for tabletop sweeteners: New-Year spike,
   holiday-baking lift for blends, quiet summer. Mean ≈ 1.0. */
const SEASON = { 1: 1.16, 2: 1.06, 3: 1.0, 4: 0.98, 5: 0.96, 6: 0.93, 7: 0.92, 8: 0.94, 9: 0.99, 10: 1.03, 11: 1.09, 12: 1.12 };
const SEASON_BAKING = { 1: 1.02, 2: 0.95, 3: 0.94, 4: 0.96, 5: 0.92, 6: 0.88, 7: 0.86, 8: 0.9, 9: 1.0, 10: 1.12, 11: 1.34, 12: 1.4 };

/* Tactic mix used on promoted weeks: [name, lift multiplier, depth %, acv split fn] */
const TACTICS = [
  { nm: "TPR",               lift: 1.32, depth: 0.13, f: 0,    d: 0,    fd: 0 },
  { nm: "Display",           lift: 1.52, depth: 0.15, f: 0,    d: 0.8,  fd: 0 },
  { nm: "Feature",           lift: 1.58, depth: 0.17, f: 0.85, d: 0,    fd: 0 },
  { nm: "Feature + Display", lift: 2.1,  depth: 0.2,  f: 0.72, d: 0.5,  fd: 0.46 },
];

function genMarketRows(market) {
  const rows = [];
  for (const it of ITEMS) {
    const rand = mulberry32(seedOf(market.code + "|" + it.upc));
    const isBaking = it.super_category.startsWith("Baking");
    const acvDist = it.own ? 90 + rand() * 8 : 82 + rand() * 10;
    const tdp = Math.round(acvDist * (3.4 + rand() * 1.4));

    // pick promoted week indexes, spaced at least 2 apart
    const promoIdx = new Set();
    while (promoIdx.size < it.promo_weeks) {
      const i = Math.floor(rand() * weeks.length);
      if (![...promoIdx].some((j) => Math.abs(j - i) < 3)) promoIdx.add(i);
    }

    weeks.forEach((week, i) => {
      const month = +week.slice(5, 7);
      const season = (isBaking ? SEASON_BAKING : SEASON)[month];
      const drift = 1 + (i - weeks.length / 2) * (it.own ? 0.0012 : -0.0008); // gentle trend
      const noise = 0.94 + rand() * 0.12;
      const base_units = Math.round(it.base_units * season * drift * noise);
      const base_price = r2(it.base_price * (1 + (i > 30 ? 0.02 : 0))); // one small price move
      const base_dollars = Math.round(base_units * base_price);

      const promo = promoIdx.has(i);
      const t = promo ? TACTICS[Math.floor(rand() * TACTICS.length)] : null;
      const price = promo ? r2(base_price * (1 - t.depth)) : r2(base_price * (0.995 + rand() * 0.01));
      const units = promo ? Math.round(base_units * (t.lift + rand() * 0.25)) : base_units;
      const dollars = Math.round(units * price);
      const incr_units = Math.max(0, units - base_units);
      const anyAcv = promo ? r1(38 + rand() * 34) : (rand() < 0.25 ? r1(rand() * 6) : 0);
      const promo_units = promo ? Math.round(incr_units + base_units * (anyAcv / 100) * 0.45) : Math.round(units * (anyAcv / 100) * 0.3);

      rows.push({
        week_ending: week,
        nielsen_item_code: it.nielsen_item_code,
        upc: it.upc,
        market_code: market.code,
        market_name: market.name,
        units,
        dollars,
        base_units,
        base_dollars,
        price_per_unit: r2(dollars / units),
        eq_units: units,
        base_price_per_unit: base_price,
        incr_units,
        incr_dollars: Math.round(incr_units * price),
        acv_dist: r1(acvDist),
        tdp,
        acv_any_promo: anyAcv,
        acv_feature: promo ? r1(anyAcv * t.f) : 0,
        acv_display: promo ? r1(anyAcv * t.d) : 0,
        acv_feat_disp: promo ? r1(anyAcv * t.fd) : 0,
        acv_tpr: promo ? r1(anyAcv * (t.nm === "TPR" ? 0.9 : 0.15)) : 0,
        promo_units,
        nonpromo_units: units - promo_units,
        brand: it.brand,
        category: it.category,
      });
    });
  }
  return rows;
}

/* Pin the mockup's documented sample rows exactly (ALB-JEWEL SPL-400 promoted
   and everyday weeks; the competitive everyday week keeps its shape but joins
   this item master). */
const PINNED = [
  { week_ending: "2026-04-04", upc: "0007410000123", vals: { units: 48210, dollars: 344219, base_units: 47800, base_dollars: 349896, price_per_unit: 7.14, eq_units: 48210, base_price_per_unit: 7.32, incr_units: 410, incr_dollars: 2927, acv_dist: 96.4, tdp: 412, acv_any_promo: 18.2, acv_feature: 11.4, acv_display: 4.9, acv_feat_disp: 1.9, acv_tpr: 0.0, promo_units: 8900, nonpromo_units: 39310 } },
  { week_ending: "2026-04-11", upc: "0007410000123", vals: { units: 61340, dollars: 398097, base_units: 47900, base_dollars: 350628, price_per_unit: 6.49, eq_units: 61340, base_price_per_unit: 7.32, incr_units: 13440, incr_dollars: 87226, acv_dist: 96.4, tdp: 412, acv_any_promo: 61.8, acv_feature: 44.2, acv_display: 31.0, acv_feat_disp: 28.6, acv_tpr: 9.4, promo_units: 44100, nonpromo_units: 17240 } },
];

const jewel = genMarketRows(MARKETS.find((m) => m.code === "ALB-JEWEL"));
for (const p of PINNED) {
  const row = jewel.find((r) => r.week_ending === p.week_ending && r.upc === p.upc);
  Object.assign(row, p.vals);
}

fs.mkdirSync(OUT, { recursive: true });
const write = (nm, data) => {
  fs.writeFileSync(path.join(OUT, nm), JSON.stringify(data, null, 1) + "\n");
  console.log(nm, Array.isArray(data) ? data.length + " rows" : "");
};
write("markets.json", MARKETS.map(({ code, name, ta_name }) => ({ code, name, ta_name, active: code === "ALB-JEWEL" })));
write("items.json", ITEMS.map(({ promo_weeks, own, ...it }) => ({ ...it, is_own: own, base_price: it.base_price })));
write("nielsen-weekly.alb-jewel.json", jewel);

// sanity: pinned rows survived, totals are plausible
const s400 = jewel.filter((r) => r.upc === "0007410000123");
const promoWk = s400.find((r) => r.week_ending === "2026-04-11");
if (promoWk.units !== 61340) throw new Error("pinned row lost");
const yearUnits = s400.reduce((a, r) => a + r.units, 0);
console.log(`SPL-400 @ ALB-JEWEL: 52 wks, ${(yearUnits / 1e6).toFixed(2)}M units, ${s400.filter((r) => r.acv_any_promo > 20).length} promoted weeks`);
