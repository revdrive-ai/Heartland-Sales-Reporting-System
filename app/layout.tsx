import type { Metadata } from "next";
import "./globals.css";
import "./rebuild.css";
import AppShell from "@/components/AppShell";
import { getScope } from "@/lib/server/scope";

export const metadata: Metadata = {
  title: "Heartland Foods — Trade Platform",
  description:
    "Heartland Sales Reporting System — Next.js rebuild of the Trade Platform V3 mockup: base & lift modeling, promotion planning, sales reporting, promo analysis and deduction reconciliation.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Read the persisted customer scope server-side so the selectors render
  // with the saved values on first paint (no hydration flicker).
  const { scope } = await getScope();

  return (
    <html lang="en">
      <body>
        <AppShell initialScope={scope}>{children}</AppShell>
      </body>
    </html>
  );
}
