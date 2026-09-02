import { NextResponse } from "next/server";
import { getPromoLines, getPromotion } from "@/lib/repo";

/* Lines for one promotion — fetched on row-expand so the planner never ships
   all 5,117 lines to the browser. Becomes a Supabase query later, same URL. */

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ promoId: string }> }
) {
  const { promoId } = await ctx.params;
  const promo = await getPromotion(promoId);
  if (!promo) return NextResponse.json({ error: "unknown promo_id" }, { status: 404 });
  const lines = await getPromoLines(promoId);
  return NextResponse.json({ promo_id: promoId, lines });
}
