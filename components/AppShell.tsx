"use client";

import { useState } from "react";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import AskPanel from "./AskPanel";
import MockupBar from "./MockupBar";
import WelcomeModal from "./WelcomeModal";
import { Toast } from "./toast";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [askOpen, setAskOpen] = useState(false);

  return (
    <>
      <div className="app">
        <Topbar onAsk={() => setAskOpen(true)} />
        <Sidebar />
        <main className="main" id="main">{children}</main>
      </div>
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} />
      <MockupBar />
      <Toast />
      <WelcomeModal />
    </>
  );
}
