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

/* ------------------------------------------------------------- PROMOTIONS
   From the Telus retail promotions export, via the import template's two
   linked tables (join on promo_id). See scripts/ingest_promos.py. */

export type PromoStatus = "Active" | "Expired" | "Expiring" | "Pre-Active";

/** One promotion header — who, what, when, status. Rollups are recomputed
    from the lines at ingest (the money lives on the lines). */
export type Promotion = {
  promo_id: string;          // Telus 'Promo ID Base', e.g. PRG-1004160
  promo_title: string;
  fiscal_year: number;
  promo_status: PromoStatus;
  template_type: string;
  performance_type: string;  // TPR | EDLP | Feature | Feature & Display | ...
  customer_id: string;       // Telus 'planner' = customer/account
  customer_name: string;
  customer_code: string | null;
  channel: "Direct" | "Wholesaler";
  market: "US" | "Canada";
  planner_template: string;  // traceability back to Telus
  start_date: string;        // ISO date
  end_date: string;          // ISO date, >= start_date
  line_count: number;
  planned_amount: number;
  actual_amount: number;
};

/** One component + item under a promotion. line_id = promo_id | component | item. */
export type PromoLine = {
  line_id: string;
  promo_id: string;
  component_type: string;    // Scan | Ad Fee | Off Invoice - Delivered | ...
  brand: string;
  item_number: string;       // text — some codes carry leading letters/zeros
  item_description: string | null;
  rate: number;              // 0 is valid for lump-sum fee components
  rate_uom: "Case" | "Each" | "Percent" | "Lump Sum";
  planned_amount: number;
  actual_amount: number;
};

/** The Valid Values tab — controlled vocabulary for every enum field. */
export type PromoEnums = Record<string, string[]>;

export type PromoMeta = {
  source_file: string;
  snapshot_date: string;     // the Telus export's snapshot date
  fiscal_year: number;
  promotions: number;
  promo_lines: number;
  planned_total: number;
  actual_total: number;
  promos_without_lines: number;
};
