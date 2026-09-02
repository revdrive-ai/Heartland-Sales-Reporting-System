"use client";

// Theme-aware Chart.js plumbing. Chart colors come from the CSS tokens at
// render time, and every chart re-renders when the mockup theme flips —
// the same behavior the reference mockup implements with destroyCharts().

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

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
