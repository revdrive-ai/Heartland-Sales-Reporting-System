// Row types for the data seam. Field names are the future Supabase column
// names (snake_case) — the fixtures serialize these shapes, the SQL in
// supabase/migrations/ declares them, and the repo layer returns them.
// When Supabase lands these are replaced by generated types
// (supabase gen types typescript), which must stay assignment-compatible.

export type Market = {
  code: string;      // e.g. "ALB-JEWEL"
  name: string;      // e.g. "Albertsons Jewel-Osco"
  ta_name: string;   // e.g. "ALBSCO Jewel Div TA"
  active: boolean;   // divisions are activated one at a time
};

export type Item = {
  upc: string;                // full UPC, text so leading zeros survive
  nielsen_item_code: string;
  brand: string;
  name: string;
  category: string;
  super_category: string;
  sub_category: string;
  base_units: number;         // everyday weekly baseline (reference market)
  base_price: number;
  is_own: boolean;            // ours vs the competitive set
};

/** One NIQ retail week for one item in one market — the fact-table row.
    Mirrors the 25-column pull contract in lib/data/nielsenPull.ts. */
export type NielsenWeeklyRow = {
  week_ending: string;        // ISO date, always a Saturday
  nielsen_item_code: string;
  upc: string;
  market_code: string;
  market_name: string;
  units: number;
  dollars: number;
  base_units: number;
  base_dollars: number;
  price_per_unit: number;
  eq_units: number;
  base_price_per_unit: number;
  incr_units: number;
  incr_dollars: number;
  acv_dist: number;
  tdp: number;
  acv_any_promo: number;
  acv_feature: number;
  acv_display: number;
  acv_feat_disp: number;
  acv_tpr: number;
  promo_units: number;
  nonpromo_units: number;
  brand: string;
  category: string;
};
