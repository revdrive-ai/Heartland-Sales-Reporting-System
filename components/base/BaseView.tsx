"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import type { Plugin } from "chart.js";
import WorkflowStrip from "@/components/WorkflowStrip";
import { cssToken, fmtMoney, gridOptions, useThemeTick } from "@/components/charts/themed";
import {
  deletePlanAdjustment, getPlanAdjustments, getPlanRegistry, getPriceEdits,
  registerPlanYear, savePlanAdjustment, type PlanAdjustment,
} from "@/lib/repo/client";
import { STATUS_STYLE } from "@/components/planner/lines";
import type { PromoOverlay } from "@/lib/repo";

/* Base & Lift Lab: the division's weekly trend (actual vs NIQ base) with the
   Telus promotion windows overlaid, and — as in the reference mockup — the
   seasonality-index card beside the chart, hideable via the chip in the
   chart's header (hiding it widens the trend to the full row). Event windows
   (≤ 12 weeks) are shaded; always-on programs are listed below. */

export type WeekPoint = { week: string; actual: number | null; base: number | null; actualLY: number | null; promoAcv: number };

/** A promo overlay plus its lift read: measured over the window's weeks on
    file, and predicted from the matching weeks a year earlier. */
export type OverlayRow = PromoOverlay & {
  pred_lift: number | null;
  pred_fallback: boolean;   // no year-ago data — predicted from avg promoted-week lift
  actual_lift: number | null;
  lift_partial: boolean;    // window ends past the latest NIQ week on file
};

export type BaseData = {
  markets: { code: string; name: string }[];
  brands: string[];
  items: { upc: string; name: string }[];
  mkt: string;
  brand: string;
  item: string;              // "ALL" or a upc
  itemName: string | null;
  metric: "units" | "dollars" | "gross";
  grossCoverage: { priced: number; total: number } | null;  // gross metric: items with a list price
  win: string;               // 4w | 13w | 26w | 52w | ytd | a calendar year
  winLabel: string;
  years: number[];           // total-year choices (2024 → future, in perpetuity)
  latestDataYear: number;
  planningYear: boolean;     // a future year with no NIQ weeks on file yet
  plan: null | {             // the plan-year series (future years only)
    sourceYear: number;                 // the year the actualized base carries from
    actualized: (number | null)[];      // actual NIQ base, matching weeks a year back
    projected: (number | null)[];       // seasonality-shaped projection for the rest
    actualizedWeeks: number;
    totActualized: number;
    totProjected: number;
    itemShare: Record<string, number>;  // upc → share of brand base (latest 52w)
  };
  points: WeekPoint[];
  overlays: OverlayRow[];
  priceMarks: { date: string; label: string }[];  // dated list-price changes in the window
  season: {
    labels: string[];
    engine: (number | null)[];                       // full-history index
    years: { label: string; values: (number | null)[] }[];
  };
  totals: { actual: number; base: number; incremental: number; niqPromoWeeks: number };
  yoy: {                     // selected weeks vs the same weeks a year earlier
    actual: number | null;   // % change; null = no year-ago basis
    base: number | null;
    incremental: number | null;
    promoWeeks: number | null;
    matchedWeeks: number;    // weeks with year-ago data — the comparison basis
    totalWeeks: number;
  } | null;                  // null in planning years
  insights: {                // measured shifts that should move the plan, ranked by base-volume impact
    kind: "distribution" | "price" | "volume" | "promo" | "delisted" | "listprice";
    severity: "good" | "bad" | "info";
    title: string;
    detail: string;
    impact: number;
  }[];
  insightsTotal: number;
  liftEngine: {              // depth vs unit lift over the selection's promoted weeks, full history
    points: { week: string; d: number; l: number; tactic: string }[];
    beta: number;            // unit lift % per 1% of price depth (through-origin fit)
    r2: number;
    n: number;
    tactics: { name: string; m: number; n: number; measured: boolean }[]; // multiplier vs β
  } | null;                  // null when fewer than 3 promoted weeks
};

const DAY = 86400000;
const EVENT_MAX_DAYS = 84; // ≤ 12 weeks = an event window; longer = always-on
const LANE_H = 15;         // px per always-on lane under the x-axis
const SEAS_KEY = "hhSeasHide";
const PY_KEY = "hhShowPY";
const LANES_KEY = "hhShowLanes"; // default on
const INS_KEY = "hhInsightsHide";

const selStyle: React.CSSProperties = {
  font: "inherit", fontSize: 12.5, fontWeight: 600, color: "var(--ink)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 9, padding: "7px 10px",
};

// compact filter controls that sit inside the promo table's header cells
const thSel: React.CSSProperties = {
  font: "inherit", fontSize: 11, fontWeight: 600, color: "var(--ink-2)",
  background: "var(--surface)", border: "1px solid var(--line)",
  borderRadius: 7, padding: "3px 6px", marginTop: 5, display: "block",
  maxWidth: 160, textTransform: "none", letterSpacing: 0,
};

const utc = (isoDate: string) => Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1, +isoDate.slice(8, 10));
const durationDays = (o: PromoOverlay) => (utc(o.end_date) - utc(o.start_date)) / DAY + 1;

const fmtNum = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e3 ? Math.round(v / 1e3).toLocaleString() + "K" : String(Math.round(v)));
const fmtLift = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(0)}%`);

/** % change vs the same weeks a year earlier, colored like the dashboard. */
function YoYSub({ v, label = "vs same weeks YA" }: { v: number | null | undefined; label?: string }) {
  if (v === null || v === undefined) return <div className="k-sub flat">no year-ago basis</div>;
  const up = v >= 0;
  return (
    <div className={"k-sub " + (up ? "up" : "down")}>
      {up ? "▲" : "▼"} {Math.abs(v).toFixed(1)}% {label}
    </div>
  );
}

const YEAR_STYLES = [
  { color: "--ink-3", dash: [5, 4] as number[], width: 1.3 },
  { color: "--warn", dash: [5, 4] as number[], width: 1.3 },
  { color: "--good", dash: [] as number[], width: 1.5 },
  { color: "--bad", dash: [] as number[], width: 1.3 },
];

export default function BaseView({ data }: { data: BaseData }) {
  const tick = useThemeTick();
  const router = useRouter();
  const [seasHide, setSeasHide] = useState(false);
  const [showPY, setShowPY] = useState(false);
  const [showLanes, setShowLanes] = useState(true);
  // lift-engine predictor inputs
  const [engDepth, setEngDepth] = useState("20");
  const [engTactic, setEngTactic] = useState("Feature");
  const [insHide, setInsHide] = useState(false); // key-insights card collapsed
  // base-units export dialog
  const [expOpen, setExpOpen] = useState(false);
  const [expGran, setExpGran] = useState<"week" | "month">("week");
  const [expFmt, setExpFmt] = useState<"csv" | "xlsx">("xlsx");
  const [expAdj, setExpAdj] = useState(true); // include adjusted + Δ% rows (plan years)
  const toggleIns = () => {
    setInsHide((h) => {
      try { localStorage.setItem(INS_KEY, h ? "0" : "1"); } catch {}
      return !h;
    });
  };
  const [planReg, setPlanReg] = useState<Record<string, string>>({}); // market → registered_at, for the plan year

  const nextPlanYear = data.latestDataYear + 1;
  const planYear = data.plan ? +data.win : null;

  useEffect(() => {
    try {
      setSeasHide(localStorage.getItem(SEAS_KEY) === "1");
      setShowPY(localStorage.getItem(PY_KEY) === "1");
      setShowLanes(localStorage.getItem(LANES_KEY) !== "0");
      setInsHide(localStorage.getItem(INS_KEY) === "1");
    } catch {}
  }, []);

  // Coming into a customer's plan-year view logs that customer as registered
  // for that year (first visit stamps the date; later visits are no-ops).
  useEffect(() => {
    if (planYear) {
      registerPlanYear(data.mkt, planYear).then((r) => setPlanReg(r[String(planYear)] ?? {}));
    } else {
      getPlanRegistry().then((r) => setPlanReg(r[String(nextPlanYear)] ?? {}));
    }
  }, [data.mkt, planYear, nextPlanYear]);

  /* planner adjustments for this customer x plan year */
  const [adjs, setAdjs] = useState<PlanAdjustment[]>([]);
  const [aUpc, setAUpc] = useState("ALL");
  const [aKind, setAKind] = useState<PlanAdjustment["kind"]>("distribution");
  const [aPct, setAPct] = useState("");
  const [aFrom, setAFrom] = useState("");
  const [aTo, setATo] = useState("");
  const [aNote, setANote] = useState("");
  useEffect(() => {
    if (planYear) {
      getPlanAdjustments(data.mkt, planYear).then(setAdjs);
      setAUpc("ALL"); setAKind("distribution"); setAPct(""); setANote("");
      setAFrom(`${planYear}-01-01`); setATo(`${planYear}-12-31`);
    } else setAdjs([]);
  }, [data.mkt, planYear]);
  const addAdj = async () => {
    const pct = parseFloat(aPct);
    if (!planYear || !pct || !aFrom || !aTo || aTo < aFrom) return;
    setAdjs(await savePlanAdjustment({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      market_code: data.mkt, plan_year: planYear, brand: data.brand,
      upc: aUpc, kind: aKind, pct, from: aFrom, to: aTo,
      note: aNote.trim(), created_at: new Date().toISOString(),
    }));
    setAPct(""); setANote("");
  };
  const brandAdjs = adjs.filter((a) => a.brand === data.brand);

  /* per-week multiplier the adjustments put on the plan; item-level rows are
     weighted by the item's share of the brand base in the all-items view */
  const adjFactors = useMemo(() => {
    if (!data.plan) return [];
    return data.points.map((p) => {
      const w = utc(p.week);
      let f = 1;
      for (const a of brandAdjs) {
        if (utc(a.from) > w || utc(a.to) < w - 6 * DAY) continue;
        const weight = a.upc === "ALL" ? 1
          : data.item === "ALL" ? (data.plan!.itemShare[a.upc] ?? 0)
          : a.upc === data.item ? 1 : 0;
        f *= 1 + (a.pct / 100) * weight;
      }
      return f;
    });
  }, [data.plan, data.points, data.item, brandAdjs]);
  const hasAdj = adjFactors.some((f) => f !== 1);
  const adjustedPlan = useMemo(() => {
    if (!data.plan) return [];
    return data.points.map((_, i) => {
      const b = data.plan!.actualized[i] ?? data.plan!.projected[i];
      return b === null ? null : Math.round(b * adjFactors[i]);
    });
  }, [data.plan, data.points, adjFactors]);
  const adjTotal = adjustedPlan.reduce((a: number, v) => a + (v ?? 0), 0);
  const toggleLanes = () => {
    setShowLanes((v) => {
      try { localStorage.setItem(LANES_KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  };
  const togglePY = () => {
    setShowPY((v) => {
      try { localStorage.setItem(PY_KEY, v ? "0" : "1"); } catch {}
      return !v;
    });
  };
  const toggleSeas = () => {
    setSeasHide((h) => {
      try { localStorage.setItem(SEAS_KEY, h ? "0" : "1"); } catch {}
      return !h;
    });
  };

  const nav = (patch: Partial<Record<"mkt" | "brand" | "item" | "metric" | "win", string>>) => {
    const p = new URLSearchParams({ mkt: data.mkt, brand: data.brand, item: data.item, metric: data.metric, win: data.win, ...patch });
    router.push(`/base?${p.toString()}`);
  };

  /* Dated price-change markers: the server's (from the ingested list) plus
     any browser-local manual price changes touching this selection. */
  const [localMarks, setLocalMarks] = useState<{ date: string; label: string }[]>([]);
  useEffect(() => {
    const first = data.points[0]?.week, last = data.points.at(-1)?.week;
    if (!first || !last) { setLocalMarks([]); return; }
    const sel = new Set(data.item === "ALL" ? data.items.map((i) => i.upc) : [data.item]);
    getPriceEdits().then((es) => setLocalMarks(
      es.filter((e) => e.upc && sel.has(e.upc) && e.effective_from >= first && e.effective_from <= last)
        .map((e) => ({ date: e.effective_from, label: `manual${e.unit_price !== null ? ` $${e.unit_price.toFixed(2)}` : ""}` }))
    ));
  }, [data.item, data.items, data.points]);
  const priceMarks = useMemo(
    () => [...data.priceMarks, ...localMarks].sort((a, b) => a.date.localeCompare(b.date)),
    [data.priceMarks, localMarks]
  );

  /* The projected series with the last actualized week copied in, so the
     orange projection line connects to the end of the blue actualized line. */
  const planProjected = useMemo(() => {
    if (!data.plan) return [];
    const arr = [...data.plan.projected];
    const seam = data.plan.actualizedWeeks - 1;
    if (seam >= 0 && seam < arr.length && arr[seam] === null) arr[seam] = data.plan.actualized[seam];
    return arr;
  }, [data.plan]);

  const events = data.overlays.filter((o) => durationDays(o) <= EVENT_MAX_DAYS);
  const alwaysOn = data.overlays.filter((o) => durationDays(o) > EVENT_MAX_DAYS);

  /* header filters on the promotion-windows table (table only — the chart
     overlays are untouched) */
  const [fKind, setFKind] = useState("all");     // all | event | always
  const [fText, setFText] = useState("");
  const [fCust, setFCust] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const [fType, setFType] = useState("all");
  useEffect(() => { setFKind("all"); setFText(""); setFCust("all"); setFStatus("all"); setFType("all"); },
    [data.mkt, data.brand, data.win]);
  const custOpts = useMemo(() => [...new Set(data.overlays.map((o) => o.customer_name))].sort(), [data.overlays]);
  const statusOpts = useMemo(() => [...new Set(data.overlays.map((o) => o.promo_status))].sort(), [data.overlays]);
  const typeOpts = useMemo(() => [...new Set(data.overlays.map((o) => o.performance_type))].sort(), [data.overlays]);
  const filtersOn = fKind !== "all" || fText !== "" || fCust !== "all" || fStatus !== "all" || fType !== "all";
  const tableRows = data.overlays.filter((o) =>
    (fKind === "all" || (durationDays(o) <= EVENT_MAX_DAYS ? "event" : "always") === fKind) &&
    (fCust === "all" || o.customer_name === fCust) &&
    (fStatus === "all" || o.promo_status === fStatus) &&
    (fType === "all" || o.performance_type === fType) &&
    (!fText || o.promo_title.toLowerCase().includes(fText.toLowerCase()))
  );

  /* week index ranges each shaded promo covers (a week_ending Saturday covers
     the 7 days ending that day) */
  const bands = useMemo(() => {
    const weekTs = data.points.map((p) => utc(p.week));
    const toBand = (o: PromoOverlay) => {
      const s = utc(o.start_date), e = utc(o.end_date);
      let i0 = -1, i1 = -1;
      weekTs.forEach((w, i) => {
        const overlaps = s <= w && e >= w - 6 * DAY;
        if (overlaps) { if (i0 < 0) i0 = i; i1 = i; }
      });
      return i0 < 0 ? null : { i0, i1 };
    };
    return {
      events: events.map(toBand).filter((b): b is { i0: number; i1: number } => !!b),
      // one lane per always-on program (EDLP etc.), label + where it runs
      lanes: alwaysOn.slice(0, 12).map((o) => ({
        title: o.promo_title.length > 46 ? o.promo_title.slice(0, 45) + "…" : o.promo_title,
        band: toBand(o),
      })),
      laneOverflow: Math.max(alwaysOn.length - 12, 0),
    };
  }, [data.points, data.overlays]); // eslint-disable-line react-hooks/exhaustive-deps

  /* event-window promos active per week, for the tooltip — always-on programs
     have their own lanes, so hovering a shaded band lists only its deals */
  const activeByWeek = useMemo(() => {
    return data.points.map((p) => {
      const w = utc(p.week);
      return events.filter((o) => utc(o.start_date) <= w && utc(o.end_date) >= w - 6 * DAY);
    });
  }, [data.points, data.overlays]); // eslint-disable-line react-hooks/exhaustive-deps

  const bandPlugin: Plugin<"line"> = useMemo(() => ({
    id: "promoBands",
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      if (!x || !chartArea) return;
      const half = data.points.length > 1
        ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2
        : (chartArea.right - chartArea.left) / 2;
      const draw = (list: { i0: number; i1: number }[], color: string, alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        for (const b of list) {
          const x0 = Math.max(x.getPixelForValue(b.i0) - half, chartArea.left);
          const x1 = Math.min(x.getPixelForValue(b.i1) + half, chartArea.right);
          ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        }
        ctx.restore();
      };
      draw(bands.events, cssToken("--warn"), 0.16);
      // dated price-change markers: dashed vertical line at the week the new
      // list price takes effect, labeled at the top of the plot
      if (priceMarks.length) {
        const weekTs = data.points.map((p) => utc(p.week));
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = cssToken("--bad");
        ctx.fillStyle = cssToken("--bad");
        ctx.font = "700 9.5px " + getComputedStyle(document.body).fontFamily;
        for (const mk of priceMarks) {
          const t = utc(mk.date);
          const i = weekTs.findIndex((w) => w >= t);
          if (i < 0) continue;
          const px = x.getPixelForValue(i) - half;
          if (px < chartArea.left || px > chartArea.right) continue;
          ctx.beginPath();
          ctx.moveTo(px, chartArea.top);
          ctx.lineTo(px, chartArea.bottom);
          ctx.stroke();
          ctx.fillText("$ " + mk.label, Math.min(px + 4, chartArea.right - 90), chartArea.top + 9);
        }
        ctx.restore();
      }
    },
    afterDraw(chart) {
      // Dedicated always-on lanes: one strip per EDLP-style program, pinned
      // under the x-axis on the same week scale — strip = the program is
      // live that week, gap = it is not.
      if (!showLanes || !bands.lanes.length) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      if (!x || !chartArea) return;
      const half = data.points.length > 1
        ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2
        : (chartArea.right - chartArea.left) / 2;
      const y0 = (scales.x.bottom ?? chartArea.bottom) + 6;
      ctx.save();
      ctx.font = "700 9px " + getComputedStyle(document.body).fontFamily;
      ctx.textBaseline = "middle";
      ctx.fillStyle = cssToken("--ink-3");
      ctx.fillText("ALWAYS-ON", chartArea.left, y0 + 4);
      bands.lanes.forEach((lane, i) => {
        const y = y0 + 12 + i * LANE_H;
        if (lane.band) {
          const x0 = Math.max(x.getPixelForValue(lane.band.i0) - half, chartArea.left);
          const x1 = Math.min(x.getPixelForValue(lane.band.i1) + half, chartArea.right);
          ctx.fillStyle = cssToken("--accent");
          ctx.globalAlpha = 0.28;
          ctx.beginPath();
          ctx.roundRect(x0, y, Math.max(x1 - x0, 4), LANE_H - 4, 3);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = lane.band ? cssToken("--ink-2") : cssToken("--ink-3");
        ctx.font = "600 9.5px " + getComputedStyle(document.body).fontFamily;
        ctx.fillText(lane.title + (lane.band ? "" : " — not in this window"), chartArea.left + 5, y + (LANE_H - 4) / 2 + 1);
      });
      if (bands.laneOverflow > 0) {
        ctx.fillStyle = cssToken("--ink-3");
        ctx.fillText(`+${bands.laneOverflow} more always-on — see the table below`, chartArea.left + 5, y0 + 12 + bands.lanes.length * LANE_H + 5);
      }
      ctx.restore();
    },
  }), [bands, showLanes, priceMarks, data.points.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const liftPct = data.totals.base > 0 ? (data.totals.incremental / data.totals.base) * 100 : 0;
  const marketName = data.markets.find((m) => m.code === data.mkt)?.name ?? data.mkt;
  const scopeName = data.itemName ?? data.brand;
  const fmtVal = data.metric === "units" ? (v: number) => fmtNum(v) : fmtMoney;
  // YoY compares only the weeks with year-ago data — call out partial coverage
  const yoyLabel = data.yoy && data.yoy.matchedWeeks < data.yoy.totalWeeks
    ? `vs YA (${data.yoy.matchedWeeks} matched wks)` : "vs same weeks YA";
  const metricLabel = data.metric === "units" ? "units" : data.metric === "dollars" ? "retail dollars" : "gross dollars (list price)";

  const opts = useMemo(() => {
    const o = gridOptions();
    const laneSpace = showLanes && bands.lanes.length ? 18 + bands.lanes.length * LANE_H + (bands.laneOverflow ? 14 : 0) : 0;
    return {
      ...o,
      layout: { padding: { bottom: laneSpace } },
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        ...o.plugins,
        tooltip: {
          callbacks: {
            afterBody: (items: { dataIndex: number }[]) => {
              const i = items[0]?.dataIndex ?? 0;
              const list = activeByWeek[i] ?? [];
              if (!list.length) return "";
              const names = list.slice(0, 6).map((p) => `• ${p.promo_title} (${p.performance_type})`);
              if (list.length > 6) names.push(`… +${list.length - 6} more`);
              return ["", "Event deals this week:", ...names].join("\n");
            },
          },
        },
      },
    };
  }, [activeByWeek, bands, showLanes, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="view active">
      <WorkflowStrip current="base" />

      <div className="pagehead">
        <div>
          <div className="crumb">Trade Workflow · Step 1</div>
          <h1>Base &amp; Lift Lab</h1>
          <p>
            NIQ weekly {metricLabel} for {scopeName} at {marketName} — actual against NIQ&apos;s modelled base,
            with the Telus promotion windows for this division overlaid. Event windows are shaded;
            always-on programs are listed below.
          </p>
        </div>
        <div className="actions">
          <button
            className="btn"
            style={{ ...selStyle, cursor: "pointer" }}
            title="Export this selection's base units — brand by item, weekly or monthly, CSV or Excel; plan years export the carried + projected base"
            onClick={() => setExpOpen(true)}
          >
            ⬇ Export base
          </button>
          {planYear ? (
            <span className="pill" style={{ borderColor: "var(--good)", color: "var(--good)" }}>
              ✓ {planYear} registered for {marketName}
              {planReg[data.mkt] ? ` · ${planReg[data.mkt].slice(0, 10)}` : ""}
              {" · "}{Object.keys(planReg).length} of {data.markets.length} customers
            </span>
          ) : (
            <button
              className="btn"
              style={{ ...selStyle, cursor: "pointer" }}
              title={`Open the ${nextPlanYear} plan for ${marketName}: ${data.latestDataYear} actual base carried in as far as the year has actualized, the rest projected — and log this customer as registered for ${nextPlanYear}.`}
              onClick={() => {
                registerPlanYear(data.mkt, nextPlanYear).then(() => nav({ win: String(nextPlanYear) }));
              }}
            >
              ▸ Plan {nextPlanYear}
            </button>
          )}
          <span className="pill">{data.winLabel} · {data.points[0]?.week} → {data.points.at(-1)?.week}</span>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 9, alignItems: "center", marginBottom: 16 }}>
        <select style={selStyle} value={data.mkt} onChange={(e) => nav({ mkt: e.target.value })}>
          {data.markets.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
        </select>
        <select style={selStyle} value={data.brand} onChange={(e) => nav({ brand: e.target.value, item: "ALL" })}>
          {data.brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <select
          style={{ ...selStyle, maxWidth: 340 }}
          value={data.item}
          onChange={(e) => nav({ item: e.target.value })}
          title="Items with volume at this division in the latest 52 NIQ weeks"
        >
          <option value="ALL">All {data.brand} items ({data.items.length})</option>
          {data.items.map((i) => (
            <option key={i.upc} value={i.upc}>{i.name.length > 44 ? i.name.slice(0, 43) + "…" : i.name}</option>
          ))}
        </select>
        <select
          style={selStyle}
          value={data.metric}
          onChange={(e) => nav({ metric: e.target.value })}
          title="Units, NIQ retail dollars, or gross dollars = units × the dated list price in force each week"
        >
          <option value="units">Units</option>
          <option value="dollars">Dollars — retail (NIQ)</option>
          <option value="gross">Dollars — list price (gross)</option>
        </select>
        <select
          style={selStyle}
          value={["4w", "13w", "26w", "52w", "ytd"].includes(data.win) ? data.win : ""}
          onChange={(e) => e.target.value && nav({ win: e.target.value })}
        >
          {!["4w", "13w", "26w", "52w", "ytd"].includes(data.win) && <option value="" disabled>— rolling window —</option>}
          <option value="4w">Latest 4 weeks</option>
          <option value="13w">Latest 13 weeks</option>
          <option value="26w">Latest 26 weeks</option>
          <option value="52w">Latest 52 weeks</option>
          <option value="ytd">Year to date ({data.latestDataYear})</option>
        </select>
        <select
          style={selStyle}
          value={/^\d{4}$/.test(data.win) ? data.win : ""}
          onChange={(e) => nav({ win: e.target.value || "52w" })}
          title="Total calendar year — future years open as planning views"
        >
          <option value="">Rolling window</option>
          {data.years.map((y) => (
            <option key={y} value={String(y)}>Total year {y}{y > data.latestDataYear ? " (plan)" : ""}</option>
          ))}
        </select>
      </div>

      <div className="kpis">
        {data.plan ? (<>
          <div className="kpi">
            <div className="k-top"><span className="k-label">Actualized base — carried from {data.plan.sourceYear}</span></div>
            <div className="k-val">{fmtVal(data.plan.totActualized)}</div>
            <div className="k-sub flat">{scopeName} · {data.plan.actualizedWeeks} of {data.points.length} weeks actualized</div>
          </div>
          <div className="kpi">
            <div className="k-top"><span className="k-label">Projected base — rest of year</span></div>
            <div className="k-val" style={{ color: "var(--warn)" }}>{fmtVal(data.plan.totProjected)}</div>
            <div className="k-sub flat">{data.points.length - data.plan.actualizedWeeks} weeks · seasonality-shaped</div>
          </div>
          <div className="kpi">
            <div className="k-top"><span className="k-label">Full-year plan base{hasAdj ? " — adjusted" : ""}</span></div>
            <div className="k-val">{fmtVal(hasAdj ? adjTotal : data.plan.totActualized + data.plan.totProjected)}</div>
            <div className="k-sub flat">
              {hasAdj
                ? `unadjusted ${fmtVal(data.plan.totActualized + data.plan.totProjected)} · ${brandAdjs.length} adjustment${brandAdjs.length === 1 ? "" : "s"}`
                : `${Math.round((data.plan.totActualized / Math.max(data.plan.totActualized + data.plan.totProjected, 1)) * 100)}% actualized`}
            </div>
          </div>
        </>) : (<>
          <div className="kpi">
            <div className="k-top"><span className="k-label">Actual — window total</span></div>
            <div className="k-val">{data.planningYear ? "—" : fmtVal(data.totals.actual)}</div>
            {data.yoy && <YoYSub v={data.yoy.actual} label={yoyLabel} />}
            <div className="k-sub flat">{scopeName} · {data.points.length} weeks{data.planningYear ? " · no NIQ data yet" : ""}</div>
          </div>
          <div className="kpi">
            <div className="k-top"><span className="k-label">NIQ modelled base</span></div>
            <div className="k-val">{data.planningYear ? "—" : fmtVal(data.totals.base)}</div>
            {data.yoy && <YoYSub v={data.yoy.base} label={yoyLabel} />}
            <div className="k-sub flat">non-promoted expectation</div>
          </div>
          <div className="kpi">
            <div className="k-top"><span className="k-label">Incremental vs base</span></div>
            <div className="k-val" style={{ color: data.totals.incremental >= 0 ? "var(--good)" : "var(--bad)" }}>
              {data.planningYear ? "—" : (data.totals.incremental >= 0 ? "+" : "−") + fmtVal(Math.abs(data.totals.incremental))}
            </div>
            {data.yoy && <YoYSub v={data.yoy.incremental} label={yoyLabel} />}
            <div className="k-sub flat">{data.planningYear ? "planning view" : `${liftPct >= 0 ? "+" : "−"}${Math.abs(liftPct).toFixed(1)}% lift on base`}</div>
          </div>
        </>)}
        <div className="kpi">
          <div className="k-top"><span className="k-label">Promotion windows</span></div>
          <div className="k-val">{data.overlays.length}</div>
          {data.yoy && !data.plan && <YoYSub v={data.yoy.promoWeeks} label="NIQ promo wks vs YA" />}
          <div className="k-sub flat">{events.length} events · {alwaysOn.length} always-on · NIQ saw promo support in {data.totals.niqPromoWeeks} wks</div>
        </div>
      </div>

      <div className={"grid2" + (seasHide ? " wide1" : "")}>
        <div className="card">
          <div className="c-head">
            <h3>
              {data.plan
                ? <>Plan {data.win} — {data.plan.sourceYear} actualized base + projected remainder</>
                : <>Weekly {metricLabel} — actual vs NIQ base · event windows shaded</>}
            </h3>
            <div className="chip-row">
              <span
                className={"minichip" + (showPY ? " on" : "")}
                onClick={togglePY}
                title="Overlay the same weeks a year earlier (actual sales, 52 weeks back)"
              >
                {showPY ? "✓ Year-ago actuals" : "Year-ago actuals"}
              </span>
              <span
                className={"minichip" + (showLanes ? " on" : "")}
                onClick={toggleLanes}
                title={showLanes ? "Hide the always-on program lanes under the chart" : "Show one lane per always-on program (EDLP etc.) under the chart"}
              >
                {showLanes ? "✓ Always-on lanes" : "Always-on lanes"}
              </span>
              <span
                className={"minichip" + (seasHide ? " on" : "")}
                onClick={toggleSeas}
                title={seasHide ? "Bring the seasonality card back beside the chart" : "Hide the seasonality card and widen this chart to the full row"}
              >
                {seasHide ? "⤡ Show seasonality" : "⤢ Hide seasonality"}
              </span>
            </div>
          </div>
          <div className="chartbox" style={{ height: 320 + (showLanes && bands.lanes.length ? 18 + bands.lanes.length * LANE_H + (bands.laneOverflow ? 14 : 0) : 0) }}>
            {data.plan ? (
              <Line
                key={"plan" + tick + data.mkt + data.brand + data.item + data.metric + data.win + (showPY ? "p" : "") + brandAdjs.map((a) => a.id).join(".")}
                plugins={[bandPlugin]}
                data={{
                  labels: data.points.map((p) => p.week.slice(5)),
                  datasets: [
                    {
                      label: `${data.plan.sourceYear} base — actualized`,
                      data: data.plan.actualized,
                      borderColor: cssToken("--accent"),
                      backgroundColor: cssToken("--accent"),
                      borderWidth: 2,
                      tension: 0.25,
                      spanGaps: false,
                      pointRadius: 0,
                      pointHoverRadius: 4,
                    },
                    // prior-year actual sales (promos included), same aligned weeks —
                    // the toggle chip drives this here just as on the trend view
                    ...(showPY ? [{
                      label: `${data.plan.sourceYear} actuals`,
                      data: data.points.map((p) => p.actualLY),
                      borderColor: cssToken("--good"),
                      backgroundColor: cssToken("--good"),
                      borderWidth: 1.6,
                      tension: 0.25,
                      spanGaps: false,
                      pointRadius: 0,
                      pointHoverRadius: 4,
                    }] : []),
                    {
                      label: "Projected base — rest of year",
                      // repeats the last actualized week so the two lines connect
                      data: planProjected,
                      borderColor: cssToken("--warn"),
                      backgroundColor: cssToken("--warn"),
                      borderDash: [6, 4],
                      borderWidth: 2,
                      tension: 0.3,
                      spanGaps: false,
                      pointRadius: 0,
                      pointHoverRadius: 4,
                    },
                    // the plan after the planner's adjustments below
                    ...(hasAdj ? [{
                      label: "Adjusted plan",
                      data: adjustedPlan,
                      borderColor: cssToken("--ink"),
                      backgroundColor: cssToken("--ink"),
                      borderWidth: 2.2,
                      tension: 0.25,
                      spanGaps: false,
                      pointRadius: 0,
                      pointHoverRadius: 4,
                    }] : []),
                  ],
                }}
                options={opts}
              />
            ) : (
            <Line
              key={"b" + tick + data.mkt + data.brand + data.item + data.metric + data.win + (seasHide ? "w" : "") + (showPY ? "p" : "") + (showLanes ? bands.lanes.length : 0)}
              plugins={[bandPlugin]}
              data={{
                labels: data.points.map((p) => p.week.slice(5)),
                datasets: [
                  {
                    label: "Actual",
                    data: data.points.map((p) => p.actual),
                    borderColor: cssToken("--accent"),
                    backgroundColor: cssToken("--accent"),
                    borderWidth: 2,
                    tension: 0.25,
                    spanGaps: false,
                    pointRadius: data.points.map((p) => (p.promoAcv >= 10 ? 3 : 0)),
                    pointHoverRadius: 5,
                  },
                  ...(showPY ? [{
                    label: "Year ago",
                    data: data.points.map((p) => p.actualLY),
                    borderColor: cssToken("--good"),
                    backgroundColor: cssToken("--good"),
                    borderWidth: 1.6,
                    tension: 0.25,
                    spanGaps: false,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                  }] : []),
                  {
                    label: "NIQ base",
                    data: data.points.map((p) => p.base),
                    borderColor: cssToken("--ink-3"),
                    backgroundColor: cssToken("--ink-3"),
                    borderDash: [6, 4],
                    borderWidth: 1.6,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                  },
                ],
              }}
              options={opts}
            />
            )}
          </div>
          <div className="note">
            {data.plan
              ? <>◇ <b>Plan {data.win}</b>: the blue line carries the <b>actual NIQ base</b> from the matching {data.plan.sourceYear} weeks
                — as far as {data.plan.sourceYear} has actualized ({data.plan.actualizedWeeks} weeks, through {data.points[data.plan.actualizedWeeks - 1]?.week ?? "—"}).
                The amber dashed line <b>projects the rest of the year</b>: the latest-52-week average base shaped by this
                selection&apos;s seasonality engine. Both firm up as {data.plan.sourceYear} weeks land. Opening this view logged{" "}
                <b>{marketName}</b> as registered for {data.win} ({Object.keys(planReg).length} of {data.markets.length} customers so far).</>
              : data.planningYear
              ? <>◇ <b>{data.winLabel}</b> is a planning view: its {data.points.length} NIQ weeks aren&apos;t on file yet, so the
                axis shows the expected week-endings and the trend fills in as data (and next year&apos;s Telus book) lands.
                The seasonality card still reads from full history.</>
              : <>◇ Amber bands are Telus <b>event windows</b> (≤ 12 weeks); the blue lanes underneath are the
                <b> always-on programs</b> (EDLP etc.), one per program, showing exactly when each runs and when it
                doesn&apos;t{data.item !== "ALL" ? " — windows are brand-level, not item-level" : ""}. Dots on the actual
                line mark weeks where NIQ measured promo support on shelf (≥ 10 %ACV).
                {data.grossCoverage && <> <b>Gross</b> = units × the dated list price in force each week —{" "}
                {data.grossCoverage.priced} of {data.grossCoverage.total} item{data.grossCoverage.total === 1 ? "" : "s"} in
                this selection {data.grossCoverage.priced === 1 && data.grossCoverage.total === 1 ? "is" : "are"} priced;
                unpriced items contribute $0 (see the Price List).</>}</>}
          </div>
        </div>

        {!seasHide && (
          <div className="card">
            <div className="c-head">
              <h3>Seasonality index</h3>
              <span className="sub">{marketName} · {data.itemName ? "this item" : data.brand}</span>
            </div>
            <div className="chartbox" style={{ height: 320 }}>
              <Line
                key={"s" + tick + data.mkt + data.brand + data.item}
                data={{
                  labels: data.season.labels,
                  datasets: [
                    {
                      label: "Index — engine (full history)",
                      data: data.season.engine,
                      borderColor: cssToken("--accent"),
                      backgroundColor: "rgba(37,99,235,.10)",
                      borderWidth: 3,
                      pointRadius: 2,
                      tension: 0.4,
                      fill: true,
                    },
                    ...data.season.years.map((y, i) => {
                      const st = YEAR_STYLES[i % YEAR_STYLES.length];
                      return {
                        label: y.label,
                        data: y.values,
                        borderColor: cssToken(st.color),
                        backgroundColor: cssToken(st.color),
                        borderWidth: st.width,
                        borderDash: st.dash,
                        pointRadius: 2,
                        tension: 0.3,
                        spanGaps: false,
                      };
                    }),
                  ],
                }}
                options={gridOptions()}
              />
            </div>
            <div className="note">
              ◇ Average weekly <b>base</b> (promo-stripped) units per month ÷ the overall weekly average — 1.00 is an
              average month. The bold line is the full-history engine curve; thin lines are each year&apos;s own read.
            </div>
          </div>
        )}
      </div>

      {data.insights.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="c-head">
            <h3>Key insights — what might move the plan</h3>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="sub">
                {insHide
                  ? `${data.insightsTotal} measured shift${data.insightsTotal === 1 ? "" : "s"} flagged`
                  : "measured shifts, latest 8 weeks vs the same weeks a year ago · ranked by base-volume impact"}
              </span>
              <div className="chip-row">
                <span
                  className={"minichip" + (insHide ? "" : " on")}
                  onClick={toggleIns}
                  title={insHide ? "Open the key-insights list" : "Collapse the key-insights list — the header keeps the count"}
                >
                  {insHide ? "⊕ Show insights" : "⊖ Hide insights"}
                </span>
              </div>
            </div>
          </div>
          {!insHide && (<>
          <div>
            {data.insights.map((ins, i) => {
              const color = ins.severity === "bad" ? "var(--bad)" : ins.severity === "good" ? "var(--good)" : "var(--accent)";
              const KIND: Record<string, string> = {
                distribution: "Distribution", price: "Base price", volume: "Volume",
                promo: "Promo support", delisted: "Delisted?", listprice: "List price",
              };
              const actionable = ins.kind !== "listprice" && ins.kind !== "promo";
              return (
                <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "10px 2px", borderTop: i ? "1px solid var(--line)" : "none" }}>
                  <span style={{ color, fontWeight: 900, fontSize: 15, lineHeight: "19px" }}>
                    {ins.severity === "bad" ? "▼" : ins.severity === "good" ? "▲" : "◇"}
                  </span>
                  <div style={{ flex: 1 }}>
                    <b style={{ fontSize: 13 }}>{ins.title}</b>
                    <span className="badge" style={{ marginLeft: 8, background: "var(--surface-2)", color: "var(--ink-3)" }}>{KIND[ins.kind]}</span>
                    <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>{ins.detail}</div>
                  </div>
                  {actionable && (
                    <span
                      className="minichip"
                      style={{ cursor: "pointer", whiteSpace: "nowrap", marginTop: 2 }}
                      title={`Open the ${nextPlanYear} plan view — the adjustments card there takes distribution, price and trend corrections per item`}
                      onClick={() => nav({ win: String(nextPlanYear) })}
                    >
                      Adjust in Plan {nextPlanYear} →
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            ◇ Flags: distribution moves ≥ 10 %ACV pts, base-price moves ≥ 3%, unexplained base-volume breaks ≥ 20%,
            promo-support swings ≥ 4 weeks, dated list-price changes near the data edge, and items with year-ago
            volume but nothing measured in 6 weeks. Small items stay quiet.
            {data.insightsTotal > data.insights.length && <> Showing the top {data.insights.length} of {data.insightsTotal} by impact.</>}
          </div>
          </>)}
        </div>
      )}

      {data.liftEngine && (() => {
        const eng = data.liftEngine;
        const maxD = Math.max(...eng.points.map((p) => p.d)) + 4;
        const depth = Math.max(0, Math.min(70, parseFloat(engDepth) || 0));
        const tac = eng.tactics.find((t) => t.name === engTactic) ?? eng.tactics[1];
        const predicted = eng.beta * depth * tac.m;
        return (
          <div className="grid2b" style={{ marginTop: 16 }}>
            <div className="card">
              <div className="c-head">
                <h3>Lift engine — depth vs unit lift · {scopeName}</h3>
                <span className="sub" title="Each dot is one promoted week (NIQ saw ≥ 10 %ACV support): depth = 1 − promoted price ÷ base price, lift = units ÷ base units − 1, both measured from the feed. The dashed line is the through-origin fit lift = β × depth.">
                  {marketName} · measured promoted weeks ⓘ
                </span>
              </div>
              <div className="chartbox" style={{ height: 260 }}>
                <Line
                  key={"le" + tick + data.mkt + data.brand + data.item}
                  data={{
                    datasets: [
                      {
                        label: "Promoted weeks",
                        data: eng.points.map((p) => ({ x: p.d, y: p.l })),
                        showLine: false,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        borderColor: cssToken("--accent"),
                        backgroundColor: cssToken("--accent"),
                      },
                      {
                        label: "lift = β × depth",
                        data: [{ x: 0, y: 0 }, { x: maxD, y: eng.beta * maxD }],
                        borderColor: cssToken("--warn"),
                        backgroundColor: cssToken("--warn"),
                        borderDash: [7, 5],
                        borderWidth: 2,
                        pointRadius: 0,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: (c: { datasetIndex: number; dataIndex: number }) => {
                            if (c.datasetIndex !== 0) return "";
                            const p = eng.points[c.dataIndex];
                            return `${p.week} · ${p.tactic} · ${p.d}% depth → +${p.l}% lift`;
                          },
                        },
                      },
                    },
                    scales: {
                      x: {
                        type: "linear" as const, min: 0, max: maxD,
                        grid: { display: false },
                        ticks: { color: cssToken("--ink-3"), font: { size: 10.5 }, callback: (v: unknown) => v + "%" },
                        title: { display: true, text: "discount depth", color: cssToken("--ink-3"), font: { size: 10.5 } },
                      },
                      y: {
                        grid: { color: cssToken("--line") }, border: { display: false },
                        ticks: { color: cssToken("--ink-3"), font: { size: 10.5 }, callback: (v: unknown) => (Number(v) >= 0 ? "+" : "") + v + "%" },
                      },
                    },
                  }}
                />
              </div>
              <div className="note">
                ✦ <b>β = {eng.beta}</b> — each 1% of price depth ≈ +{eng.beta}% unit lift in promoted weeks ·
                R² {eng.r2.toFixed(2)} · {eng.n} promo weeks (full history). Depth and lift are <b>measured</b> per
                week from the NIQ feed — promoted vs base price, units vs base units — never inferred.
              </div>
            </div>

            <div className="card">
              <div className="c-head">
                <h3>Predict a lift for the planner</h3>
                <span className="sub">lift = β × depth × tactic multiplier</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", color: "var(--ink-3)", textTransform: "uppercase", marginBottom: 4 }}>Discount depth %</div>
                  <input style={{ ...selStyle, width: 110 }} type="number" min={0} max={70} value={engDepth} onChange={(e) => setEngDepth(e.target.value)} />
                </div>
                <div style={{ flex: 1, minWidth: 170 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".06em", color: "var(--ink-3)", textTransform: "uppercase", marginBottom: 4 }}>Tactic</div>
                  <select style={{ ...selStyle, width: "100%" }} value={engTactic} onChange={(e) => setEngTactic(e.target.value)}>
                    {eng.tactics.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name} — ×{t.m}{t.measured ? ` · ${t.n} reads` : " · default"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--brand-soft, rgba(245,197,24,.15))", borderRadius: 12, padding: "14px 16px", margin: "12px 0" }}>
                <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.5px" }}>+{Math.round(predicted)}%</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", lineHeight: 1.45 }}>
                  unit lift in promoted weeks · β {eng.beta} × {depth}% depth × {tac.m} {tac.name}
                  {!tac.measured && <span style={{ color: "var(--ink-3)" }}> (default multiplier)</span>}
                </div>
              </div>
              <div className="note" style={{ marginBottom: 10 }}>
                ✦ Weekly unit lift <b>while promoted</b> — window-level lift in the planner depends on how many weeks
                of the window run promoted. Multipliers marked with reads are <b>measured from this selection&apos;s own
                promoted weeks</b> (β per tactic ÷ β); the rest are industry defaults until that tactic runs.
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ fontSize: 12 }}>
                  <thead>
                    <tr><th>Nielsen measure</th><th>Status</th><th>Unlocks</th></tr>
                  </thead>
                  <tbody>
                    {[
                      ["$ / Units / Base $ / Base Units", "Base, depth, unit lift"],
                      ["Base price per unit", "Depth measured rather than inferred"],
                      ["TDP · %ACV distribution", "Distribution vs promo effects"],
                      ["Feature / Display / F&D / TPR breakouts", "True lift by tactic — measured multipliers"],
                      ["EQ volume", "Cross-pack comparisons"],
                    ].map(([m, u]) => (
                      <tr key={m}>
                        <td style={{ padding: "7px 12px", fontWeight: 700 }}>{m}</td>
                        <td style={{ padding: "7px 12px", color: "var(--good)", fontWeight: 800, whiteSpace: "nowrap" }}>✓ in feed</td>
                        <td style={{ padding: "7px 12px", color: "var(--ink-2)" }}>{u}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {data.plan ? (
      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <b>Planner adjustments — {data.win}</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {marketName} · {data.brand} · distribution, base price and trend levers on the plan base
          </span>
        </div>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--line)", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select style={selStyle} value={aUpc} onChange={(e) => setAUpc(e.target.value)} title="Which item the adjustment applies to">
            <option value="ALL">All {data.brand} items</option>
            {data.items.map((i) => (
              <option key={i.upc} value={i.upc}>{i.name.length > 38 ? i.name.slice(0, 37) + "…" : i.name}</option>
            ))}
          </select>
          <select style={selStyle} value={aKind} onChange={(e) => setAKind(e.target.value as PlanAdjustment["kind"])}>
            <option value="distribution">Distribution change</option>
            <option value="price">Base price change</option>
            <option value="trend">Trend override</option>
          </select>
          <input
            style={{ ...selStyle, width: 110 }}
            type="number"
            step="0.5"
            placeholder="Impact %"
            title="Expected % impact on base volume — negative for a loss (e.g. -12 for lost distribution in the largest stores)"
            value={aPct}
            onChange={(e) => setAPct(e.target.value)}
          />
          <input style={{ ...selStyle, width: 140 }} type="date" value={aFrom} onChange={(e) => setAFrom(e.target.value)} title="Takes effect" />
          <span style={{ color: "var(--ink-3)", fontSize: 12 }}>→</span>
          <input style={{ ...selStyle, width: 140 }} type="date" value={aTo} onChange={(e) => setATo(e.target.value)} title="Ends" />
          <input
            style={{ ...selStyle, flex: "1 1 200px", minWidth: 160 }}
            placeholder="Why — e.g. lost distribution in largest stores, price increase in April…"
            value={aNote}
            onChange={(e) => setANote(e.target.value)}
          />
          <button
            className="btn"
            style={{ ...selStyle, cursor: "pointer", opacity: parseFloat(aPct) ? 1 : 0.5 }}
            onClick={addAdj}
            disabled={!parseFloat(aPct)}
          >
            + Add adjustment
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Kind</th><th style={{ textAlign: "right" }}>Impact</th>
                <th>Effective</th><th>Note</th><th>Added</th><th></th>
              </tr>
            </thead>
            <tbody>
              {brandAdjs.map((a) => {
                const itemName = a.upc === "ALL" ? `All ${a.brand} items`
                  : data.items.find((i) => i.upc === a.upc)?.name ?? a.upc;
                const kindLabel = a.kind === "distribution" ? "Distribution" : a.kind === "price" ? "Base price" : "Trend";
                const share = a.upc !== "ALL" && data.item === "ALL" ? data.plan!.itemShare[a.upc] ?? 0 : null;
                return (
                  <tr key={a.id}>
                    <td style={{ padding: "9px 14px" }}>
                      <b>{itemName.length > 44 ? itemName.slice(0, 43) + "…" : itemName}</b>
                      {share !== null && (
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{(share * 100).toFixed(1)}% of brand base</div>
                      )}
                    </td>
                    <td style={{ padding: "9px 14px" }}>{kindLabel}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: a.pct >= 0 ? "var(--good)" : "var(--bad)" }}>
                      {a.pct >= 0 ? "+" : "−"}{Math.abs(a.pct)}%
                    </td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.from} → {a.to}</td>
                    <td style={{ padding: "9px 14px", fontSize: 12.5, color: "var(--ink-2)" }}>{a.note || "—"}</td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>{a.created_at.slice(0, 10)}</td>
                    <td style={{ padding: "9px 14px" }}>
                      <span
                        className="minichip"
                        style={{ cursor: "pointer" }}
                        title="Remove this adjustment"
                        onClick={() => deletePlanAdjustment(a.id, data.mkt, planYear!).then(setAdjs)}
                      >
                        ✕
                      </span>
                    </td>
                  </tr>
                );
              })}
              {brandAdjs.length === 0 && (
                <tr><td colSpan={7} style={{ padding: "16px", color: "var(--ink-3)", fontSize: 12.5 }}>
                  No adjustments yet for {marketName} · {data.brand} in {data.win}. Add one above — e.g. lost
                  distribution on an item, a coming price increase, or a trend running hotter or colder than the
                  projection — and the dark <b>Adjusted plan</b> line appears on the chart.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="note" style={{ margin: "0", padding: "10px 16px" }}>
          ◇ Impact is the expected % change to <b>base volume</b> over the effective window. Item-level adjustments
          are weighted by that item&apos;s share of the brand base when viewing all items; pick the item in the selector
          above to see its plan adjusted in full. Adjustments are saved per customer × plan year.
        </div>
      </div>
      ) : (
      <div className="card" style={{ padding: 0, marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <b>Promotion windows on this trend</b>
          <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>
            {marketName} · {data.brand}
            {filtersOn ? <> · showing {tableRows.length} of {data.overlays.length}</> : null}
            {" · "}{fmtMoney(tableRows.reduce((a, o) => a + o.planned_amount, 0))} planned{filtersOn ? " in view" : " in scope"}
          </span>
          {filtersOn && (
            <span
              className="minichip"
              style={{ cursor: "pointer" }}
              onClick={() => { setFKind("all"); setFText(""); setFCust("all"); setFStatus("all"); setFType("all"); }}
            >
              ✕ Clear filters
            </span>
          )}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>
                  Promotion
                  <span style={{ display: "flex", gap: 5 }}>
                    <select style={thSel} value={fKind} onChange={(e) => setFKind(e.target.value)}>
                      <option value="all">All kinds</option>
                      <option value="event">Events</option>
                      <option value="always">Always-on</option>
                    </select>
                    <input
                      style={{ ...thSel, width: 120 }}
                      placeholder="Search title…"
                      value={fText}
                      onChange={(e) => setFText(e.target.value)}
                    />
                  </span>
                </th>
                <th>
                  Customer
                  <select style={thSel} value={fCust} onChange={(e) => setFCust(e.target.value)}>
                    <option value="all">All ({custOpts.length})</option>
                    {custOpts.map((c) => <option key={c} value={c}>{c.length > 26 ? c.slice(0, 25) + "…" : c}</option>)}
                  </select>
                </th>
                <th>
                  Status
                  <select style={thSel} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
                    <option value="all">All</option>
                    {statusOpts.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </th>
                <th>
                  Type
                  <select style={thSel} value={fType} onChange={(e) => setFType(e.target.value)}>
                    <option value="all">All</option>
                    {typeOpts.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </th>
                <th>Window</th>
                <th style={{ textAlign: "right" }}>Weeks</th>
                <th style={{ textAlign: "right" }} title="Expected lift: actual vs NIQ base over the matching weeks a year earlier († = no year-ago data, so it uses this selection's average lift in NIQ-promoted weeks)">
                  Pred. lift
                </th>
                <th style={{ textAlign: "right" }} title="Measured lift: actual vs NIQ base over this window's weeks on file (⏳ = window not fully actualized yet)">
                  Actual lift
                </th>
                <th style={{ textAlign: "right" }}>Planned $</th>
                <th style={{ textAlign: "right" }}>Actual $</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((o) => {
                const st = STATUS_STYLE[o.promo_status] ?? STATUS_STYLE.Expired;
                const days = durationDays(o);
                const isEvent = days <= EVENT_MAX_DAYS;
                return (
                  <tr key={o.promo_id}>
                    <td style={{ padding: "9px 14px" }}>
                      <b>{o.promo_title}</b>
                      <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "ui-monospace, Menlo, monospace" }}>
                        {o.promo_id} · {isEvent ? "event" : "always-on"}
                      </div>
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {o.customer_name}
                      {o.corporate && <span className="badge" style={{ marginLeft: 6, background: "var(--surface-2)", color: "var(--ink-3)" }}>corporate</span>}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      <span className="badge" style={{ background: st.bg, color: st.fg }}>{o.promo_status}</span>
                    </td>
                    <td style={{ padding: "9px 14px" }}>{o.performance_type}</td>
                    <td style={{ padding: "9px 14px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{o.start_date} → {o.end_date}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(days / 7)}</td>
                    <td
                      style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--ink-2)" }}
                      title={o.pred_fallback && o.pred_lift !== null ? "No year-ago data for this window — predicted from this selection's average lift in NIQ-promoted weeks" : "Actual vs NIQ base over the matching weeks a year earlier"}
                    >
                      {fmtLift(o.pred_lift)}{o.pred_fallback && o.pred_lift !== null ? " †" : ""}
                    </td>
                    <td
                      style={{
                        padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 700,
                        color: o.actual_lift === null ? "var(--ink-3)" : o.actual_lift >= 0 ? "var(--good)" : "var(--bad)",
                      }}
                      title={o.lift_partial ? "Window not fully actualized — lift over its weeks with NIQ data so far" : "Actual vs NIQ base over this window"}
                    >
                      {fmtLift(o.actual_lift)}{o.lift_partial && o.actual_lift !== null ? " ⏳" : ""}
                    </td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(o.planned_amount)}</td>
                    <td style={{ padding: "9px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(o.actual_amount)}</td>
                  </tr>
                );
              })}
              {tableRows.length === 0 && (
                <tr><td colSpan={10} style={{ padding: "16px", color: "var(--ink-3)", fontSize: 12.5 }}>
                  {data.overlays.length === 0
                    ? "No Telus promotions map to this division × brand in the window."
                    : "No promotions match the header filters — clear them above."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {expOpen && (
        <div className="modal open">
          <div className="box" style={{ width: 480 }}>
            <div className="m-head">
              <div>
                <div className="mt">Export base units</div>
                <div className="ms">
                  {marketName} · {data.brand}{data.itemName ? ` · ${data.itemName}` : " · brand by item"} · {data.winLabel}
                </div>
              </div>
              <button className="x" onClick={() => setExpOpen(false)}>✕</button>
            </div>
            <div className="m-body" style={{ padding: "14px 20px" }}>
              <div className="f-2col">
                <div className="f-row">
                  <label>Output by</label>
                  <select value={expGran} onChange={(e) => setExpGran(e.target.value as "week" | "month")}>
                    <option value="week">Week (NIQ week-endings)</option>
                    <option value="month">Month</option>
                  </select>
                </div>
                <div className="f-row">
                  <label>Format</label>
                  <select value={expFmt} onChange={(e) => setExpFmt(e.target.value as "csv" | "xlsx")}>
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="csv">CSV</option>
                  </select>
                </div>
              </div>
              {data.planningYear && (
                <div className="f-row" style={{ marginTop: 4 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: brandAdjs.length ? "pointer" : "default" }}>
                    <input
                      type="checkbox"
                      checked={expAdj && brandAdjs.length > 0}
                      disabled={brandAdjs.length === 0}
                      onChange={(e) => setExpAdj(e.target.checked)}
                    />
                    Add adjusted volume + Δ% rows
                    <span style={{ color: "var(--ink-3)", fontWeight: 600 }}>
                      {brandAdjs.length
                        ? `(${brandAdjs.length} planner adjustment${brandAdjs.length === 1 ? "" : "s"} on ${data.brand} in this browser)`
                        : "(no planner adjustments recorded for this selection)"}
                    </span>
                  </label>
                </div>
              )}
              <div className="hint" style={{ marginTop: 2 }}>
                One row per item with {expGran === "week" ? "week" : "month"} columns and totals.
                {data.planningYear
                  ? expAdj && brandAdjs.length
                    ? " Plan year: * columns are the seasonality-shaped projection. Each item gets three rows — Plan base, Adjusted (planner adjustments applied, item-level ones exactly to their item), and Δ% — so what changed reads straight off the file."
                    : " Plan year: the year-ago base carries in as far as it has actualized; * columns are the seasonality-shaped projection. Planner adjustments are not applied."
                  : " Measured NIQ base units for the selected window."}
              </div>
            </div>
            <div className="m-foot">
              <div className="right">
                <button className="btn ghost" onClick={() => setExpOpen(false)}>Cancel</button>
                <button
                  className="btn primary"
                  onClick={async () => {
                    const payload: Record<string, unknown> = {
                      mkt: data.mkt, brand: data.brand, item: data.item, win: data.win, gran: expGran, fmt: expFmt,
                    };
                    if (data.planningYear && expAdj && brandAdjs.length) {
                      payload.adjustments = brandAdjs.map((a) => ({ upc: a.upc, pct: a.pct, from: a.from, to: a.to }));
                    }
                    const res = await fetch("/api/base/export", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                    });
                    const blob = await res.blob();
                    const m = (res.headers.get("Content-Disposition") ?? "").match(/filename="([^"]+)"/);
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = m?.[1] ?? "base-units-export";
                    a.click();
                    URL.revokeObjectURL(a.href);
                    setExpOpen(false);
                  }}
                >
                  ⬇ Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
