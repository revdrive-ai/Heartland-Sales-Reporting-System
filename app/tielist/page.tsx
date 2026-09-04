import { getPromoMeta, getTieList } from "@/lib/repo";
import { getScope } from "@/lib/server/scope";
import TieListView from "@/components/tielist/TieListView";

/* Tie List — the item identifier map (Telus/Heartland item # ↔ NIQ UPC ↔ the
   NIQ pull), built from the item crosswalk through the seam. The access point
   for the crosswalk the planner scores against. */

export default async function Page() {
  const [rows, meta, gscope] = await Promise.all([getTieList(), getPromoMeta(), getScope()]);
  return (
    <TieListView
      data={{
        rows,
        fiscalYear: meta.fiscal_year,
        scopeLabel: gscope.active ? gscope.label : undefined,
      }}
    />
  );
}
