import type { Metadata } from "next";
import "./globals.css";
import "./rebuild.css";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "Heartland Foods — Trade Platform",
  description:
    "Heartland Sales Reporting System — Next.js rebuild of the Trade Platform V3 mockup: base & lift modeling, promotion planning, sales reporting, promo analysis and deduction reconciliation.",
};

/* Applies the persisted mockup theme before first paint so a Portfolio or
   Refined choice doesn't flash bright on load. Bright is the :root default
   (empty data-theme), matching the demo. */
const THEME_INIT = `try{var t=localStorage.getItem("hhTheme");if(t&&t!=="bright")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
