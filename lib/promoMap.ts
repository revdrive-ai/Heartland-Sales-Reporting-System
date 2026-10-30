/* Nielsen division ←→ Telus customer map for the Albertsons family — the
   PURE half. The rows live in the market_promo_customers table (fixture
   lib/fixtures/promo-map.json, read through lib/repo's getPromoMap); this
   module only shapes them and answers questions about them, so it is safe
   to import anywhere.

   The Telus book carries division-level Albertsons customers whose banners
   line up with the ALBSCO trading areas; "Safeway, Inc. (SAF100)" is the
   corporate account whose promotions apply across every division. Safeway
   Mountain West books Denver and Intermountain promotions on one planner,
   and the export's Dist Name column says which division each belongs to. */

export type PromoMapRow = {
  market_code: string;
  customer_id: string;          // Telus planner / customer id
  scope: "division" | "corporate";
  dist_name?: string | null;    // set when the customer is shared between divisions
};

export type PromoMap = {
  /** customer ids whose promotions apply to every division */
  corporate: string[];
  /** market_code → division-specific customer ids */
  byMarket: Record<string, string[]>;
  /** market_code → the shared customer and the Dist Name that means this division */
  distSplit: Record<string, { customer_id: string; dist_name: string }>;
};

export function promoMapFrom(rows: PromoMapRow[]): PromoMap {
  const corporate = new Set<string>();
  const byMarket: Record<string, string[]> = {};
  const distSplit: PromoMap["distSplit"] = {};
  for (const r of rows) {
    if (r.scope === "corporate") { corporate.add(r.customer_id); continue; }
    (byMarket[r.market_code] ??= []).push(r.customer_id);
    if (r.dist_name) distSplit[r.market_code] = { customer_id: r.customer_id, dist_name: r.dist_name };
  }
  return { corporate: [...corporate], byMarket, distSplit };
}

/** Customers whose promotions overlay a division's Nielsen trend. */
export function promoCustomersFor(map: PromoMap, market_code: string): string[] {
  return [...(map.byMarket[market_code] ?? []), ...map.corporate];
}

/** True when this promo belongs on this division's trend, dist-aware: a promo
    at a shared customer overlays one of its divisions only when its
    dist_names include that division's name; promos with no dist data keep
    the both-divisions behaviour. */
export function promoAppliesTo(map: PromoMap, market_code: string, p: { customer_id: string; dist_names?: string[] }): boolean {
  const split = map.distSplit[market_code];
  if (!split || p.customer_id !== split.customer_id) return true;
  if (!p.dist_names || p.dist_names.length === 0) return true;
  return p.dist_names.includes(split.dist_name);
}

/** NIQ brands are UPPERCASE ("SLIMFAST"); Telus line brands are title case
    ("SlimFast"). Compare on letters/digits only. */
export function normBrand(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
