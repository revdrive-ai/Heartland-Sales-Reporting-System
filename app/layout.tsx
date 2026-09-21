import type { Metadata } from "next";
import "./globals.css";
import "./rebuild.css";
import AppShell from "@/components/AppShell";
import { getScope } from "@/lib/server/scope";
import { getMode } from "@/lib/server/mode";
import { getModeStatus } from "@/lib/server/modeStatus";
import ModeStrip from "@/components/ModeStrip";
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
  const [{ scope }, mode] = await Promise.all([getScope(), getMode()]);
  const status = await getModeStatus(mode);

  return (
    <html lang="en">
      <body>
        <AppShell initialScope={scope} mode={mode} user={user} strip={<ModeStrip status={status} />}>{children}</AppShell>
      </body>
    </html>
  );
}
