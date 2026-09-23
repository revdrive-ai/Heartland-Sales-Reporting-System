import { getMode } from "@/lib/server/mode";
import { getScope } from "@/lib/server/scope";
import { getModeStatus } from "@/lib/server/modeStatus";
import { fy, leRollup } from "@/lib/server/leRollup";
import StandView, { type StandData } from "@/components/le/StandView";

/* Where the year stands — the estimate's first step. One account × the
   in-flight year: actuals through the NIQ edge plus the forecast to
   year-end, read against the plan, last year and the last locked estimate,
   in the four numbers the estimate is worked in. Nothing is entered here;
   it is what the month starts from. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Page() {
  const [mode, scope] = await Promise.all([getMode(), getScope()]);
  /* An LE step: it reads the in-flight year whatever the top bar's mode says. */
  const le = { ...mode, kind: "le" as const };
  const status = await getModeStatus(le, scope.marketCodes);
  if (!status) throw new Error("mode status unavailable");
  const year = status.year;

  const one = status.customers.length === 1 ? status.customers[0] : null;
  if (!one) {
    return <StandView data={{ year, customers: status.customers.length, scopeLabel: scope.label, account: null }} />;
  }

  const r = await leRollup(one.code, year);
  const t = fy(r.totals);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  const data: StandData = {
    year,
    customers: 1,
    scopeLabel: scope.label,
    account: {
      code: one.code,
      name: one.name,
      priorYear: r.priorYear,
      edge: r.edge,
      edgeMonth: r.edgeMonth,
      edgeComplete: r.edgeComplete,
      planGrowth: r.planGrowth,
      cycle: status.schedule
        ? { due: status.schedule.due.label, open: status.schedule.open.label, lockDate: status.schedule.open.lockDate, daysToLock: status.schedule.daysToLock }
        : null,
      months: MONTHS,
      kpis: {
        units: { fy: t.units, plan: t.planUnits, ly: t.lyUnits, lastLE: r.lastLE?.total ?? null, ytd: r.ytd.units, ytdLy: r.ytd.lyUnits },
        gross: { fy: t.gross, plan: t.planGross, ly: t.lyGross, lastLE: r.lastLE?.gross ?? null, ytd: r.ytd.gross, ytdLy: r.ytd.lyGross },
        trade: { fy: r.trade.estTotal, plan: r.trade.bookTotal, ly: null, lastLE: r.lastLE?.trade ?? null },
        margin: {
          fy: t.gross - r.trade.estTotal,
          plan: t.planGross - r.trade.bookTotal,
          ly: null,
          lastLE: r.lastLE && r.lastLE.gross !== null && r.lastLE.trade !== null ? r.lastLE.gross - r.lastLE.trade : null,
        },
      },
      series: {
        actU: r.totals.actU.map(Math.round), fcU: r.totals.fcU.map(Math.round), planU: r.totals.planU.map(Math.round), lyU: r.totals.lyU.map(Math.round),
        act$: r.totals.act$.map(Math.round), fc$: r.totals.fc$.map(Math.round), plan$: r.totals.plan$.map(Math.round), ly$: r.totals.ly$.map(Math.round),
        lastLeU: r.lastLE?.units ?? null,
        trade: r.trade.est.map(Math.round),
      },
      brands: Object.entries(r.brands)
        .map(([brand, b]) => {
          const f = fy(b);
          const ytd = sum(b.actU), ytdLy = r.brandYtd[brand]?.lyUnits ?? 0;
          return { brand, ytd, ytdLy, fy: f.units, plan: f.planUnits, ly: f.lyUnits, gross: f.gross, planGross: f.planGross, lyGross: f.lyGross };
        })
        .filter((b) => b.fy > 0 || b.ly > 0)
        .sort((a, b) => b.fy - a.fy),
      lastLE: r.lastLE ? { label: r.lastLE.label, takenAt: r.lastLE.takenAt } : null,
      adjustments: one.adjustments,
    },
  };
  return <StandView data={data} />;
}
