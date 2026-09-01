"use client";

import { useEffect, useState } from "react";

/* Design-review theme picker, fixed bottom-left as in the demo. Bright is the
   default (:root); Portfolio and Refined set data-theme on <html>. The choice
   persists in localStorage (`hhTheme`) and is applied before paint by the
   inline script in the root layout. */

const THEMES: [string, string][] = [
  ["bright", "Splenda Bright"],
  ["portfolio", "Portfolio"],
  ["refined", "Refined"],
];

export default function MockupBar() {
  const [theme, setTheme] = useState("bright");

  useEffect(() => {
    try { setTheme(localStorage.getItem("hhTheme") || "bright"); } catch {}
  }, []);

  const pick = (t: string) => {
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t === "bright" ? "" : t);
    try { localStorage.setItem("hhTheme", t); } catch {}
  };

  return (
    <div className="mockupbar" title="Design-review control — not part of the product">
      <span className="mb-l">Mockup theme</span>
      <div className="themepick" id="themepick">
        {THEMES.map(([t, label]) => (
          <button key={t} data-t={t} className={theme === t ? "on" : undefined} onClick={() => pick(t)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
