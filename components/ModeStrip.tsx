import Link from "next/link";
import type { ModeStatus } from "@/lib/server/modeStatus";

/* The status strip under the top bar in LE and Plan modes: one line saying
   where the mode year's work stands across every customer, with the way
   into the Latest Estimate view where it gets done. Nothing in Analyze. */

export default function ModeStrip({ status }: { status: ModeStatus | null }) {
  if (!status) return null;
  const t = status.totals;
  const seg = (text: string, tone?: "good" | "warn") => (
    <span className={"ms-seg" + (tone ? " " + tone : "")}>{text}</span>
  );
  return (
    <div className={"modestrip " + status.kind} role="status">
      <b className="ms-title">{status.kind === "le" ? `${status.schedule?.due.label ?? "LE"} · FY${status.year}` : `Plan ${status.year}`}</b>
      {status.kind === "le" ? (<>
        {status.schedule && (t.taken === t.customers
          ? seg(`locked ${status.schedule.due.lockDate} · all ${t.customers} accounts`, "good")
          : seg(`${t.taken} of ${t.customers} accounts locked for ${status.schedule.due.label.replace("LE ", "")}`, "warn"))}
        {status.schedule && seg(status.schedule.daysToLock <= 0
          ? `next lock due now`
          : `next lock ${status.schedule.open.lockDate} · ${status.schedule.daysToLock} day${status.schedule.daysToLock === 1 ? "" : "s"}`)}
        {seg(`NIQ through ${status.dataEdge}`)}
        {seg(`${t.adjustments} LE adjustment${t.adjustments === 1 ? "" : "s"} in play`)}
      </>) : (<>
        {seg(`distribution verified ${t.verified} of ${t.customers}`, t.verified === t.customers ? "good" : "warn")}
        {seg(`Plan of Record signed ${t.signed} of ${t.customers}`, t.signed === t.customers ? "good" : "warn")}
        {seg(`${t.adjustments} plan adjustment${t.adjustments === 1 ? "" : "s"}`)}
        {seg(`${t.events} event${t.events === 1 ? "" : "s"} in the plan`)}
      </>)}
      <Link href="/le" className="ms-link">{status.kind === "le" ? "Open the LE lock →" : "Open sign-off →"}</Link>
    </div>
  );
}
