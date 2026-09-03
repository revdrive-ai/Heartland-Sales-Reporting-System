"use client";

import { useMemo, useState } from "react";
import type { PlanEvent } from "@/lib/repo/client";
import type { PlannerData } from "./PlannerView";

/* The new-event wizard from the reference mockup, on real data: three steps
   (Scope → Tactic & timing → Funding & review) with the live plan-summary
   rail on the right. Base volume pre-fills from the NIQ weekly run-rate of
   the items picked; predicted lift pre-fills from the brand's measured
   promoted-week lift; spend builds from per-unit rates + fixed fees; and the
   1.5× ROI guardrail scores the plan as you type. */

const ROI_GUARDRAIL = 1.5;
const DAY = 86400000;
const OVERRIDE_REASONS = [
  "Retailer volume commitment", "New distribution", "Competitive activity",
  "Thin history — AM judgment", "Other",
];

const utc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fmtK = (v: number) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.round(v / 1e3).toLocaleString() + "K");
const fmt$ = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString()}K` : `$${Math.round(v)}`);
const fmtD = (iso: string) => new Date(utc(iso)).toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });

export default function EventWizard({
  data, year, onClose, onSubmit,
}: {
  data: PlannerData;
  year: number;
  onClose: () => void;
  onSubmit: (e: Omit<PlanEvent, "id" | "created_at">) => void;
}) {
  const plan = data.plan!;
  const brands = Object.keys(plan.brandStats);

  const [step, setStep] = useState(1);
  const [cust, setCust] = useState("");
  const [brand, setBrand] = useState("");
  const [upcs, setUpcs] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [tactic, setTactic] = useState("");
  const [start, setStart] = useState(`${year}-08-01`);
  const [end, setEnd] = useState(`${year}-08-28`);
  const [lift, setLift] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [oi, setOi] = useState("0");
  const [scan, setScan] = useState("0");
  const [fixed, setFixed] = useState("0");
  const [notes, setNotes] = useState("");

  const st = brand ? plan.brandStats[brand] : undefined;
  const liftDef = st?.avgLift ?? null;
  const overridden = lift !== null && liftDef !== null && lift !== liftDef;

  const pickBrand = (b: string) => {
    setBrand(b);
    setUpcs([]);
    setTactic("");
    setLift(null);
    setReason("");
  };
  const pickTactic = (t: string) => {
    setTactic(t);
    setLift(liftDef);
    setReason("");
  };
  const toggleItem = (u: string) =>
    setUpcs((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s, u]));

  const calc = useMemo(() => {
    const weeks = end >= start ? Math.max(1, Math.round((utc(end) - utc(start)) / DAY / 7)) : 0;
    const wkBase = st ? upcs.reduce((a, u) => a + (st.items.find((i) => i.upc === u)?.wk ?? 0), 0) : 0;
    const base = wkBase * weeks;
    const incr = lift !== null ? base * (lift / 100) : null;
    const units = base + (incr ?? 0);
    const oiR = parseFloat(oi) || 0, scR = parseFloat(scan) || 0, fx = parseFloat(fixed) || 0;
    const oi$ = units * oiR, scan$ = units * scR;
    const spend = oi$ + scan$ + fx;
    const roi = spend > 0 && incr !== null && st ? (incr * st.price) / spend : null;
    return { weeks, base, incr, units, oi$, scan$, fx, spend, roi };
  }, [st, upcs, start, end, lift, oi, scan, fixed]);

  const valid = (s: number) =>
    s === 1 ? !!cust && !!brand && upcs.length > 0 && !!name.trim()
    : s === 2 ? !!tactic && calc.weeks > 0 && (lift ?? 0) > 0 && (!overridden || !!reason)
    : calc.spend > 0;

  const submit = () => {
    onSubmit({
      plan_year: year,
      customer_id: cust,
      customer: plan.customers.find((c) => c.id === cust)?.name ?? cust,
      brand, title: name.trim(), perf: tactic,
      start, end, spend: Math.round(calc.spend),
      lift_pct: lift, upcs,
      funding: { oi: parseFloat(oi) || 0, scan: parseFloat(scan) || 0, fixed: parseFloat(fixed) || 0 },
      note: [notes.trim(), overridden ? `lift override: ${reason}` : ""].filter(Boolean).join(" · "),
      origin: "manual",
    });
  };

  const railRow = (k: string, v: string, dim: boolean) => (
    <div className="rail-row" key={k}>
      <span className="k">{k}</span>
      <span className={"v" + (dim ? " dim" : "")}>{v}</span>
    </div>
  );

  return (
    <div className="modal open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="box wizard" style={{ width: 840 }}>
        <div className="m-head">
          <div>
            <div className="mt">New promotion event — {year} plan</div>
            <div className="ms">
              Plan a promotion by customer and item. Base volume and predicted lift pre-fill from the NIQ history
              in scope — the plan economics on the right calculate live as you make selections.
            </div>
          </div>
          <button className="x" onClick={onClose}>✕</button>
        </div>

        <div className="stepdots">
          {[["Scope", 1], ["Tactic & timing", 2], ["Funding & review", 3]].map(([lbl, n]) => (
            <div
              key={n}
              className={"sd" + (step === n ? " on" : "") + (step > +n ? " done" : "")}
              onClick={() => { if (+n < step) setStep(+n); }}
            >
              <span className="n">{n}</span> {lbl}
            </div>
          ))}
        </div>

        <div className="m-body">
          <div className="wizform">
            {step === 1 && (
              <div className="wstep on">
                <div className="f-row">
                  <label>Customer <span className="req">*</span></label>
                  <select value={cust} onChange={(e) => setCust(e.target.value)}>
                    <option value="">— select customer —</option>
                    {plan.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="hint">The Telus customers in the current scope.</div>
                </div>
                <div className="f-row">
                  <label>Brand <span className="req">*</span></label>
                  <select value={brand} onChange={(e) => pickBrand(e.target.value)}>
                    <option value="">— select brand —</option>
                    {brands.map((b) => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div className="f-row">
                  <label>Items on the deal <span className="req">*</span></label>
                  <div className="itemlist">
                    {!brand ? (
                      <div className="itemempty">Pick a brand to see the item list.</div>
                    ) : st && st.items.length ? (
                      st.items.map((i) => (
                        <label className="itemopt" key={i.upc}>
                          <input type="checkbox" checked={upcs.includes(i.upc)} onChange={() => toggleItem(i.upc)} />
                          {i.name.length > 46 ? i.name.slice(0, 45) + "…" : i.name}
                          <span className="meta2"><span className="ta">NIQ</span> base {fmtK(i.wk)} u / wk</span>
                        </label>
                      ))
                    ) : (
                      <div className="itemempty">No {brand} items with NIQ volume in this scope.</div>
                    )}
                  </div>
                  <div className="hint">
                    Select every item on the deal — base volume sums across items, from each item&apos;s weekly NIQ
                    base run-rate over the latest 52 weeks in scope.
                  </div>
                </div>
                <div className="f-row">
                  <label>Event name <span className="req">*</span></label>
                  <input type="text" value={name} placeholder="e.g. Fall Baking Feature" onChange={(e) => setName(e.target.value)} />
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="wstep on">
                <div className="f-row">
                  <label>Tactic <span className="req">*</span></label>
                  <div className="tacticgrid">
                    {data.perfTypes.map((t) => (
                      <div key={t} className={"tactic" + (tactic === t ? " on" : "")} onClick={() => pickTactic(t)}>
                        {t}
                        <span className="tl">{liftDef !== null ? `+${liftDef}% hist.` : "—"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="hint">
                    Chips pre-fill with {brand || "the brand"}&apos;s average NIQ promoted-week lift in scope — per-tactic
                    reads sharpen once Promo Analysis lands.
                  </div>
                </div>
                <div className="f-2col">
                  <div className="f-row">
                    <label>Window start <span className="req">*</span></label>
                    <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                  </div>
                  <div className="f-row">
                    <label>Window end <span className="req">*</span></label>
                    <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </div>
                </div>
                <div className="f-2col">
                  <div className="f-row">
                    <label>Predicted lift %</label>
                    <input
                      type="number" min={0} max={200}
                      value={lift ?? ""}
                      onChange={(e) => setLift(e.target.value === "" ? null : Math.max(0, Math.min(500, parseFloat(e.target.value) || 0)))}
                    />
                    <div className="hint">
                      {overridden
                        ? <>✎ Override of the historical estimate (+{liftDef}%) — flagged for closed-loop learning.</>
                        : tactic ? <>Pre-filled from {brand} history — edit to override.</> : <>Pick a tactic to pre-fill — edit to override.</>}
                    </div>
                  </div>
                  {overridden && (
                    <div className="f-row">
                      <label>Override reason <span className="req">*</span></label>
                      <select value={reason} onChange={(e) => setReason(e.target.value)}>
                        <option value="">— select reason —</option>
                        {OVERRIDE_REASONS.map((r) => <option key={r}>{r}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="wstep on">
                <div className="f-2col">
                  <div className="f-row">
                    <label>Off-invoice rate ($ / unit)</label>
                    <input type="number" min={0} step={0.05} value={oi} onChange={(e) => setOi(e.target.value)} />
                    <div className="hint">
                      {parseFloat(oi) > 0 && calc.units ? `= ${fmt$(calc.oi$)} across ${fmtK(calc.units)} units` : "Applied to every unit moved in the window."}
                    </div>
                  </div>
                  <div className="f-row">
                    <label>Scan rate ($ / unit)</label>
                    <input type="number" min={0} step={0.05} value={scan} onChange={(e) => setScan(e.target.value)} />
                    <div className="hint">
                      {parseFloat(scan) > 0 && calc.units ? `= ${fmt$(calc.scan$)} across ${fmtK(calc.units)} units` : "Paid per unit scanned at the promo price."}
                    </div>
                  </div>
                </div>
                <div className="f-row">
                  <label>Fixed fees ($)</label>
                  <input type="number" min={0} step={100} value={fixed} onChange={(e) => setFixed(e.target.value)} />
                  <div className="hint">
                    {parseFloat(fixed) > 0 ? `= ${fmt$(calc.fx)} toward total spend` : "Display, ad, or slotting fees — entered in dollars."}
                  </div>
                </div>
                <div className="f-row">
                  <label>Notes for the reviewer (optional)</label>
                  <input type="text" value={notes} placeholder="Anything the approver should know" onChange={(e) => setNotes(e.target.value)} />
                </div>
                <div className="hint">
                  {calc.spend > 0 && calc.roi !== null
                    ? calc.roi >= ROI_GUARDRAIL
                      ? "✓ Plan clears the guardrail."
                      : `⚠ Plans under ${ROI_GUARDRAIL}× land flagged in the guardrail count.`
                    : "Enter a rate or fee — total spend calculates from the window volume and drives the ROI guardrail check."}
                </div>
              </div>
            )}
          </div>

          <div className="wizrail">
            <div className="rail-h">Live plan summary</div>
            <div>
              {railRow("Customer", cust ? (plan.customers.find((c) => c.id === cust)?.name ?? "—") : "—", !cust)}
              {railRow("Brand", brand || "—", !brand)}
              {railRow("Items", upcs.length ? `${upcs.length} selected` : "—", !upcs.length)}
              {railRow("Window", calc.weeks ? `${fmtD(start)} – ${fmtD(end)} · ${calc.weeks} wks` : "—", !calc.weeks)}
              {railRow("Tactic", tactic || "—", !tactic)}
              {railRow("Predicted lift", lift !== null ? `+${lift}%${overridden ? " ✎" : ""}` : "—", lift === null)}
              {railRow("Base volume", calc.base ? `${fmtK(calc.base)} units` : "—", !calc.base)}
              {railRow("Incremental", calc.incr ? `+${fmtK(calc.incr)} units` : "—", !calc.incr)}
              {calc.spend > 0 && railRow("Spend split", `OI ${fmt$(calc.oi$)} · Scan ${fmt$(calc.scan$)} · Fixed ${fmt$(calc.fx)}`, false)}
              {railRow("Total spend", calc.spend ? fmt$(calc.spend) : "—", !calc.spend)}
              {railRow("Base source", `NIQ latest 52 wks${data.scopeLabel ? ` · ${data.scopeLabel}` : ""}`, false)}
            </div>
            {calc.roi !== null ? (
              <div className={"rail-roi " + (calc.roi >= ROI_GUARDRAIL ? "ok" : "bad")}>
                <div className="val">{calc.roi.toFixed(1)}×</div>
                <div className="expl">
                  {calc.roi >= ROI_GUARDRAIL
                    ? `Clears the ${ROI_GUARDRAIL}× ROI guardrail`
                    : `Below the ${ROI_GUARDRAIL}× guardrail — will be flagged`}
                </div>
              </div>
            ) : (
              <div className="rail-roi">
                <div className="val" style={{ color: "var(--ink-3)" }}>—×</div>
                <div className="expl" style={{ color: "var(--ink-3)" }}>ROI appears once lift and funding are set</div>
              </div>
            )}
          </div>
        </div>

        <div className="m-foot">
          <button className="btn" style={{ visibility: step > 1 ? "visible" : "hidden" }} onClick={() => setStep((s) => Math.max(1, s - 1))}>
            ← Back
          </button>
          <div className="right">
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              disabled={!valid(step)}
              onClick={() => (step < 3 ? setStep((s) => s + 1) : submit())}
            >
              {step < 3 ? "Next →" : "Add to plan →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
