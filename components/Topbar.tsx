"use client";

import ScopeBar from "./ScopeBar";
import type { Scope } from "@/lib/scope";

/* Topbar — brand, the five cascading customer-scope selectors (territory →
   parent account → sales account, team lead, account lead), Ask Heartland,
   avatar. The scope drives every screen; see components/ScopeBar.tsx. */

export default function Topbar({ onAsk, initialScope }: { onAsk: () => void; initialScope: Scope }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">H</div>
        <div>Heartland Foods <small>Trade Platform · V3 plan-year build</small></div>
      </div>
      <ScopeBar initialScope={initialScope} />
      <div className="right">
        <button className="ask" onClick={onAsk}><span className="spark">✦</span> Ask Heartland</button>
        <div className="avatar" title="Account Manager">RP</div>
      </div>
    </header>
  );
}
