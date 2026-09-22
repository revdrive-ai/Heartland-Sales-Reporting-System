"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Topbar from "./Topbar";
import Sidebar from "./Sidebar";
import AskPanel from "./AskPanel";
import { Toast } from "./toast";
import type { Scope } from "@/lib/scope";
import type { WorkMode } from "@/lib/mode";
import type { SessionUser } from "@/lib/supabase/server";
import { WORK_PREFIX } from "@/lib/process";

/* Three kinds of chrome, decided by where you are:

     /start      the front door — brand and sign-out, nothing else to read
     /work/...   a process — the step rail in place of the sidebar
     anything    the full map, sidebar and all: the admin view

   The middleware decides who may be on the third. This only draws it. */

export default function AppShell({
  children,
  initialScope,
  mode,
  user,
  strip,
  rail,
}: {
  children: React.ReactNode;
  initialScope: Scope;
  mode: WorkMode;
  user: SessionUser;
  strip?: React.ReactNode;
  rail?: React.ReactNode;
}) {
  const [askOpen, setAskOpen] = useState(false);
  const pathname = usePathname();
  const atStart = pathname === "/start";
  const inWork = pathname === WORK_PREFIX || pathname.startsWith(WORK_PREFIX + "/");
  const noSidebar = atStart || inWork;

  return (
    <>
      <div className={"app" + (noSidebar ? " nosides" : "")}>
        <Topbar
          onAsk={() => setAskOpen(true)}
          initialScope={initialScope}
          user={user}
          showScope={!atStart}
        />
        {!noSidebar && <Sidebar mode={mode} />}
        <main className="main" id="main">
          {inWork ? rail : atStart ? null : strip}
          {children}
        </main>
      </div>
      <AskPanel open={askOpen} onClose={() => setAskOpen(false)} />
      <Toast />
    </>
  );
}
