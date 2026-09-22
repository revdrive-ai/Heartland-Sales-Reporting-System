import { redirect } from "next/navigation";

/* Everyone starts at the front door. Admins get the map from there. */
export default function Home() {
  redirect("/start");
}
