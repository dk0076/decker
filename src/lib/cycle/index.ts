import { DateTime } from 'luxon';

export type Phase = 'photo' | 'curate' | 'viewing';

export type CycleInfo = {
  /**
   * Timezone-independent integer identifying the logical week.
   *
   * Derivation: compare the user's local Wednesday date (YYYY-MM-DD) against
   * the fixed anchor date (ANCHOR_DATE, also a Wednesday) by treating both as
   * UTC-midnight values. This eliminates offset variability — "2026-01-14"
   * parsed as UTC is always exactly 7 days after "2026-01-07" parsed as UTC,
   * regardless of the user's actual offset. Since localWeekStart is always a
   * Wednesday, daysDiff is always a multiple of 7, so cycleNumber is an exact
   * integer (Math.round absorbs floating-point noise only).
   *
   * Two users whose local clocks both show the same Wednesday date share the
   * same cycleNumber even if their UTC offsets differ by up to 25 hours.
   */
  cycleNumber: number;

  phase: Phase;

  /** The Wednesday date (YYYY-MM-DD) that opens this cycle in the user's local calendar. */
  localWeekStart: string;

  /** Instant at which the current phase ends and the next begins. */
  nextPhaseChangeAt: Date;
};

/**
 * Calendar date of cycle 0. Any Wednesday works; 2026-01-07 is the project epoch.
 * Parsed as UTC midnight to serve as a stable, offset-free reference point.
 */
const ANCHOR_DATE = '2026-01-07';

/**
 * Returns the current cycle state for a user in the given IANA timezone.
 *
 * @param tz        IANA timezone string, e.g. "America/Los_Angeles".
 * @param now       Reference instant. Defaults to new Date() so production code
 *                  gets the real clock and tests can inject a fixed time.
 * @param hasLocked Whether the user has locked their 5 photos for this cycle.
 *                  Mon–Tue phase depends on this flag: false → 'curate', true → 'viewing'.
 *                  The function is pure — it never reads the database.
 */
export function getCycle(
  tz: string,
  now: Date = new Date(),
  hasLocked = false,
): CycleInfo {
  const local = DateTime.fromJSDate(now, { zone: tz });
  if (!local.isValid) {
    throw new Error(`Invalid timezone "${tz}": ${local.invalidExplanation ?? 'unknown reason'}`);
  }

  // Luxon ISO weekday: Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6 Sun=7
  const dow = local.weekday;

  // Days to walk back to the most recent Wednesday:
  //   Wed(3)→0  Thu(4)→1  Fri(5)→2  Sat(6)→3  Sun(7)→4  Mon(1)→5  Tue(2)→6
  const daysSinceWed = (dow - 3 + 7) % 7;

  // Wednesday midnight that opened this cycle, in the user's local timezone.
  // Luxon's calendar arithmetic handles DST correctly: adding/subtracting
  // whole days on a zone-aware DateTime lands on the same wall-clock time.
  const cycleWed = local.minus({ days: daysSinceWed }).startOf('day');
  const localWeekStart = cycleWed.toISODate()!; // e.g. "2026-01-07"

  // cycleNumber — compare calendar dates as UTC midnight values (see type comment above).
  const anchorDt = DateTime.fromISO(ANCHOR_DATE, { zone: 'UTC' });
  const cycleDt  = DateTime.fromISO(localWeekStart, { zone: 'UTC' });
  const cycleNumber = Math.round(cycleDt.diff(anchorDt, 'days').days / 7);

  // Phase and next boundary ─────────────────────────────────────────────────
  // daysSinceWed: 0=Wed 1=Thu 2=Fri 3=Sat 4=Sun 5=Mon 6=Tue
  let phase: Phase;
  let nextPhaseChangeAt: Date;

  if (daysSinceWed <= 4) {
    // Wed → Sun: PHOTO
    phase = 'photo';
    // Next boundary: Monday 00:00 local = cycleWed + 5 calendar days
    nextPhaseChangeAt = cycleWed.plus({ days: 5 }).toJSDate();
  } else {
    // Mon (5) or Tue (6): CURATE or VIEWING depending on lock state
    phase = hasLocked ? 'viewing' : 'curate';
    // Next boundary: following Wednesday 00:00 local = cycleWed + 7 calendar days
    nextPhaseChangeAt = cycleWed.plus({ days: 7 }).toJSDate();
  }

  return { cycleNumber, phase, localWeekStart, nextPhaseChangeAt };
}
