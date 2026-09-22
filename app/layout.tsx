import type { Metadata } from "next";
import "./globals.css";
import "./rebuild.css";
import AppShell from "@/components/AppShell";
import { getScope } from "@/lib/server/scope";
import { getMode } from "@/lib/server/mode";
import { getModeStatus } from "@/lib/server/modeStatus";
import ModeStrip from "@/components/ModeStrip";
import ProcessRail, { type RailStatus } from "@/components/process/ProcessRail";
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
  const [resolved, mode] = await Promise.all([getScope(), getMode()]);
  /* The rollup follows the top bar: scope to one account and the steps
     report that account, not all thirteen. */
  const status = await getModeStatus(mode, resolved.marketCodes);

  /* The rail works out its own position from the pathname — steps of a
     process share an underlying view, so moving between them does not
     re-render this layout. It only needs the counts. */
  const rail: RailStatus | null = status && {
    customers: status.totals.customers,
    verified: status.totals.verified,
    newItems: status.totals.newItems,
    added: status.customers.reduce((a, c) => a + c.distver.added, 0),
    signed: status.totals.signed,
    submitted: status.totals.submitted,
    events: status.totals.events,
    taken: status.totals.taken,
    leAnswered: status.totals.leAnswered,
    /* The estimate's question is only ever asked of one account, so the
       answer is only meaningful when the top bar is on one. */
    leAnswer: status.customers.length === 1 ? status.customers[0].leAnswer : null,
    adjustments: status.totals.adjustments,
    cycle: status.schedule?.due.key ?? "",
    cycleLabel: status.schedule?.due.label ?? status.month,
    year: status.year,
  };

  return (
    <html lang="en">
      <body>
        <AppShell
          initialScope={resolved.scope}
          mode={mode}
          user={user}
          strip={<ModeStrip status={status} />}
          rail={
            <ProcessRail
              status={rail}
              scopeLabel={resolved.label}
              inScope={status?.customers.map((c) => c.code) ?? []}
            />
          }
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
