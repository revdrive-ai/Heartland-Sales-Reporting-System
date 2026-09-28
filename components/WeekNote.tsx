import { weekCountNote } from "@/lib/weeks";

/* The 53-week call-out beside a full-year total: shown only when the year
   and the year it is read against hold a different number of weeks. The
   sentence behind it is the tooltip. */
export default function WeekNote({ year, vs }: { year: number; vs: number }) {
  const n = weekCountNote(year, vs);
  if (!n) return null;
  return <span className="wk53" title={n.title}>{n.text}</span>;
}
