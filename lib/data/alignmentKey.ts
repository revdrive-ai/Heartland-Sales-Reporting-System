// Customer Alignment Key — the territory hierarchy, ported from the Heartland
// Harvest V3 mockup. Rows are channel → division → region → node (Customer or
// State). Mock stats are hash-derived exactly as the demo derives them, so the
// numbers match screen-for-screen. Persistence (the demo's localStorage
// `hhAlign` store) will live behind a store hook when the view is built.

export const FS_REGIONS = [
  "Northeast Region", "Southeast Region", "Midwest Region", "West Region",
] as const;

export const RT_REGIONS = [
  "Northeast Region", "Mid-Atlantic Region", "Southeast Region",
  "Southwest Region", "Mountain Region", "Pacific Region",
] as const;

export type Channel = "Retail" | "Food Service";
export type NodeType = "Customer" | "State";

export type AlignRow = {
  id: string;        // ALN-###
  ch: Channel;
  dv: "" | "East" | "West";
  rg: string;
  nm: string;
  ty: NodeType;
  on: boolean;
};

function buildDefault(): AlignRow[] {
  const rows: AlignRow[] = [];
  let i = 1;
  const add = (ch: Channel, dv: AlignRow["dv"], rg: string, ty: NodeType, names: string[]) =>
    names.forEach((nm) => rows.push({ id: "ALN-" + String(i++).padStart(3, "0"), ch, dv, rg, nm, ty, on: true }));

  add("Food Service", "", "Northeast Region", "State", ["New York", "Massachusetts", "Pennsylvania", "New Jersey", "Connecticut"]);
  add("Food Service", "", "Southeast Region", "State", ["Florida", "Georgia", "North Carolina", "Tennessee"]);
  add("Food Service", "", "Midwest Region", "State", ["Illinois", "Ohio", "Michigan", "Missouri", "Minnesota"]);
  add("Food Service", "", "West Region", "State", ["California", "Washington", "Arizona", "Colorado"]);
  add("Retail", "East", "Northeast Region", "Customer", ["Stop & Shop", "Wegmans", "Hannaford"]);
  add("Retail", "East", "Mid-Atlantic Region", "Customer", ["Giant Food", "Weis Markets", "ShopRite"]);
  add("Retail", "East", "Southeast Region", "Customer", ["Publix", "Harris Teeter", "Winn-Dixie"]);
  add("Retail", "West", "Southwest Region", "Customer", ["H-E-B", "Brookshire's"]);
  add("Retail", "West", "Mountain Region", "Customer", ["King Soopers", "Smith's", "Albertsons"]);
  add("Retail", "West", "Pacific Region", "Customer", ["Safeway", "Ralphs", "Vons"]);
  return rows;
}

export const ALIGN_DEFAULT: AlignRow[] = buildDefault();

/** Deterministic mock-stat hash — identical to the demo's alnHash. */
export function alnHash(s: string): number {
  let h = 7;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export type AlignStats = {
  salesM: number;   // $M sales
  vsPlan: number;   // points vs plan
  spendM: number;   // $M trade spend
  roi: number;      // blended ROI ×
  flags: number;    // open exceptions
};

/** Mock per-node stats — identical formulas to the demo's alnStats. */
export function alnStats(r: AlignRow): AlignStats {
  const h = alnHash(r.nm);
  const salesM = r.ty === "Customer" ? 8 + (h % 38) : 2 + (h % 12);
  return {
    salesM,
    vsPlan: (h % 15) - 6,
    spendM: +(salesM * 0.022).toFixed(2),
    roi: +(1.5 + (h % 18) / 10).toFixed(1),
    flags: h % 6 === 0 ? 1 + (h % 2) : 0,
  };
}

export type AlignScope =
  | "Total Company" | "Retail" | "Food Service" | "Retail — East" | "Retail — West";

/** Scope filter — identical semantics to the demo's alnInScope. */
export function alnInScope(r: AlignRow, scope: AlignScope): boolean {
  if (scope === "Retail") return r.ch === "Retail";
  if (scope === "Food Service") return r.ch === "Food Service";
  if (scope === "Retail — East") return r.ch === "Retail" && r.dv === "East";
  if (scope === "Retail — West") return r.ch === "Retail" && r.dv === "West";
  return true;
}
