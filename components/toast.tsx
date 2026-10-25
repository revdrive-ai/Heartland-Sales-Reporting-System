"use client";

import { useEffect } from "react";

/* Toast — same element, classes and timing as the demo's showToast. The
   <Toast/> element in the layout shows whatever an "hh-toast" CustomEvent
   carries in its detail. */

declare global {
  interface Window { _tt?: ReturnType<typeof setTimeout> }
}

export function Toast() {
  useEffect(() => {
    const el = document.getElementById("toast");
    if (!el) return;
    const on = (e: Event) => {
      el.textContent = (e as CustomEvent<string>).detail;
      el.classList.add("show");
      clearTimeout(window._tt);
      window._tt = setTimeout(() => el.classList.remove("show"), 3200);
    };
    window.addEventListener("hh-toast", on);
    return () => window.removeEventListener("hh-toast", on);
  }, []);
  return <div className="toast" id="toast" />;
}
