
import { groupFor, navItemFor } from "@/lib/nav";

/* Placeholder page body for a view that hasn't been rebuilt yet. Carries the
   demo's pagehead furniture (crumb, h1, description) and, on the five
   workflow views, the numbered workflow strip. Replace stub-by-stub as the
   rebuild works through the views. */

export default function PageStub({ view, lead }: { view: string; lead?: string }) {
  const item = navItemFor(view);
  if (!item) return null;

  return (
    <div className="view active">

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
