import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./rebuild.css";
import AppShell from "@/components/AppShell";
import { getScope } from "@/lib/server/scope";
import { getMode } from "@/lib/server/mode";
import { getModeStatus } from "@/lib/server/modeStatus";
import ModeStrip from "@/components/ModeStrip";
import ProcessRail from "@/components/process/ProcessRail";
import { parseWorkPath, WORK_HEADER } from "@/lib/process";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Heartland Foods — Trade Platform",
  description:
    "Heartland Sales Reporting System — Next.js rebuild of the Trade Platform V3 mockup: base & lift modeling, promotion planning, sales reporting, promo analysis and deduction reconciliation.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /* Signed out, the shell has nothing to show — no scope, no mode, no data —
     so the login page renders bare. The middleware has already decided who
     may be here; this only picks the chrome. */
  const user = await currentUser();
  if (!user) {
    return (
      <html lang="en">
        <body>{children}</body>
      </html>
    );
  }

  // Read the persisted customer scope server-side so the selectors render
  // with the saved values on first paint (no hydration flicker).
  const [resolved, mode, h] = await Promise.all([getScope(), getMode(), headers()]);
  const status = await getModeStatus(mode);

  /* Inside a process the middleware rewrote /work/... onto the view that
     renders it, so the pathname the browser shows only survives on this
     header. It is what tells the shell to draw the rail instead of the
     sidebar. */
  const work = parseWorkPath(h.get(WORK_HEADER) ?? "");

  return (
    <html lang="en">
      <body>
        <AppShell
          initialScope={resolved.scope}
          mode={mode}
          user={user}
          strip={<ModeStrip status={status} />}
          rail={work ? <ProcessRail loc={work} status={status} scopeLabel={resolved.label} /> : null}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
