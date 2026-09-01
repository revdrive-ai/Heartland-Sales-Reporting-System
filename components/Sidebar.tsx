"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { ICONS } from "@/lib/icons";

export default function Sidebar() {
  const pathname = usePathname();
  const active = (view: string) =>
    pathname === `/${view}` || (pathname === "/" && view === "reporting");

  return (
    <aside className="side">
      {NAV.map((g) => (
        <div className="navgroup" key={g.heading}>
          <h4>{g.heading}</h4>
          {g.items.map((it) => (
            <Link
              key={it.view}
              href={`/${it.view}`}
              className={"navitem" + (active(it.view) ? " active" : "")}
              title={it.title}
              style={{ textDecoration: "none" }}
            >
              <span
                className="ic"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: ICONS[it.icon] ?? "" }}
              />
              {" "}{it.label}{" "}
              {it.tag ? <span className="tag">{it.tag}</span> : null}
              {it.badge ? <span className="badge">{it.badge}</span> : null}
            </Link>
          ))}
        </div>
      ))}
      <div className="sidefoot">
        <div className="t">TELUS transition</div>
        <div className="d">Running in parallel. New platform validated against TELUS each sprint.</div>
        <span className="transition-pill">● Sprint 2 · Reporting live</span>
      </div>
    </aside>
  );
}
