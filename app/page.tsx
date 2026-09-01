import { redirect } from "next/navigation";

/* The demo lands on the Sales Dashboard (workflow step 3). */
export default function Home() {
  redirect("/reporting");
}
