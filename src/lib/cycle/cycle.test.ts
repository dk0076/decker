import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { getCycle } from './index';

// Build a Date from a local ISO string + IANA zone.
// e.g. at('America/New_York', '2026-01-07T12:00:00') === the UTC instant for noon EST.
function at(tz: string, localIso: string): Date {
  const dt = DateTime.fromISO(localIso, { zone: tz });
  if (!dt.isValid) throw new Error(`Bad test fixture: ${localIso} in ${tz}`);
  return dt.toJSDate();
}

// Build a Date directly from a UTC ISO string.
function utc(isoZ: string): Date {
  return new Date(isoZ);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Phase assignment — representative instants
//    Anchor cycle: Wed 2026-01-07 → Tue 2026-01-13 (America/New_York, EST=UTC-5)
// ─────────────────────────────────────────────────────────────────────────────
describe('phase assignment', () => {
  const NY = 'America/New_York';

  it('Wednesday noon → photo', () => {
    const r = getCycle(NY, at(NY, '2026-01-07T12:00:00'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Saturday afternoon → photo', () => {
    const r = getCycle(NY, at(NY, '2026-01-10T15:30:00'));
    expect(r.phase).toBe('photo');
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Sunday 23:59:59.999 → still photo', () => {
    const r = getCycle(NY, at(NY, '2026-01-11T23:59:59.999'));
    expect(r.phase).toBe('photo');
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Monday 00:00:00.000, hasLocked=false → curate', () => {
    const r = getCycle(NY, at(NY, '2026-01-12T00:00:00.000'), false);
    expect(r.phase).toBe('curate');
    expect(r.cycleNumber).toBe(0);
  });

  it('Monday 00:00:00.000, hasLocked=true → viewing', () => {
    const r = getCycle(NY, at(NY, '2026-01-12T00:00:00.000'), true);
    expect(r.phase).toBe('viewing');
    expect(r.cycleNumber).toBe(0);
  });

  it('Monday midday, hasLocked=false → curate', () => {
    const r = getCycle(NY, at(NY, '2026-01-12T14:00:00'), false);
    expect(r.phase).toBe('curate');
  });

  it('Monday midday, hasLocked=true → viewing', () => {
    const r = getCycle(NY, at(NY, '2026-01-12T14:00:00'), true);
    expect(r.phase).toBe('viewing');
  });

  it('Tuesday noon, hasLocked=false → curate', () => {
    const r = getCycle(NY, at(NY, '2026-01-13T12:00:00'), false);
    expect(r.phase).toBe('curate');
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Tuesday noon, hasLocked=true → viewing', () => {
    const r = getCycle(NY, at(NY, '2026-01-13T12:00:00'), true);
    expect(r.phase).toBe('viewing');
  });

  it('following Wednesday → photo again, new cycle', () => {
    const r = getCycle(NY, at(NY, '2026-01-14T00:00:00.000'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(1);
    expect(r.localWeekStart).toBe('2026-01-14');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Exact phase boundaries (millisecond precision)
// ─────────────────────────────────────────────────────────────────────────────
describe('exact phase boundaries', () => {
  const NY = 'America/New_York';

  it('Sun 23:59:59.999 → photo', () => {
    expect(getCycle(NY, at(NY, '2026-01-11T23:59:59.999')).phase).toBe('photo');
  });

  it('Mon 00:00:00.000 → curate (hasLocked=false)', () => {
    expect(getCycle(NY, at(NY, '2026-01-12T00:00:00.000'), false).phase).toBe('curate');
  });

  it('Mon 00:00:00.000 → viewing (hasLocked=true)', () => {
    expect(getCycle(NY, at(NY, '2026-01-12T00:00:00.000'), true).phase).toBe('viewing');
  });

  it('Tue 23:59:59.999 → curate (hasLocked=false)', () => {
    expect(getCycle(NY, at(NY, '2026-01-13T23:59:59.999'), false).phase).toBe('curate');
  });

  it('Wed 00:00:00.000 → photo, new cycle', () => {
    const r = getCycle(NY, at(NY, '2026-01-14T00:00:00.000'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(1);
  });

  // Sun→Mon boundary expressed as UTC instants (EST = UTC-5)
  it('1 ms before Mon boundary (UTC) → photo', () => {
    // Sun 23:59:59.999 EST = Mon 04:59:59.999 UTC
    expect(getCycle(NY, utc('2026-01-12T04:59:59.999Z')).phase).toBe('photo');
  });

  it('exactly Mon boundary (UTC) → curate', () => {
    // Mon 00:00:00.000 EST = Mon 05:00:00.000 UTC
    expect(getCycle(NY, utc('2026-01-12T05:00:00.000Z'), false).phase).toBe('curate');
  });

  it('1 ms before Wed boundary (UTC) → curate', () => {
    // Tue 23:59:59.999 EST = Wed 04:59:59.999 UTC
    expect(getCycle(NY, utc('2026-01-14T04:59:59.999Z'), false).phase).toBe('curate');
  });

  it('exactly Wed boundary (UTC) → photo, cycleNumber increments', () => {
    // Wed 00:00:00.000 EST = Wed 05:00:00.000 UTC
    const r = getCycle(NY, utc('2026-01-14T05:00:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. cycleNumber — timezone independence
//    At UTC 2026-01-08T12:00:00Z all five zones are in the same logical week
//    (local calendar dates Jan 7–14) and must share cycleNumber=0.
// ─────────────────────────────────────────────────────────────────────────────
describe('cycleNumber timezone independence', () => {
  const refInstant = utc('2026-01-08T12:00:00.000Z');

  it('America/Los_Angeles — cycleNumber 0', () => {
    const r = getCycle('America/Los_Angeles', refInstant);
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('America/New_York — cycleNumber 0', () => {
    const r = getCycle('America/New_York', refInstant);
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Asia/Tokyo — cycleNumber 0', () => {
    // UTC+9: 2026-01-08 12:00 UTC → Jan 8 21:00 local (Thursday)
    const r = getCycle('Asia/Tokyo', refInstant);
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Pacific/Kiritimati (UTC+14) — cycleNumber 0', () => {
    // 2026-01-08 12:00 UTC → Jan 9 02:00 local (Friday)
    const r = getCycle('Pacific/Kiritimati', refInstant);
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('Pacific/Pago_Pago (UTC-11) — cycleNumber 0', () => {
    // 2026-01-08 12:00 UTC → Jan 8 01:00 local (Thursday)
    const r = getCycle('Pacific/Pago_Pago', refInstant);
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
  });

  it('all five zones share the same cycleNumber at the reference instant', () => {
    const zones = [
      'America/Los_Angeles',
      'America/New_York',
      'Asia/Tokyo',
      'Pacific/Kiritimati',
      'Pacific/Pago_Pago',
    ];
    const numbers = zones.map(tz => getCycle(tz, refInstant).cycleNumber);
    expect(new Set(numbers).size).toBe(1);
  });

  // Edge: Kiritimati has already crossed into cycle 1 while Pago Pago is still in cycle 0.
  // At UTC 2026-01-13T20:00:00Z:
  //   Kiritimati (UTC+14) local = Jan 14 10:00 Wed → cycle 1
  //   Pago Pago  (UTC-11) local = Jan 13 09:00 Tue → cycle 0
  it('Kiritimati and Pago_Pago can be in different cycles at the same UTC instant', () => {
    const split = utc('2026-01-13T20:00:00.000Z');
    expect(getCycle('Pacific/Kiritimati', split).cycleNumber).toBe(1);
    expect(getCycle('Pacific/Pago_Pago', split).cycleNumber).toBe(0);
  });

  it('cycleNumber increments by 1 each week', () => {
    // Six consecutive Wednesdays starting from the anchor.
    // Use luxon to add calendar weeks so month overflow is handled correctly.
    const base = DateTime.fromISO('2026-01-07T12:00:00', { zone: 'America/New_York' });
    for (let week = 0; week < 6; week++) {
      const date = base.plus({ weeks: week }).toJSDate();
      expect(getCycle('America/New_York', date).cycleNumber).toBe(week);
    }
  });

  it('cycleNumber is negative for instants before the anchor', () => {
    // Wed 2025-12-31 — one week before the anchor
    const r = getCycle('America/New_York', at('America/New_York', '2025-12-31T12:00:00'));
    expect(r.cycleNumber).toBe(-1);
    expect(r.localWeekStart).toBe('2025-12-31');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3b. Intended cross-timezone cycleNumber divergence window
//
// DESIGN INTENT — do not "fix" this:
//
// Each user's cycleNumber is anchored to THEIR local Wednesday. Two users in
// distant timezones will hold different cycleNumbers for the ~17-hour window
// between when the earlier zone crosses midnight into Wednesday and when the
// later zone does the same.
//
// Tokyo (UTC+9)  crosses into Wednesday at 15:00 UTC Tuesday.
// Los Angeles (PST, UTC-8) crosses into Wednesday at 08:00 UTC Wednesday.
// Divergence window: Tue 15:00 UTC → Wed 08:00 UTC = 17 hours.
//
// This does NOT break post-to-unlock because:
//   - During the divergence window Tokyo is in the PHOTO phase of the new cycle.
//     They are submitting candidates, not viewing anyone's feed yet.
//   - LA is still in Mon/Tue curate/viewing for the OLD cycleNumber. Their
//     viewing window has already ended (or is ending) for that cycle.
//   - Cross-user feed matching (viewer sees author's posts) uses cycleNumber to
//     join rows. By the time EITHER user enters their local viewing phase
//     (Monday of the new cycle) the other zone has been in that same cycleNumber
//     for at least 5 days. Convergence is complete before it matters.
// ─────────────────────────────────────────────────────────────────────────────
describe('intended cross-timezone cycleNumber divergence', () => {
  // UTC 2026-01-13T15:00:00Z is exactly Wed 2026-01-14 00:00:00 JST (Tokyo midnight).
  // At the same instant, Los Angeles reads Tue 2026-01-13 07:00:00 PST — still the old cycle.
  const divergenceInstant = utc('2026-01-13T15:00:00.000Z');

  it('Tokyo is in cycleNumber 1 (Wednesday) at the divergence instant', () => {
    const r = getCycle('Asia/Tokyo', divergenceInstant);
    expect(r.cycleNumber).toBe(1);
    expect(r.localWeekStart).toBe('2026-01-14');
    expect(r.phase).toBe('photo'); // just crossed into the new cycle's photo phase
  });

  it('Los Angeles is still in cycleNumber 0 (Tuesday) at the same instant', () => {
    const r = getCycle('America/Los_Angeles', divergenceInstant, false);
    expect(r.cycleNumber).toBe(0);
    expect(r.localWeekStart).toBe('2026-01-07');
    expect(r.phase).toBe('curate'); // old cycle's Mon/Tue curate/viewing window
  });

  it('cycleNumbers differ during the divergence window — this is expected', () => {
    const tokyo = getCycle('Asia/Tokyo', divergenceInstant);
    const la    = getCycle('America/Los_Angeles', divergenceInstant);
    expect(tokyo.cycleNumber).not.toBe(la.cycleNumber);
    // Tokyo is one full cycle ahead of LA at this instant.
    expect(tokyo.cycleNumber - la.cycleNumber).toBe(1);
  });

  it('divergence window ends when LA crosses its local Wednesday — cycleNumbers reconverge', () => {
    // Wed 2026-01-14 00:00 PST = 08:00 UTC: LA just entered Wednesday.
    const afterDivergence = utc('2026-01-14T08:00:00.000Z');
    const tokyo = getCycle('Asia/Tokyo', afterDivergence);
    const la    = getCycle('America/Los_Angeles', afterDivergence);
    expect(la.cycleNumber).toBe(1);
    expect(tokyo.cycleNumber).toBe(la.cycleNumber); // back in sync
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. nextPhaseChangeAt
// ─────────────────────────────────────────────────────────────────────────────
describe('nextPhaseChangeAt', () => {
  const NY = 'America/New_York'; // EST = UTC-5

  it('photo phase → points to Monday 00:00 local (UTC-5 = 05:00Z)', () => {
    const r = getCycle(NY, at(NY, '2026-01-07T12:00:00'));
    // Mon 2026-01-12 00:00 EST = 05:00 UTC
    expect(r.nextPhaseChangeAt.toISOString()).toBe('2026-01-12T05:00:00.000Z');
  });

  it('photo phase on Saturday still points to the same Monday', () => {
    const r = getCycle(NY, at(NY, '2026-01-10T20:00:00'));
    expect(r.nextPhaseChangeAt.toISOString()).toBe('2026-01-12T05:00:00.000Z');
  });

  it('curate/viewing phase → points to Wednesday 00:00 local', () => {
    const r = getCycle(NY, at(NY, '2026-01-12T14:00:00'), false);
    // Wed 2026-01-14 00:00 EST = 05:00 UTC
    expect(r.nextPhaseChangeAt.toISOString()).toBe('2026-01-14T05:00:00.000Z');
  });

  it('Tuesday still points to the same following Wednesday', () => {
    const r = getCycle(NY, at(NY, '2026-01-13T23:00:00'), true);
    expect(r.nextPhaseChangeAt.toISOString()).toBe('2026-01-14T05:00:00.000Z');
  });

  it('nextPhaseChangeAt is strictly in the future relative to a mid-phase instant', () => {
    const now = at(NY, '2026-01-09T10:00:00'); // Friday
    const r = getCycle(NY, now);
    expect(r.nextPhaseChangeAt.getTime()).toBeGreaterThan(now.getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DST transitions — America/Los_Angeles
//    Spring forward: 2026-03-08 02:00 PST → 03:00 PDT  (cycle 8, Sun photo)
//    Fall back:      2026-11-01 02:00 PDT → 01:00 PST  (cycle 42, Sun photo)
// ─────────────────────────────────────────────────────────────────────────────
describe('DST transitions (America/Los_Angeles)', () => {
  const LA = 'America/Los_Angeles';

  // ── Spring-forward: 2026-03-08 ────────────────────────────────────────────
  // Cycle 8: Wed 2026-03-04 → Tue 2026-03-10
  // (2026-03-04 – 2026-01-07 = 56 days = 8 weeks)

  it('spring-forward Sunday 01:30 PST (before jump) → photo, cycle 8', () => {
    // 01:30 PST = UTC-8 → 09:30 UTC
    const r = getCycle(LA, utc('2026-03-08T09:30:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(8);
    expect(r.localWeekStart).toBe('2026-03-04');
  });

  it('spring-forward Sunday 03:30 PDT (after jump) → photo, same cycle', () => {
    // 03:30 PDT = UTC-7 → 10:30 UTC
    const r = getCycle(LA, utc('2026-03-08T10:30:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(8);
    expect(r.localWeekStart).toBe('2026-03-04');
  });

  it('spring-forward: nextPhaseChangeAt is Mon 2026-03-09 00:00 PDT (07:00Z)', () => {
    const r = getCycle(LA, utc('2026-03-08T10:30:00.000Z'));
    expect(r.nextPhaseChangeAt.toISOString()).toBe('2026-03-09T07:00:00.000Z');
  });

  it('spring-forward Mon 00:00 PDT → curate (boundary correct after DST)', () => {
    // Mon 2026-03-09 00:00 PDT = 07:00 UTC
    const r = getCycle(LA, utc('2026-03-09T07:00:00.000Z'), false);
    expect(r.phase).toBe('curate');
    expect(r.cycleNumber).toBe(8);
  });

  it('spring-forward Tue 23:59:59.999 PDT → still curate', () => {
    // Tue 2026-03-10 23:59:59.999 PDT = Wed 2026-03-11 06:59:59.999 UTC
    const r = getCycle(LA, utc('2026-03-11T06:59:59.999Z'), false);
    expect(r.phase).toBe('curate');
    expect(r.cycleNumber).toBe(8);
  });

  it('spring-forward Wed 00:00 PDT → photo, cycle 9', () => {
    // Wed 2026-03-11 00:00 PDT = 07:00 UTC
    const r = getCycle(LA, utc('2026-03-11T07:00:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(9);
  });

  // ── Fall-back: 2026-11-01 ─────────────────────────────────────────────────
  // Cycle 42: Wed 2026-10-28 → Tue 2026-11-03
  // (2026-10-28 – 2026-01-07 = 294 days = 42 weeks)

  it('fall-back Sunday 01:30 PDT (before clock falls back) → photo, cycle 42', () => {
    // 01:30 PDT = UTC-7 → 08:30 UTC
    const r = getCycle(LA, utc('2026-11-01T08:30:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(42);
    expect(r.localWeekStart).toBe('2026-10-28');
  });

  it('fall-back Sunday 01:30 PST (after clock falls back) → photo, same cycle', () => {
    // 01:30 PST = UTC-8 → 09:30 UTC — same wall-clock time, different UTC
    const r = getCycle(LA, utc('2026-11-01T09:30:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(42);
  });

  it('fall-back: nextPhaseChangeAt is Mon 2026-11-02 00:00 PST (08:00Z)', () => {
    // After fall-back the Monday boundary is in PST (UTC-8)
    const r = getCycle(LA, utc('2026-11-01T09:30:00.000Z'));
    expect(r.nextPhaseChangeAt.toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });

  it('fall-back Mon 00:00 PST → curate (boundary correct after DST)', () => {
    // Mon 2026-11-02 00:00 PST = 08:00 UTC
    const r = getCycle(LA, utc('2026-11-02T08:00:00.000Z'), false);
    expect(r.phase).toBe('curate');
    expect(r.cycleNumber).toBe(42);
  });

  it('fall-back Tue 23:59:59.999 PST → still curate', () => {
    // Tue 2026-11-03 23:59:59.999 PST = Wed 2026-11-04 07:59:59.999 UTC
    const r = getCycle(LA, utc('2026-11-04T07:59:59.999Z'), false);
    expect(r.phase).toBe('curate');
    expect(r.cycleNumber).toBe(42);
  });

  it('fall-back Wed 00:00 PST → photo, cycle 43', () => {
    // Wed 2026-11-04 00:00 PST = 08:00 UTC
    const r = getCycle(LA, utc('2026-11-04T08:00:00.000Z'));
    expect(r.phase).toBe('photo');
    expect(r.cycleNumber).toBe(43);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Multiple timezones — phase assignment at the same UTC instant
// ─────────────────────────────────────────────────────────────────────────────
describe('multi-timezone phase correctness', () => {
  // UTC 2026-01-12T12:00:00Z = a Monday
  //   LA  (UTC-8)  → Mon 04:00  → curate/viewing
  //   NY  (UTC-5)  → Mon 07:00  → curate/viewing
  //   Tokyo(UTC+9) → Mon 21:00  → curate/viewing
  //   Kiritimati(UTC+14) → Mon 26:00 = Tue 02:00  → curate/viewing
  //   Pago Pago(UTC-11) → Mon 01:00  → curate/viewing
  it('all five zones on a Monday UTC → curate (no lock)', () => {
    const mon = utc('2026-01-12T12:00:00.000Z');
    const zones = [
      'America/Los_Angeles',
      'America/New_York',
      'Asia/Tokyo',
      'Pacific/Kiritimati',
      'Pacific/Pago_Pago',
    ];
    for (const tz of zones) {
      const r = getCycle(tz, mon, false);
      expect(r.phase, `${tz} should be curate`).toBe('curate');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Error handling
// ─────────────────────────────────────────────────────────────────────────────
describe('error handling', () => {
  it('throws on an invalid timezone string', () => {
    expect(() => getCycle('Not/AZone', new Date())).toThrow(/Invalid timezone/);
  });
});
