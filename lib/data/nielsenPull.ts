// Nielsen Pull Spec — Albertsons. Ported verbatim from the Heartland Harvest V3
// mockup (source: Nielsen_Albertsons_Data_Pull_Template V1.xlsx). This is the
// data-request contract for NIQ weekly data across the thirteen Albertsons
// division trading areas — the axis the platform is being built out along,
// one division at a time.

/** The thirteen ALBSCO division trading areas. */
export const NPULL_MARKETS = [
  "ALBSCO Acme TA",
  "ALBSCO Denver Div TA",
  "ALBSCO Eastern TA",
  "ALBSCO Intermountain Div TA",
  "ALBSCO Jewel Div TA",
  "ALBSCO Nor Cal Div TA",
  "ALBSCO Portland Div TA",
  "ALBSCO Seattle Div TA",
  "ALBSCO Shaws Div TA",
  "ALBSCO So Cal Div TA",
  "ALBSCO Southern Div TA",
  "ALBSCO Southwest Div TA",
  "ALBSCO United Div TA",
] as const;

export type NpullMarket = (typeof NPULL_MARKETS)[number];

/** Brands in item scope — ours plus the competitive set. */
export const NPULL_BRANDS = [
  "Splenda",
  "SlimFast",
  "Java House",
  "Equal",
  "Whole Earth",
  "Wholesome",
] as const;

export type NpullColType = "date" | "text" | "number";

export type NpullCol = {
  name: string;
  type: NpullColType;
  required: boolean;
  description: string;
};

/** Column contract for the pull, with the demo's field-by-field rationale. */
export const NPULL_COLS: NpullCol[] = [
  { name: "week_ending", type: "date", required: true, description: "Last day of the NIQ retail week. Must be a Saturday, ISO YYYY-MM-DD." },
  { name: "upc", type: "text", required: true, description: "Full UPC including leading zeros. Send as text so zeros survive." },
  { name: "market_name", type: "text", required: true, description: "Human-readable market label as it should appear on screen." },
  { name: "units", type: "number", required: true, description: "Actual units sold in the week." },
  { name: "dollars", type: "number", required: true, description: "Actual dollar sales in the week." },
  { name: "base_units", type: "number", required: true, description: "NIQ's modelled non-promoted units — the baseline we compare our own base engine against." },
  { name: "base_dollars", type: "number", required: true, description: "NIQ's modelled non-promoted dollars." },
  { name: "price_per_unit", type: "number", required: true, description: "Average selling price in the week. Equals dollars / units." },
  { name: "eq_units", type: "number", required: false, description: "Equivalised volume on the category EQ basis. Needed to add pack sizes together at brand level." },
  { name: "base_price_per_unit", type: "number", required: false, description: "Modelled everyday price. Lets discount depth be measured rather than inferred from the price series, which otherwise misreads a permanent price change as a promotion." },
  { name: "incr_units", type: "number", required: false, description: "NIQ's own incremental units. A second opinion on incrementality; derivable as units − base_units." },
  { name: "incr_dollars", type: "number", required: false, description: "NIQ's own incremental dollars." },
  { name: "acv_dist", type: "number", required: false, description: "%ACV distribution, all outlets. Distinguishes a distribution gain from a promotional lift — the most common false positive in lift measurement." },
  { name: "tdp", type: "number", required: false, description: "Total distribution points. Item-count changes within a division." },
  { name: "acv_any_promo", type: "number", required: false, description: "%ACV with any promotional support. This is the promoted-week flag that splits base from incremental." },
  { name: "acv_feature", type: "number", required: false, description: "%ACV selling with a feature ad. Lets lift be fitted per tactic instead of one blended curve." },
  { name: "acv_display", type: "number", required: false, description: "%ACV with display support." },
  { name: "acv_feat_disp", type: "number", required: false, description: "%ACV with feature and display together. The combination is not the sum of the parts." },
  { name: "acv_tpr", type: "number", required: false, description: "%ACV on temporary price reduction only. Separates a shelf-price cut from advertised support." },
  { name: "promo_units", type: "number", required: false, description: "Units sold on promotion." },
  { name: "nonpromo_units", type: "number", required: false, description: "Units sold off promotion." },
  { name: "brand", type: "text", required: false, description: "Brand as NIQ classifies it. Needed to separate our items from competitors." },
  { name: "category", type: "text", required: false, description: "Category" },
  { name: "Super Category", type: "text", required: false, description: "Super Category" },
  { name: "Sub-Category", type: "text", required: false, description: "Subcategory." },
];

/** Exact CSV header, in contract order. */
export const NPULL_HDR = [
  "week_ending", "nielsen_item_code", "upc", "market_code", "market_name",
  "units", "dollars", "base_units", "base_dollars", "price_per_unit",
  "eq_units", "base_price_per_unit", "incr_units", "incr_dollars", "acv_dist",
  "tdp", "acv_any_promo", "acv_feature", "acv_display", "acv_feat_disp",
  "acv_tpr", "promo_units", "nonpromo_units", "brand", "category",
] as const;

/** Sample rows from the demo — one promoted and one everyday week. */
export const NPULL_ROWS: string[][] = [
  ["2026-04-04", "1234567", "0007410000123", "ALB-JEWEL", "Albertsons Jewel-Osco", "48210", "344219", "47800", "349896", "7.14", "48210", "7.32", "410", "2927", "96.4", "412", "18.2", "11.4", "4.9", "1.9", "0.0", "8900", "39310", "Splenda", "Sweeteners"],
  ["2026-04-11", "1234567", "0007410000123", "ALB-JEWEL", "Albertsons Jewel-Osco", "61340", "398097", "47900", "350628", "6.49", "61340", "7.32", "13440", "87226", "96.4", "412", "61.8", "44.2", "31.0", "28.6", "9.4", "44100", "17240", "Splenda", "Sweeteners"],
  ["2026-04-04", "9876543", "0009920000456", "ALB-VONS", "Albertsons Vons SoCal", "30120", "214756", "29800", "213964", "7.13", "30120", "7.18", "320", "2282", "88.1", "297", "4.1", "0.0", "4.1", "0.0", "0.0", "1240", "28880", "Competitor A", "Sweeteners"],
];
