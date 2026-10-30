import { getPriceList } from "@/lib/repo";
import PriceListView from "@/components/pricelist/PriceListView";

/* Price List — dated list prices per Heartland item, the pricing basis every
   analysis ties back to. Data flows through the seam; per-item price changes
   entered on the screen save to the shared state. Rendered on every request
   so the page reads the database live, never a copy frozen at build time. */

export const dynamic = "force-dynamic";

export default async function Page() {
  const rows = await getPriceList();
  return <PriceListView rows={rows} />;
}
