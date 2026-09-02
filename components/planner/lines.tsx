"use client";

// Shared between the promotion book (row expand) and the calendar (bar
// detail): fetch-and-cache of a promo's component lines through the seam's
// API route, the lines table, and the status color map.

import { useState } from "react";
import type { PromoLine } from "@/lib/types/db";
import { fmtMoney } from "@/components/charts/themed";

export const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  Active: { bg: "var(--good-soft)", fg: "var(--good)" },
  Expiring: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  "Pre-Active": { bg: "var(--accent-soft)", fg: "var(--accent)" },
  Expired: { bg: "var(--surface-2)", fg: "var(--ink-3)" },
};

export function usePromoLines() {
  const [lines, setLines] = useState<Record<string, PromoLine[] | "loading">>({});
  const load = async (id: string) => {
    if (lines[id]) return;
    setLines((s) => ({ ...s, [id]: "loading" }));
    try {
      const res = await fetch(`/api/promos/${encodeURIComponent(id)}/lines`);
      const body = (await res.json()) as { lines: PromoLine[] };
      setLines((s) => ({ ...s, [id]: body.lines }));
    } catch {
      setLines((s) => ({ ...s, [id]: [] }));
    }
  };
  return { lines, load };
}

export function LinesTable({ rows }: { rows: PromoLine[] | "loading" | undefined }) {
  if (rows === "loading" || rows === undefined) {
    return <div style={{ padding: "12px 16px", fontSize: 12.5, color: "var(--ink-3)" }}>Loading lines…</div>;
  }
  return (
    <table style={{ fontSize: 12.5 }}>
      <thead>
        <tr>
          <th>Component</th><th>Brand</th><th>Item</th>
          <th style={{ textAlign: "right" }}>Rate</th>
          <th style={{ textAlign: "right" }}>Planned</th>
          <th style={{ textAlign: "right" }}>Actual</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((l) => (
          <tr key={l.line_id}>
            <td style={{ padding: "7px 14px" }}>{l.component_type}</td>
            <td style={{ padding: "7px 14px" }}>{l.brand}</td>
            <td style={{ padding: "7px 14px" }}>
              {l.item_description ?? "—"}
              <span style={{ color: "var(--ink-3)", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}> {l.item_number}</span>
            </td>
            <td style={{ padding: "7px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {l.rate_uom === "Lump Sum" && l.rate === 0 ? "lump sum" : `${l.rate} / ${l.rate_uom}`}
            </td>
            <td style={{ padding: "7px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.planned_amount)}</td>
            <td style={{ padding: "7px 14px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(l.actual_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
