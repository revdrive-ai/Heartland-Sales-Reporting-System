import { redirect } from "next/navigation";

/* The Sales Leader View's old address. The Leadership team report replaced
   it in the sidebar; a bookmark, a cached sidebar or an old link still lands
   here, so it goes on to the report rather than to a 404. */
export default function Page() {
  redirect("/leadership");
}
