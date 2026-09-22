"use client";

import { useEffect } from "react";
import { writeProcCookie, type ProcResume } from "@/lib/process";

/* Remembers this step as the place to come back to. Position is personal, so
   it lives in a cookie; the work itself is already saved server-side per
   customer x year. Leaving midway and re-entering is therefore just reading
   this back on the front door. */
export default function ProcRemember({ at }: { at: ProcResume }) {
  useEffect(() => {
    writeProcCookie(at);
  }, [at.kind, at.step, at.planYear]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
