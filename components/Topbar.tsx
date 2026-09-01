"use client";

import { useEffect, useRef, useState } from "react";

/* Topbar — brand, the three global filter chips, Ask Heartland, avatar.
   Chip values are cosmetic until views consume them; they mirror the demo's
   class-of-trade / customer / plan-year chips exactly. */

const CHIPS: { label: string; options: string[] }[] = [
  { label: "Class of trade:", options: ["All channels", "Food", "Mass", "Club", "Drug", "C-Store"] },
  { label: "Customer:", options: ["All", "Publix", "Walmart", "Kroger", "Target", "Costco", "Albertsons", "Sprouts"] },
  { label: "Plan year:", options: ["2026", "2027"] },
];

function Fchip({ label, options }: { label: string; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(options[0]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <div
      ref={ref}
      className={"fchip" + (open ? " open" : "")}
      tabIndex={0}
      onClick={() => setOpen(!open)}
      onKeyDown={(e) => { if (e.key === "Enter") setOpen(!open); if (e.key === "Escape") setOpen(false); }}
    >
      <span className="lbl">{label}</span> <b className="fval">{val}</b>{" "}
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z" /></svg>
      <div className="fmenu">
        {options.map((o) => (
          <button
            key={o}
            className={o === val ? "cur" : undefined}
            onClick={(e) => { e.stopPropagation(); setVal(o); setOpen(false); }}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Topbar({ onAsk }: { onAsk: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">H</div>
        <div>Heartland Foods <small>Trade Platform · V3 plan-year build</small></div>
      </div>
      <div className="filters">
        {CHIPS.map((c) => <Fchip key={c.label} label={c.label} options={c.options} />)}
      </div>
      <div className="right">
        <button className="ask" onClick={onAsk}><span className="spark">✦</span> Ask Heartland</button>
        <div className="avatar" title="Account Manager">RP</div>
      </div>
    </header>
  );
}
