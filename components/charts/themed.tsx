"use client";

// Theme-aware Chart.js plumbing. Chart colors come from the CSS tokens at
// render time, and every chart re-renders when the mockup theme flips —
// the same behavior the reference mockup implements with destroyCharts().

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

// Controllers registered explicitly so mixed bar+line charts (the plan-year
// view) work through the generic <Chart> component.
ChartJS.register(CategoryScale, LinearScale, BarController, BarElement, LineController, PointElement, LineElement, Tooltip, Legend);

export function cssToken(name: string): string {
  if (typeof window === "undefined") return "#888";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";
}

/** Bumps once on the first client paint, when the CSS tokens become
    readable — key chart components on this value so colors resolve. */
export function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => { setTick(1); }, []);
  return tick;
}

/** Shared grid/axis options in the current theme's ink. */
export function gridOptions() {
  const line = cssToken("--line");
  const ink3 = cssToken("--ink-3");
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: ink3, boxWidth: 12, boxHeight: 12, font: { size: 11 } } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink3, font: { size: 10.5 } } },
      y: { grid: { color: line }, border: { display: false }, ticks: { color: ink3, font: { size: 10.5 } } },
    },
  };
}

export const fmtMoney = (v: number) =>
  v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString()}K` : `$${Math.round(v)}`;

/* A tooltip that sits in a strip UNDER the chart instead of following the
   cursor over it. Chart.js draws its own tooltip on the canvas, right on
   top of the lines being read; this hands the same content (the week, one
   line per series with its swatch, and any extra lines the chart's
   callbacks add) to an element the page keeps below the plot, so nothing
   is covered while the cursor moves. Takes the element's id and looks it
   up when a hover fires, so the options can be built before it is mounted
   and no ref is read in a render. */
export function readoutTooltip(elementId: string, idle = "Move across the chart for a week's values") {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return {
    enabled: false,
    external: (ctx: { tooltip: { opacity: number; title?: string[]; body?: { lines: string[] }[]; labelColors?: { borderColor?: unknown; backgroundColor?: unknown }[]; afterBody?: string[] } }) => {
      const el = typeof document === "undefined" ? null : document.getElementById(elementId);
      if (!el) return;
      const t = ctx.tooltip;
      if (!t.opacity) { el.innerHTML = `<span class="cr-idle">${esc(idle)}</span>`; return; }
      const title = (t.title ?? []).join(" ");
      const rows = (t.body ?? []).map((b, i) => {
        const c = t.labelColors?.[i];
        const col = String(c?.borderColor ?? c?.backgroundColor ?? "#888");
        return `<span class="cr-item"><i style="background:${esc(col)}"></i>${esc(b.lines.join(" "))}</span>`;
      });
      const extra = (t.afterBody ?? []).filter((l) => l.trim()).map((l) => `<span class="cr-extra">${esc(l)}</span>`);
      el.innerHTML = `<b class="cr-title">${esc(title)}</b>${rows.join("")}${extra.join("")}`;
    },
  };
}
