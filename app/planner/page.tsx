import { listPromotions, listPromoCustomers, getPromoMeta, getPromoEnums } from "@/lib/repo";
import PlannerView, { type PromoRow, type PlannerData } from "@/components/planner/PlannerView";

/* Promotion Planner — the first rebuilt view, running on the real Telus
   FY2026 promotions snapshot. All data flows through lib/repo (the seam);
   this server component computes the rollups and hands plain props to the
   client view. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FY_START = Date.UTC(2026, 0, 1);
const FY_END = Date.UTC(2026, 11, 31);
const DAY = 86400000;

/** Spread an amount evenly across a window's days, clipped to FY2026,
    summed per month. A timing approximation, stated on the card. */
function allocateByMonth(totalByMonth: number[], amount: number, startISO: string, endISO: string, capISO?: string) {
  if (!amount) return;
  let s = Date.UTC(+startISO.slice(0, 4), +startISO.slice(5, 7) - 1, +startISO.slice(8, 10));
  let e = Date.UTC(+endISO.slice(0, 4), +endISO.slice(5, 7) - 1, +endISO.slice(8, 10));
  if (capISO) e = Math.min(e, Date.UTC(+capISO.slice(0, 4), +capISO.slice(5, 7) - 1, +capISO.slice(8, 10)));
  s = Math.max(s, FY_START);
  e = Math.min(e, FY_END);
  if (e < s) return;
  const perDay = amount / ((e - s) / DAY + 1);
  for (let t = s; t <= e; t += DAY) {
    totalByMonth[new Date(t).getUTCMonth()] += perDay;
  }
}

export default async function Page() {
  const [promos, customers, meta, enums] = await Promise.all([
    listPromotions(), listPromoCustomers(), getPromoMeta(), getPromoEnums(),
  ]);

  const plannedByMonth = Array(12).fill(0);
  const actualByMonth = Array(12).fill(0);
  for (const p of promos) {
    allocateByMonth(plannedByMonth, p.planned_amount, p.start_date, p.end_date);
    // actual spend is lifetime-to-date; pace it across the elapsed window
    allocateByMonth(actualByMonth, p.actual_amount, p.start_date, p.end_date, meta.snapshot_date);
  }

  const byStatus: Record<string, number> = {};
  for (const p of promos) byStatus[p.promo_status] = (byStatus[p.promo_status] ?? 0) + 1;

  const rows: PromoRow[] = promos.map((p) => ({
    id: p.promo_id,
    title: p.promo_title,
    status: p.promo_status,
    perf: p.performance_type,
    template: p.template_type,
    customer: p.customer_name,
    channel: p.channel,
    market: p.market,
    start: p.start_date,
    end: p.end_date,
    lines: p.line_count,
    planned: p.planned_amount,
    actual: p.actual_amount,
  }));

  const data: PlannerData = {
    meta,
    byStatus,
    months: MONTHS,
    plannedByMonth: plannedByMonth.map((v) => Math.round(v)),
    actualByMonth: actualByMonth.map((v) => Math.round(v)),
    topCustomers: customers.slice(0, 10).map((c) => ({
      name: c.customer_name, planned: Math.round(c.planned), actual: Math.round(c.actual), promos: c.promos,
    })),
    statuses: enums.promo_status,
    perfTypes: enums.performance_type,
    channels: enums.channel,
    markets: enums.market,
    rows,
  };

  return <PlannerView data={data} />;
}
