import { getPriceList } from "@/lib/repo";
import PriceListView from "@/components/pricelist/PriceListView";

/* Price List — dated list prices per Heartland item, the pricing basis every
   analysis ties back to. Data flows through the seam; per-item price changes
   entered on the screen live client-side (hhPriceEdits) until Supabase. */

export default async function Page() {
  const rows = await getPriceList();
  return <PriceListView rows={rows} />;
}
