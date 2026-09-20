/* The Latest Estimate lock schedule.

   An LE is not taken per customer whenever someone gets to it: it is a
   scheduled, portfolio-wide lock. Every calendar month closes at the END of
   its SECOND FRIDAY — midnight as that Friday turns into Saturday. Whatever
   the forecast says at that instant is the locked LE for every account, and
   it never moves again.

   Dates are computed in UTC, the same basis the NIQ week-endings and every
   other date in the tool use. */

const DAY = 86400000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type LeCycle = {
  key: string;        // "2026-09"
  label: string;      // "LE Sep 2026"
  monthName: string;  // "September 2026"
  lockDate: string;   // the second Friday, ISO — the day the forecast is read
  lockAt: string;     // the instant it freezes: midnight ending that Friday
};

/** The second Friday of a month, as an ISO date (UTC). */
export function secondFriday(year: number, month0: number): string {
  let t = Date.UTC(year, month0, 1);
  while (new Date(t).getUTCDay() !== 5) t += DAY; // 5 = Friday
  return new Date(t + 7 * DAY).toISOString().slice(0, 10);
}

export function cycleFor(year: number, month0: number): LeCycle {
  const lockDate = secondFriday(year, month0);
  return {
    key: `${year}-${String(month0 + 1).padStart(2, "0")}`,
    label: `LE ${MONTHS[month0]} ${year}`,
    monthName: `${FULL[month0]} ${year}`,
    lockDate,
    // "EOD the second Friday": the forecast freezes at midnight, which is the
    // start of the following day
    lockAt: new Date(Date.UTC(+lockDate.slice(0, 4), +lockDate.slice(5, 7) - 1, +lockDate.slice(8, 10)) + DAY).toISOString(),
  };
}

export function cycleFromKey(key: string): LeCycle {
  return cycleFor(+key.slice(0, 4), +key.slice(5, 7) - 1);
}

/** Every cycle of a year whose lock instant has already passed, newest first. */
export function lockedCycles(year: number, now = new Date()): LeCycle[] {
  const out: LeCycle[] = [];
  for (let m = 0; m < 12; m++) {
    const c = cycleFor(year, m);
    if (new Date(c.lockAt) <= now) out.push(c);
  }
  return out.reverse();
}

/** The cycle currently open — the next lock that hasn't happened yet. */
export function openCycle(now = new Date()): LeCycle {
  const y = now.getUTCFullYear();
  for (let m = 0; m < 12; m++) {
    const c = cycleFor(y, m);
    if (new Date(c.lockAt) > now) return c;
  }
  return cycleFor(y + 1, 0);
}

/** The most recent cycle whose lock has passed (what should be on record). */
export function dueCycle(now = new Date()): LeCycle {
  const y = now.getUTCFullYear();
  let last = cycleFor(y - 1, 11);
  for (let m = 0; m < 12; m++) {
    const c = cycleFor(y, m);
    if (new Date(c.lockAt) <= now) last = c; else break;
  }
  return last;
}

/** Whole days from now until a cycle locks (negative once it has passed). */
export function daysUntilLock(c: LeCycle, now = new Date()): number {
  return Math.ceil((new Date(c.lockAt).getTime() - now.getTime()) / DAY);
}
