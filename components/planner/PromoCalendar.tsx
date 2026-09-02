"use client";

// Promotion calendar — Gantt lanes over FY2026, grouped by customer, driven
// by the same filtered rows as the promotion book. Bar color = status; the
// inner fill shows how much of the planned amount has actually been spent.
// Clicking a bar opens the promo's window economics and component lines.

import { Fragment, useMemo, useState } from "react";
import { fmtMoney } from "@/components/charts/themed";
import { LinesTable, usePromoLines } from "./lines";
import type { PromoRow } from "./PlannerView";

const FY_START = Date.UTC(2026, 0, 1);
const FY_DAYS = 365;
const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayOf(iso: string): number {
  const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return (t - FY_START) / DAY;
}
const pct = (day: number) => `${((Math.min(Math.max(day, 0), FY_DAYS) / FY_DAYS) * 100).toFixed(3)}%`;

const STATUS_CLASS: Record<string, string> = {
  Active: "st-active", Expiring: "st-expiring", "Pre-Active": "st-pre-active", Expired: "st-expired",
};

const GROUP_CAP = 40;   // customers rendered before "show more"
const LANE_CAP = 400;   // total lanes rendered before "show more"

export default function PromoCalendar({ rows, snapshot }: { rows: PromoRow[]; snapshot: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [groupCap, setGroupCap] = useState(GROUP_CAP);
  const { lines, load } = usePromoLines();

  const groups = useMemo(() => {
    const by = new Map<string, { name: string; planned: number; actual: number; rows: PromoRow[] }>();
    for (const r of rows) {
      const g = by.get(r.customer) ?? { name: r.customer, planned: 0, actual: 0, rows: [] };
      g.planned += r.planned;
      g.actual += r.actual;
      g.rows.push(r);
      by.set(r.customer, g);
    }
    const out = [...by.values()].sort((a, b) => b.planned - a.planned);
    out.forEach((g) => g.rows.sort((a, b) => a.start.localeCompare(b.start) || b.planned - a.planned));
    return out;
  }, [rows]);

  let lanes = 0;
  const shown = groups.slice(0, groupCap).filter((g) => (lanes += g.rows.length) <= LANE_CAP + g.rows.length);
  const hiddenGroups = groups.length - shown.length;

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next) void load(next);
  };

  const snapDay = dayOf(snapshot);

  return (
    <div className="pcal">
      <div className="pcal-inner">
        <div className="pcal-months">
          {MONTHS.map((m) => <span key={m}>{m}</span>)}
        </div>

        <div className="pcal-body">
          <div className="pcal-grid" aria-hidden="true">
            {MONTHS.map((_, i) => i > 0 && (
              <div key={i} className="pcal-gridline" style={{ left: pct(dayOf(`2026-${String(i + 1).padStart(2, "0")}-01`)) }} />
            ))}
            <div className="pcal-snapshot" data-label={`snapshot ${snapshot}`} style={{ left: pct(snapDay) }} />
          </div>

          {shown.map((g) => (
            <Fragment key={g.name}>
              <div className="pcal-group">
                {g.name}
                <span className="sub">
                  {g.rows.length} promo{g.rows.length === 1 ? "" : "s"} · {fmtMoney(g.planned)} planned · {fmtMoney(g.actual)} actual
                </span>
              </div>
              {g.rows.map((r) => {
                const s = dayOf(r.start), e = dayOf(r.end);
                const leftDay = Math.max(s, 0);
                const widthDays = Math.max(Math.min(e, FY_DAYS) - leftDay + 1, 2);
                const consumed = r.planned > 0 ? Math.min(r.actual / r.planned, 1) : r.actual > 0 ? 1 : 0;
                const isOpen = open === r.id;
                const nearRightEdge = leftDay + widthDays > FY_DAYS * 0.86;
                return (
                  <Fragment key={r.id}>
                    <div className="pcal-row">
                      <div className="pcal-label" title={r.title}>
                        <div className="t">{r.title}</div>
                        <div className="s">{r.id} · {r.perf}</div>
                      </div>
                      <div className="pcal-lane">
                        <button
                          type="button"
                          className={`pcal-bar ${STATUS_CLASS[r.status] ?? "st-expired"}${isOpen ? " open" : ""}${nearRightEdge ? " at-right" : ""}`}
                          style={{ left: pct(leftDay), width: `calc(${pct(widthDays)} - 2px)` }}
                          title={`${r.title}\n${r.status} · ${r.perf}\n${r.start} → ${r.end}\nPlanned ${fmtMoney(r.planned)} · Actual ${fmtMoney(r.actual)}`}
                          aria-expanded={isOpen}
                          onClick={() => toggle(r.id)}
                        >
                          {consumed > 0 && <span className="pcal-fill" style={{ width: `calc(${(consumed * 100).toFixed(1)}% - 6px)` }} />}
                          <span className="amt">{fmtMoney(r.planned)}</span>
                        </button>
                      </div>
                      {isOpen && (
                        <div className="pcal-detail">
                          <div className="head">
                            <b>{r.title}</b>
                            <span className="m">{r.start} → {r.end}</span>
                            <span className="m">{r.status} · {r.perf} · {r.template}</span>
                            <span className="m">Planned {fmtMoney(r.planned)} · Actual {fmtMoney(r.actual)}
                              {r.planned > 0 ? ` · ${Math.round((r.actual / r.planned) * 100)}% consumed` : r.actual > 0 ? " · unplanned" : ""}</span>
                          </div>
                          <LinesTable rows={lines[r.id]} />
                        </div>
                      )}
                    </div>
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </div>

        {hiddenGroups > 0 && (
          <div style={{ padding: "12px 14px" }}>
            <button className="btn" onClick={() => setGroupCap((c) => c + GROUP_CAP)}>
              Show more — {hiddenGroups} more customer{hiddenGroups === 1 ? "" : "s"}
            </button>
          </div>
        )}

        <div className="pcal-legend">
          <span className="pcal-key"><i style={{ background: "var(--good-soft)", borderColor: "var(--good)" }} /> Active</span>
          <span className="pcal-key"><i style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }} /> Expiring</span>
          <span className="pcal-key"><i style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }} /> Pre-Active</span>
          <span className="pcal-key"><i style={{ background: "var(--surface-2)", borderColor: "var(--ink-3)" }} /> Expired</span>
          <span style={{ marginLeft: "auto" }}>Inner fill = share of planned actually spent · click a bar for its component lines</span>
        </div>
      </div>
    </div>
  );
}
