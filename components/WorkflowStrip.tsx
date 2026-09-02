import Link from "next/link";
import { WORKFLOW } from "@/lib/nav";

/* The five-step trade workflow strip shown on the workflow views. */
export default function WorkflowStrip({ current }: { current: string }) {
  return (
    <div className="wf" role="navigation" aria-label="Trade workflow">
      {WORKFLOW.map(([v, l], i) => (
        <span key={v} style={{ display: "contents" }}>
          {i > 0 && <span className="sep">→</span>}
          <Link href={`/${v}`} className={"wfs" + (v === current ? " on" : "")} style={{ textDecoration: "none" }}>
            <span className="num">{i + 1}</span>{l}
          </Link>
        </span>
      ))}
      <span className="loop">↺ learnings feed step 1</span>
    </div>
  );
}
