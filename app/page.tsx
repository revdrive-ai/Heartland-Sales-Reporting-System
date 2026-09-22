import { redirect } from "next/navigation";
import { surfacePath } from "@/lib/surface";

/* The demo lands on the Sales Dashboard (workflow step 3) — or, on a surface
   that doesn't show it, wherever that surface starts instead. */
export default function Home() {
  redirect(surfacePath("/reporting"));
}
