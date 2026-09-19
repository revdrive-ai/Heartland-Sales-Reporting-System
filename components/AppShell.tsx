"use client";

import { useState } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import AskPanel from "./AskPanel";
import WelcomeModal from "./WelcomeModal";
import { Toast } from "./toast";
import type { Scope } from "@/lib/scope";
import type { WorkMode } from "@/lib/mode";

export default function AppShell({ children, initialScope, mode, strip }: { children: React.ReactNode; initialScope: Scope; mode: WorkMode; strip?: React.ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);

  return (
    <>
      <div className="app">
        <Topbar onAsk={() => setAskOpen(true)} initialScope={initialScope} mode={mode} />
        <Sidebar />
        <main className="main" id="main">{strip}{children}</main>
      </div>
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} />
      <Toast />
      <WelcomeModal />
    </>
  );
}
