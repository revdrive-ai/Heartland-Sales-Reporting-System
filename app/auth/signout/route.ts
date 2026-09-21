import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function signOut(req: Request) {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}

export const POST = signOut;
export const GET = signOut;
