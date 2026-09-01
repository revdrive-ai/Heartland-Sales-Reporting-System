// Sidebar / KPI icon set, ported verbatim from the Heartland Harvest V3 mockup.
// Outline SVGs, stroke = currentColor (styled by `.ic svg` rules in globals.css).
// Rendered via dangerouslySetInnerHTML on a span.ic — same mechanism as the demo.

export const ICONS: Record<string, string> = {
 chart:'<svg viewBox="0 0 24 24"><path d="M4 5v14h16"/><path d="M9 17v-5M13 17V8M17 17v-3"/></svg>',
 calendar:'<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/></svg>',
 trend:'<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
 search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
 receipt:'<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M9.5 8.5h5M9.5 12.5h5"/></svg>',
 utensils:'<svg viewBox="0 0 24 24"><path d="M8 3v18M5 3v5a3 3 0 0 0 6 0V3"/><path d="M17 3c-1.8 2.2-1.8 5.8 0 8v10"/></svg>',
 award:'<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="5.5"/><path d="M8.8 13.5 7 21l5-2.8L17 21l-1.8-7.5"/></svg>',
 bot:'<svg viewBox="0 0 24 24"><rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 5v3M9 12.5v2M15 12.5v2"/><circle cx="12" cy="4" r="1"/></svg>',
 plug:'<svg viewBox="0 0 24 24"><path d="M9 2.5V8M15 2.5V8"/><path d="M7 8h10v3.5a5 5 0 0 1-10 0z"/><path d="M12 16.5v5"/></svg>',
 link:'<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
 dollar:'<svg viewBox="0 0 24 24"><path d="M12 2.5v19"/><path d="M16.5 6.5c-.8-1.2-2.4-1.9-4.5-1.9-2.5 0-4.3 1.3-4.3 3.2 0 4.4 9 2.2 9 6.6 0 1.9-1.9 3.2-4.6 3.2-2.2 0-3.9-.8-4.7-2"/></svg>',
 target:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg>',
 alert:'<svg viewBox="0 0 24 24"><path d="M12 3.5 22 20H2z"/><path d="M12 9.5V14M12 16.8v.2"/></svg>',
 scale:'<svg viewBox="0 0 24 24"><path d="M12 4v16M8.5 20h7M4.5 7h15"/><path d="M6.5 7l-2.8 5.5a3.1 3.1 0 0 0 5.6 0zM17.5 7l-2.8 5.5a3.1 3.1 0 0 0 5.6 0z"/></svg>',
 check:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2l2.4 2.4 4.6-5"/></svg>',
 refresh:'<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
 zap:'<svg viewBox="0 0 24 24"><path d="M13 2.5 4.5 14H11l-1 7.5L18.5 10H12z"/></svg>',
 clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
 inbox:'<svg viewBox="0 0 24 24"><path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1.5 2.5h3L15 13h5"/></svg>',
 building:'<svg viewBox="0 0 24 24"><rect x="5" y="3.5" width="14" height="17"/><path d="M9 8h1.5M13.5 8H15M9 12h1.5M13.5 12H15M11 20.5v-4h2v4"/></svg>',
 map:'<svg viewBox="0 0 24 24"><path d="M9 4 3.5 6v14l5.5-2 6 2 5.5-2V4l-5.5 2z"/><path d="M9 4v14M15 6v14"/></svg>',
 tag:'<svg viewBox="0 0 24 24"><path d="M3.5 12.5V4h8.5l8.5 8.5-8.5 8.5z"/><circle cx="8" cy="8.5" r="1.4"/></svg>',
};
