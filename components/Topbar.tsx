"use client";

import ScopeBar from "./ScopeBar";
import ModeSwitch from "./ModeSwitch";
import type { Scope } from "@/lib/scope";
import type { WorkMode } from "@/lib/mode";

/* Topbar — brand, the five cascading customer-scope selectors (territory →
   parent account → sales account, team lead, account lead), the working-mode
   switch (Analyze · LE · Plan), Ask Heartland, avatar. Scope and mode drive
   every screen; see components/ScopeBar.tsx and components/ModeSwitch.tsx. */

export default function Topbar({ onAsk, initialScope, mode }: { onAsk: () => void; initialScope: Scope; mode: WorkMode }) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">H</div>
        <div>Heartland Foods <small>Trade Platform · V3 plan-year build</small></div>
      </div>
      <ScopeBar initialScope={initialScope} />
      <ModeSwitch mode={mode} />
      <div className="right">
        <button className="ask" onClick={onAsk}><span className="spark">✦</span> Ask Heartland</button>
        <div className="avatar" title="Account Manager">RP</div>
      </div>
    </header>
  );
}
