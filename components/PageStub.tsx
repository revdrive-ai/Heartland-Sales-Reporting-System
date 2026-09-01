import Link from "next/link";
import { groupFor, navItemFor, WORKFLOW } from "@/lib/nav";

/* Placeholder page body for a view that hasn't been rebuilt yet. Carries the
   demo's pagehead furniture (crumb, h1, description) and, on the five
   workflow views, the numbered workflow strip. Replace stub-by-stub as the
   rebuild works through the views. */

export default function PageStub({ view, lead }: { view: string; lead?: string }) {
  const item = navItemFor(view);
  if (!item) return null;
  const wfIndex = WORKFLOW.findIndex(([v]) => v === view);

  return (
    <div className="view active">
      {wfIndex >= 0 && (
        <div className="wf" role="navigation" aria-label="Trade workflow">
          {WORKFLOW.map(([v, l], i) => (
            <span key={v} style={{ display: "contents" }}>
              {i > 0 && <span className="sep">→</span>}
              <Link href={`/${v}`} className={"wfs" + (v === view ? " on" : "")} style={{ textDecoration: "none" }}>
                <span className="num">{i + 1}</span>{l}
              </Link>
            </span>
          ))}
          <span className="loop">↺ learnings feed step 1</span>
        </div>
      )}

      <div className="pagehead">
        <div>
          <div className="crumb">{groupFor(view)}</div>
          <h1>{item.label}</h1>
          <p>{item.title}</p>
        </div>
      </div>

      <div className="card">
        <b>Not rebuilt yet.</b>
        <div className="note" style={{ marginTop: 8 }}>
          ◇ This view exists in the reference mockup (reference/heartland-harvest-v3.html) and is
          queued for the rebuild — the plan works through the Albertsons divisions one at a time.
        </div>
      </div>
    </div>
  );
}
