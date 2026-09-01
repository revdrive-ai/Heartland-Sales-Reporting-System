"use client";

import { useEffect, useState } from "react";

/* First-run welcome overlay — the five-step loop, verbatim from the demo.
   Dismissal is remembered in localStorage under hhWelcomeDone. */

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState(true);

  useEffect(() => {
    try { if (!localStorage.getItem("hhWelcomeDone")) setOpen(true); } catch {}
  }, []);

  const close = () => {
    if (skip) { try { localStorage.setItem("hhWelcomeDone", "1"); } catch {} }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="modal open" id="welcomeModal">
      <div className="box" style={{ width: 660 }}>
        <div className="m-head">
          <div>
            <div className="mt">Welcome to the Heartland Trade Platform</div>
            <div className="ms">One closed loop, five steps. Everything you see hangs off this workflow — start anywhere, but the numbers always flow in this order.</div>
          </div>
          <button className="x" onClick={close}>✕</button>
        </div>
        <div className="m-body" style={{ padding: "16px 20px 8px" }}>
          <div className="derive" style={{ margin: 0 }}>
            <div className="step"><div className="n">1 · MODEL</div><div className="v">Base &amp; Lift</div><div className="d">History is cleaned into a trustworthy baseline and lift-by-tactic</div><div className="arrow">→</div></div>
            <div className="step"><div className="n">2 · PLAN</div><div className="v">Planner</div><div className="d">Events are planned on that base — ROI guardrails check as you type</div><div className="arrow">→</div></div>
            <div className="step"><div className="n">3 · TRACK</div><div className="v">Dashboard</div><div className="d">The total business is tracked while events run</div><div className="arrow">→</div></div>
            <div className="step"><div className="n">4 · LEARN</div><div className="v">Analysis</div><div className="d">Closed events are measured; learnings feed back to step 1 ↺</div></div>
          </div>
          <div className="note" style={{ margin: "12px 0 4px" }}>✦ <span>Deductions (step 5) confirm what was actually spent — that&apos;s what makes the realized ROI in step 4 real. The AI in <b>Ask Heartland</b> can explain any number you see.</span></div>
        </div>
        <div className="m-foot">
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 7 }}>
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Don&apos;t show this again
          </label>
          <div className="right"><button className="btn primary" onClick={close}>Take me to the dashboard →</button></div>
        </div>
      </div>
    </div>
  );
}
