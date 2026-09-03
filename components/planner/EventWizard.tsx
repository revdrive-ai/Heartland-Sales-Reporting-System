"use client";

import { useMemo, useState } from "react";
import type { PlanEvent } from "@/lib/repo/client";
import { eventWeeklyBase, itemWeeklyBase } from "./planMath";
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
  data, year, initial, onClose, onSubmit,
}: {
  data: PlannerData;
  year: number;
  /** editing an existing event — the wizard opens pre-filled and saves back */
  initial?: PlanEvent | null;
  onClose: () => void;
  onSubmit: (e: Omit<PlanEvent, "id" | "created_at">) => void;
}) {
  const plan = data.plan!;
  const brands = [...Object.keys(plan.brandStats), "MIXED"]; // MIXED = carried/whole-book events, scored at spend level

  // a carried/imported event has no funding split — treat its whole spend as
  // fixed fees so editing preserves the committed dollars until rates are set
  const initFunding = initial ? (initial.funding ?? { oi: 0, scan: 0, fixed: initial.spend }) : null;

  const [step, setStep] = useState(1);
  const [cust, setCust] = useState(initial?.customer_id ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [upcs, setUpcs] = useState<string[]>(initial?.upcs ?? []);
  const [name, setName] = useState(initial?.title ?? "");
  const [tactic, setTactic] = useState(initial?.perf ?? "");
  const [start, setStart] = useState(initial?.start ?? `${year}-08-01`);
  const [end, setEnd] = useState(initial?.end ?? `${year}-08-28`);
  const [lift, setLift] = useState<number | null>(initial?.lift_pct ?? null);
  const [reason, setReason] = useState("");
  const [oi, setOi] = useState(String(initFunding?.oi ?? 0));
  const [scan, setScan] = useState(String(initFunding?.scan ?? 0));
  const [fixed, setFixed] = useState(String(initFunding?.fixed ?? 0));
  const [notes, setNotes] = useState(initial?.note ?? "");

  const st = brand ? plan.brandStats[brand] : undefined;
  // per-tactic measured lift (FY windows joined to NIQ); brand average when a
  // tactic has no measured windows yet
  const tacticRead = (t: string) => st?.tactics?.[t] ?? null;
  const defFor = (t: string) => tacticRead(t)?.lift ?? st?.avgLift ?? null;
  const liftDef = tactic ? defFor(tactic) : null;
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
    setLift(defFor(t));
    setReason("");
  };
  const toggleItem = (u: string) =>
    setUpcs((s) => (s.includes(u) ? s.filter((x) => x !== u) : [...s, u]));

  const calc = useMemo(() => {
    const weeks = end >= start ? Math.max(1, Math.round((utc(end) - utc(start)) / DAY / 7)) : 0;
    // scored at the chosen customer's divisions — same math as the events table
    const wkBase = st && cust && upcs.length ? eventWeeklyBase(plan, cust, brand, upcs) : 0;
    const base = wkBase * weeks;
    const incr = lift !== null ? base * (lift / 100) : null;
    const units = base + (incr ?? 0);
    const oiR = parseFloat(oi) || 0, scR = parseFloat(scan) || 0, fx = parseFloat(fixed) || 0;
    const oi$ = units * oiR, scan$ = units * scR;
    const spend = oi$ + scan$ + fx;
    const roi = spend > 0 && incr !== null && st ? (incr * st.price) / spend : null;
    return { weeks, base, incr, units, oi$, scan$, fx, spend, roi };
  }, [st, plan, cust, brand, upcs, start, end, lift, oi, scan, fixed]);

  const mixed = brand === "MIXED";
  const valid = (s: number) =>
    s === 1 ? !!cust && !!brand && (mixed || upcs.length > 0) && !!name.trim()
    : s === 2 ? !!tactic && calc.weeks > 0 && (mixed || (lift ?? 0) > 0) && (!overridden || !!reason)
    : calc.spend > 0;

  const submit = () => {
    onSubmit({
      plan_year: year,
      customer_id: cust,
      customer: plan.customers.find((c) => c.id === cust)?.name ?? initial?.customer ?? cust,
      brand, title: name.trim(), perf: tactic,
      start, end, spend: Math.round(calc.spend),
      lift_pct: lift, upcs,
      funding: { oi: parseFloat(oi) || 0, scan: parseFloat(scan) || 0, fixed: parseFloat(fixed) || 0 },
      note: [notes.trim(), overridden ? `lift override: ${reason}` : ""].filter(Boolean).join(" · "),
      origin: initial?.origin ?? "manual",
    });
  };

  const railRow = (k: string, v: string, dim: boolean) => (
    <div className="rail-row" key={k}>
      <span className="k">{k}</span>
      <span className={"v" + (dim ? " dim" : "")}>{v}</span>
    </div>
  );

  return (
    // no backdrop-close: drag-selecting a field and releasing outside the box
    // must not throw the planner's half-entered event away — ✕ / Cancel close
    <div className="modal open">
      <div className="box wizard" style={{ width: 840 }}>
        <div className="m-head">
          <div>
            <div className="mt">{initial ? "Edit promotion event" : "New promotion event"} — {year} plan</div>
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
                    {cust && !plan.customers.some((c) => c.id === cust) && (
                      <option value={cust}>{initial?.customer ?? cust}</option>
                    )}
                    {plan.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <div className="hint">The Telus customers in the current scope.</div>
                </div>
                <div className="f-row">
                  <label>Brand <span className="req">*</span></label>
                  <select value={brand} onChange={(e) => pickBrand(e.target.value)}>
                    <option value="">— select brand —</option>
                    {brands.map((b) => <option key={b} value={b}>{b === "MIXED" ? "Mixed / whole book" : b}</option>)}
                  </select>
                </div>
                <div className="f-row">
                  <label>Items on the deal <span className="req">*</span></label>
                  <div className="itemlist">
                    {!brand ? (
                      <div className="itemempty">Pick a brand to see the item list.</div>
                    ) : mixed ? (
                      <div className="itemempty">Mixed / whole-book event — planned at spend level, no item scoring.</div>
                    ) : st && st.items.length ? (
                      st.items.map((i) => {
                        const wk = itemWeeklyBase(plan, cust, i.upc, i.wk);
                        return (
                          <label className="itemopt" key={i.upc}>
                            <input type="checkbox" checked={upcs.includes(i.upc)} onChange={() => toggleItem(i.upc)} />
                            {i.name.length > 46 ? i.name.slice(0, 45) + "…" : i.name}
                            <span className="meta2">
                              <span className="ta">NIQ</span>{" "}
                              {wk > 0 ? `base ${fmtK(wk)} u / wk${cust ? " here" : ""}` : "no volume at this customer"}
                            </span>
                          </label>
                        );
                      })
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
                    {data.perfTypes.map((t) => {
                      const read = tacticRead(t);
                      const d = defFor(t);
                      return (
                        <div
                          key={t}
                          className={"tactic" + (tactic === t ? " on" : "")}
                          onClick={() => pickTactic(t)}
                          title={read
                            ? `Measured on ${read.reads} FY${plan.priorYear} ${t} window${read.reads === 1 ? "" : "s"} at the divisions in scope — actual vs NIQ base over each window`
                            : `No measured ${t} windows for ${brand || "this brand"} in scope yet — pre-fills the brand's average promoted-week lift`}
                        >
                          {t}
                          <span className="tl">
                            {read ? `${read.lift >= 0 ? "+" : "−"}${Math.abs(read.lift)}% · ${read.reads} read${read.reads === 1 ? "" : "s"}`
                              : d !== null ? `+${d}% avg` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="hint">
                    Chips show <b>measured lift by tactic</b> — each FY{plan.priorYear} window of that type at the
                    divisions in scope, actual vs NIQ base. &ldquo;avg&rdquo; chips have no measured windows yet and
                    pre-fill the brand&apos;s promoted-week average instead.
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
                        ? <>✎ Override of the {tacticRead(tactic) ? `measured ${tactic}` : "brand-average"} estimate ({liftDef !== null && liftDef >= 0 ? "+" : ""}{liftDef}%) — flagged for closed-loop learning.</>
                        : tactic
                        ? tacticRead(tactic)
                          ? <>Pre-filled from {tacticRead(tactic)!.reads} measured {tactic} window{tacticRead(tactic)!.reads === 1 ? "" : "s"} — edit to override.</>
                          : <>No measured {tactic} windows yet — pre-filled from the {brand} average. Edit to override.</>
                        : <>Pick a tactic to pre-fill — edit to override.</>}
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
              {railRow("Incremental", calc.incr ? `+${Math.round(calc.incr).toLocaleString()} units` : "—", !calc.incr)}
              {calc.spend > 0 && railRow("Spend split", `OI ${fmt$(calc.oi$)} · Scan ${fmt$(calc.scan$)} · Fixed ${fmt$(calc.fx)}`, false)}
              {railRow("Total spend", calc.spend ? "$" + Math.round(calc.spend).toLocaleString() : "—", !calc.spend)}
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
              {step < 3 ? "Next →" : initial ? "Save changes →" : "Add to plan →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
