import { NextResponse } from "next/server";
import { listMarkets } from "@/lib/repo";
import { getDataEdgeYear } from "@/lib/server/mode";
import { getSnapshots, takeSnapshot } from "@/lib/server/planSnapshot";
import { setState } from "@/lib/server/appstate";
import { cronRunKey, type LeCronRun } from "@/lib/server/leCron";
import { dueCycle } from "@/lib/leSchedule";

/* The scheduled LE lock.

   Every account's forecast freezes at the end of the second Friday of each
   month. Vercel Cron calls this daily just after midnight UTC; on the
   Saturday that follows a second Friday it locks every account for that
   cycle, and on every other day it finds the cycle already locked and does
   nothing. Running daily rather than weekly makes it self-healing: if the
   run at the boundary fails, the next day's run still locks the cycle, and
   the version records that it was locked late.

   Locking is idempotent per account × cycle — an account already locked for
   the due cycle is skipped, so a retry never writes a second version. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel sets `Authorization: Bearer $CRON_SECRET` on scheduled calls. With
    no secret configured we accept only outside production, so a deployed
    endpoint is never open to the internet. */
function authorized(req: Request): { ok: true } | { ok: false; why: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return process.env.NODE_ENV === "production"
      // fail closed, but say why: an unset secret would otherwise look like
      // a silent nightly failure in the Vercel cron log
      ? { ok: false, why: "CRON_SECRET is not set on this deployment, so the scheduled lock cannot authenticate. Set it in the Vercel project's environment variables and redeploy." }
      : { ok: true };
  }
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`
    ? { ok: true }
    : { ok: false, why: "missing or wrong bearer token" };
}

export async function GET(req: Request) {
  const auth = authorized(req);
  if (!auth.ok) {
    return NextResponse.json({ error: "unauthorized", reason: auth.why }, { status: 401 });
  }
  const now = new Date();
  const cycle = dueCycle(now);
  const year = await getDataEdgeYear();
  // the cycle belongs to the in-flight year; a lock for any other year is a
  // scheduling artifact (e.g. January's cycle before the new NIQ year lands)
  if (+cycle.key.slice(0, 4) !== year) {
    return NextResponse.json({ skipped: `cycle ${cycle.key} is not in the data-edge year ${year}` });
  }

  const markets = await listMarkets();
  const run: LeCronRun = {
    at: now.toISOString(),
    cycle: cycle.key,
    year,
    locked: [],
    skipped: [],
    failed: [],
    onTime: now.toISOString().slice(0, 10) <= cycle.lockAt.slice(0, 10),
    trigger: req.headers.get("authorization") ? "schedule" : "manual",
  };

  for (const m of markets) {
    try {
      const versions = await getSnapshots(m.code, year);
      if (versions.some((v) => (v.cycle ?? v.taken_at.slice(0, 7)) === cycle.key)) {
        run.skipped.push(m.code);
        continue;
      }
      await takeSnapshot(m.code, year, `scheduled lock — ${cycle.label}`, cycle.key);
      run.locked.push(m.code);
    } catch (e) {
      run.failed.push({ code: m.code, error: e instanceof Error ? e.message.slice(0, 160) : "unknown" });
    }
  }

  // only record a run that did something, so the last-run line reports the
  // last real lock rather than yesterday's no-op
  if (run.locked.length || run.failed.length) {
    await setState(cronRunKey(year), run).catch(() => {});
  }
  return NextResponse.json(run, {
    status: run.failed.length ? 207 : 200,
    headers: { "cache-control": "no-store" },
  });
}
