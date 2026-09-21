"use client";

import { useState } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import AskPanel from "./AskPanel";
import WelcomeModal from "./WelcomeModal";
import { Toast } from "./toast";
import type { Scope } from "@/lib/scope";
import type { WorkMode } from "@/lib/mode";
import type { SessionUser } from "@/lib/supabase/server";

export default function AppShell({ children, initialScope, mode, user, strip }: { children: React.ReactNode; initialScope: Scope; mode: WorkMode; user: SessionUser; strip?: React.ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);

  return (
    <>
      <div className="app">
        <Topbar onAsk={() => setAskOpen(true)} initialScope={initialScope} user={user} />
        <Sidebar mode={mode} />
        <main className="main" id="main">{strip}{children}</main>
      </div>
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} />
      <Toast />
      <WelcomeModal />
    </>
  );
}
