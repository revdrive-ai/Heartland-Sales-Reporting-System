import { getScope } from "@/lib/server/scope";
import { buildLeadership, selectionFrom } from "@/lib/server/leadership";
import { DEFAULT_SELECTION } from "@/lib/leadership/report";
import LeadershipView from "@/components/leadership/LeadershipView";

/* The Leadership team report — sales for the President to take to the
   owner. One selection (period, customer, brand, item, measure, sort) in
   the URL; one page of the report at a time on screen, or every page in
   order as a printable presentation (page=all). The top bar's scope sets
   the customers on the table; with no scope set, every customer on file. */

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, scope] = await Promise.all([searchParams, getScope()]);
  const sel = selectionFrom(sp, DEFAULT_SELECTION);
  const page = Array.isArray(sp.page) ? sp.page[0] : sp.page;
  const data = await buildLeadership(sel, scope.active ? scope.marketCodes : null, scope.active ? scope.label : "All customers");
  // a customer outside the scope falls back to all of them
  if (sel.customer !== "ALL" && !data.options.customers.some((c) => c.code === sel.customer)) {
    const fixed = await buildLeadership({ ...sel, customer: "ALL" }, scope.active ? scope.marketCodes : null, scope.active ? scope.label : "All customers");
    return <LeadershipView data={fixed} page={page ?? "summary"} />;
  }
  return <LeadershipView data={data} page={page ?? "summary"} />;
}
