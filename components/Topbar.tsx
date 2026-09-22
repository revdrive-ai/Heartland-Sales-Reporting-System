"use client";

import ScopeBar from "./ScopeBar";
import type { Scope } from "@/lib/scope";
import type { SessionUser } from "@/lib/supabase/server";

/* Topbar — brand, the five cascading customer-scope selectors (territory →
   parent account → sales account, team lead, account lead), Ask Heartland,
   avatar. The scope drives every screen; see components/ScopeBar.tsx. The
   working mode (Analyze · LE · Plan) is chosen at the front door — see
   components/start/FrontDoor.tsx — and the sidebar is the admin view.

   The front door hides the scope selectors: nothing on it is scoped, and the
   first question should be what you are doing, not for whom. */

export default function Topbar({ onAsk, initialScope, user, showScope = true }: { onAsk: () => void; initialScope: Scope; user: SessionUser; showScope?: boolean }) {
  // initials from the address: "randy.p@revdrive.ai" -> "RP"
  const initials = (user.email.split("@")[0].split(/[._-]+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]!.toUpperCase()).join("") || user.email[0]!.toUpperCase());
  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">H</div>
        <div>Heartland Foods <small>Trade Platform · V3 plan-year build</small></div>
      </div>
      {showScope ? <ScopeBar initialScope={initialScope} /> : <span style={{ flex: 1 }} />}
      <div className="right">
        <button className="ask" onClick={onAsk}><span className="spark">✦</span><span className="lbl">Ask Heartland</span></button>
        <div className="who">
          <div className="avatar" title={user.email}>{initials}</div>
          <form action="/auth/signout" method="post">
            <button className="signout" type="submit" title={`Signed in as ${user.email} — sign out`}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
