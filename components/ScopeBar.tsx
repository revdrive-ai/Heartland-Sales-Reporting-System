"use client";

// The five cascading customer selectors shown at the top of every screen:
// Territory → Parent account → Sales account, plus Team lead and Account
// lead. Options facet on every other selection (pick Albertsons and only
// Albertsons choices remain), the chosen path persists in the hh-scope
// cookie, and a refresh re-scopes every server-rendered view.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applySelection, facetOptions, SCOPE_COOKIE, SCOPE_FIELDS, scopeActive, scopeRows,
  type Scope,
} from "@/lib/scope";

function writeCookie(s: Scope) {
  try {
    document.cookie = `${SCOPE_COOKIE}=${encodeURIComponent(JSON.stringify(s))}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

function Chip({
  label, value, options, onPick,
}: {
  label: string; value?: string; options: string[]; onPick: (v?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const shown = value ?? "All";
  return (
    <div
      ref={ref}
      className={"fchip" + (open ? " open" : "")}
      tabIndex={0}
      onClick={() => setOpen(!open)}
      onKeyDown={(e) => { if (e.key === "Enter") setOpen(!open); if (e.key === "Escape") setOpen(false); }}
      title={value ? `${label}: ${value}` : label}
    >
      <span className="lbl">{label}:</span>{" "}
      <b className="fval">{shown.length > 18 ? shown.slice(0, 17) + "…" : shown}</b>{" "}
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
      <div className="fmenu" style={{ maxHeight: 320, overflowY: "auto" }}>
        <button className={!value ? "cur" : undefined} onClick={(e) => { e.stopPropagation(); onPick(undefined); setOpen(false); }}>
          All
        </button>
        {options.map((o) => (
          <button key={o} className={o === value ? "cur" : undefined}
            onClick={(e) => { e.stopPropagation(); onPick(o); setOpen(false); }}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ScopeBar({ initialScope }: { initialScope: Scope }) {
  const [scope, setScope] = useState<Scope>(initialScope);
  const router = useRouter();

  const pick = (field: keyof Scope, value?: string) => {
    const next = applySelection(scope, field, value);
    setScope(next);
    writeCookie(next);
    router.refresh();
  };

  const clear = () => {
    setScope({});
    writeCookie({});
    router.refresh();
  };

  const n = scopeRows(scope).length;

  return (
    <div className="filters">
      {SCOPE_FIELDS.map((f) => (
        <Chip
          key={f.key}
          label={f.label}
          value={scope[f.key]}
          options={facetOptions(scope, f.key)}
          onPick={(v) => pick(f.key, v)}
        />
      ))}
      {scopeActive(scope) && (
        <button
          onClick={clear}
          title="Clear customer scope"
          style={{
            font: "inherit", fontSize: 11.5, fontWeight: 800, cursor: "pointer",
            border: "none", borderRadius: 9, padding: "6px 10px",
            background: "rgba(0,0,0,.18)", color: "inherit",
          }}
        >
          ✕ {n} account row{n === 1 ? "" : "s"}
        </button>
      )}
    </div>
  );
}
