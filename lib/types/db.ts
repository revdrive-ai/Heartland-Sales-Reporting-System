// Row types for the data seam. Field names are the future Supabase column
// names (snake_case) — data/nielsen/*.json.gz and lib/fixtures/*.json
// serialize these shapes, the SQL in supabase/migrations/ declares them, and
// the repo layer returns them. When Supabase lands these are replaced by
// generated types (supabase gen types typescript), assignment-compatible.

export type Market = {
  code: string;      // e.g. "ALB-JEWEL"
  name: string;      // e.g. "Albertsons Jewel-Osco"
  ta_name: string;   // e.g. "ALBSCO Jewel Div TA"
  active: boolean;
};

export type Item = {
  upc: string;             // full UPC, text so leading zeros survive
  name: string;            // NIQ item description
  brand: string;           // BRAND SHORT, e.g. "SPLENDA"
  manufacturer: string;
  super_category: string;
  category: string;
  sub_category: string;
  is_own: boolean;         // Heartland Food Products Group vs the competitive set
};

/** One NIQ retail week for one item in one market — the fact-table row.
    From the ALBSCO data pull; measures NIQ leaves blank arrive as null. */
export type NielsenWeeklyRow = {
  week_ending: string;             // ISO date, always a Saturday
  upc: string;
  market_code: string;
  market_name: string;
  units: number | null;
  dollars: number | null;
  base_units: number | null;
  base_dollars: number | null;
  price_per_unit: number | null;
  eq_units: number | null;
  base_price_per_unit: number | null;
  incr_units: number | null;       // can be negative (NIQ model)
  incr_dollars: number | null;
  acv_dist: number | null;
  tdp: number | null;
  acv_any_promo: number | null;
  acv_feature: number | null;      // feature without display
  acv_display: number | null;      // display without feature
  acv_feat_disp: number | null;
  acv_tpr: number | null;          // price decrease only
  promo_units: number | null;
  nonpromo_units: number | null;
  brand: string;
  category: string;
};
