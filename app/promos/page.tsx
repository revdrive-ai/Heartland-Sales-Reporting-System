import { getPromoEnums, getPromoOverlays, listBrands, listWeekEndings } from "@/lib/repo";
import { getMode } from "@/lib/server/mode";
import { getScope } from "@/lib/server/scope";
import { getModeStatus } from "@/lib/server/modeStatus";
import { getState } from "@/lib/server/appstate";
import { fy, leRollup } from "@/lib/server/leRollup";
import { readLeOverlay } from "@/lib/leovl";
import PromosView, { type PromosData } from "@/components/le/PromosView";

/* Adjust the promotions — the estimate's third step. One account × the
   in-flight year: the Telus book's promotions for that account, read
   through the estimate's overlay (lib/leovl), with the roll-up they add up
   to. Changes here reach the forecast (lib/server/fyForecast) and the trade
   line (lib/server/leRollup); the book itself is never edited. */

export default async function Page() {
  const [mode, scope] = await Promise.all([getMode(), getScope()]);
  const le = { ...mode, kind: "le" as const };
  const status = await getModeStatus(le, scope.marketCodes);
  if (!status) throw new Error("mode status unavailable");
  const year = status.year;

  const one = status.customers.length === 1 ? status.customers[0] : null;
  if (!one) {
    return <PromosView data={{ year, customers: status.customers.length, scopeLabel: scope.label, account: null }} />;
  }

  const [promos, enums, brands, weeks, ovlRaw, roll] = await Promise.all([
    getPromoOverlays({ market_code: one.code, from: `${year}-01-01`, to: `${year}-12-31` }),
    getPromoEnums(),
    listBrands({ ownOnly: true }),
    listWeekEndings(one.code),
    getState(`leovl:${one.code}:${year}`).catch(() => undefined),
    leRollup(one.code, year),
  ]);
  const edge = weeks[weeks.length - 1];
  const ovl = readLeOverlay(ovlRaw);
  const t = fy(roll.totals);

  const data: PromosData = {
    year,
    customers: 1,
    scopeLabel: scope.label,
    account: {
      code: one.code,
      name: one.name,
      edge,
      telusSnapshot: status.telusSnapshot,
      cycle: status.schedule ? { open: status.schedule.open.label, lockDate: status.schedule.open.lockDate, daysToLock: status.schedule.daysToLock } : null,
      brands,
      perfTypes: enums.performance_type ?? [],
      rows: promos
        .map((p) => ({
          id: p.promo_id, title: p.promo_title, status: p.promo_status, perf: p.performance_type,
          customer: p.customer_name, corporate: p.corporate, start: p.start_date, end: p.end_date,
          planned: Math.round(p.planned_amount), brands: p.brands,
        }))
        .sort((a, b) => a.start.localeCompare(b.start)),
      overlay: ovl,
      rollup: {
        units: t.units, planUnits: t.planUnits, gross: t.gross, planGross: t.planGross,
        trade: roll.trade.estTotal, tradeBook: roll.trade.bookTotal,
        margin: t.gross - roll.trade.estTotal,
      },
    },
  };
  return <PromosView data={data} />;
}
