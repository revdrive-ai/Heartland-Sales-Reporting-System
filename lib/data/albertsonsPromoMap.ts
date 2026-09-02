// Nielsen division TA ←→ Telus customer mapping for the Albertsons family.
// The Telus book carries division-level Albertsons customers whose banners
// line up with the ALBSCO trading areas; "Safeway, Inc. (SAF100)" is the
// corporate account whose promotions apply across every division. Mirrored
// by supabase/migrations/00003 (market_promo_customers) for the swap-in.

/** Telus customer_id of the corporate account — applies to all divisions. */
export const ALBERTSONS_CORPORATE = "000-1000214"; // Safeway, Inc. (SAF100)

/** market_code → division-specific Telus customer_ids. */
export const MARKET_PROMO_CUSTOMERS: Record<string, string[]> = {
  "ALB-ACME":      ["000-1000252"],                   // Safeway Mid-Atlantic (ACM100) — Acme banner
  "ALB-DENVER":    ["000-1000203"],                   // Safeway Mountain West (covers Denver + Intermountain)
  "ALB-EASTERN":   [],                                // no division customer in the book — corporate only
  "ALB-INTMTN":    ["000-1000203"],                   // Safeway Mountain West
  "ALB-JEWEL":     ["000-1000223"],                   // Jewel (JWL100)
  "ALB-NORCAL":    ["000-1000208"],                   // Safeway NorCal (SAF103)
  "ALB-PORTLAND":  ["000-1000209"],                   // Safeway Portland (SAF104)
  "ALB-SEATTLE":   ["000-1000210"],                   // Safeway Seattle (SAF105)
  "ALB-SHAWS":     ["000-1000221"],                   // Shaws Wells Grocery-Shaws (SHA100)
  "ALB-VONS":      ["000-1000211"],                   // Safeway SoCal (SAF106) — Vons banner
  "ALB-SOUTHERN":  ["000-1000212"],                   // Safeway Southern (SAF107)
  "ALB-SOUTHWEST": ["000-1000213"],                   // Safeway Southwest (SAF108)
  "ALB-UNITED":    ["000-1000291"],                   // United Supermarkets (UNI100)
};

/** Customers whose promotions overlay a division's Nielsen trend. */
export function promoCustomersFor(market_code: string): string[] {
  return [...(MARKET_PROMO_CUSTOMERS[market_code] ?? []), ALBERTSONS_CORPORATE];
}

/** NIQ brands are UPPERCASE ("SLIMFAST"); Telus line brands are title case
    ("SlimFast"). Compare on letters/digits only. */
export function normBrand(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
