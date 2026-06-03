import { supabase } from '@/lib/supabase';
import type { CycleInfo } from './index';

export type CycleRow = {
  id: string;
  user_id: string;
  week_start: string;
  cycle_number: number | null; // null on rows pre-dating the 20260529 migration
  phase: 'photo' | 'curate' | 'viewing';
  locked_at: string | null;    // null until the server-side roulette draw fires
  created_at: string;
};

/**
 * Ensures a cycle row exists for the given user and current week, then returns
 * the canonical row (whether newly created or pre-existing).
 *
 * IDEMPOTENCY
 * Uses INSERT … ON CONFLICT (user_id, week_start) DO NOTHING so that
 * concurrent calls — from StrictMode double-invoke, fast re-renders, or two
 * simultaneous app opens — all succeed without creating duplicates or throwing
 * on the UNIQUE constraint. The DB resolves the race; the client always ends up
 * reading the one true row.
 *
 * WHY ignoreDuplicates:true INSTEAD OF A FULL UPSERT
 * The cycles UPDATE policy is not granted to the authenticated role — phase
 * transitions (photo → curate → viewing) are exclusively written by Edge
 * Functions via service_role. A DO UPDATE upsert from the client would hit the
 * RLS UPDATE check and fail on an existing row. DO NOTHING avoids that entirely.
 *
 * WHAT GETS WRITTEN
 * phase defaults to 'photo' (correct for all new rows; Edge Functions advance
 * it later). cycle_number is set from the pure engine so cross-timezone feed
 * matching can eventually join on it instead of week_start.
 */
export async function ensureCycleRow(
  userId: string,
  cycle: Pick<CycleInfo, 'localWeekStart' | 'cycleNumber'>,
): Promise<{ data: CycleRow | null; error: string | null }> {
  const { error: upsertError } = await supabase
    .from('cycles')
    .upsert(
      {
        user_id:      userId,
        week_start:   cycle.localWeekStart,
        cycle_number: cycle.cycleNumber,
        phase:        'photo',
      },
      { onConflict: 'user_id,week_start', ignoreDuplicates: true },
    );

  if (upsertError) return { data: null, error: upsertError.message };

  // Always SELECT after the upsert: whether we inserted a fresh row or hit
  // DO NOTHING, we need the canonical id and current phase for downstream use.
  const { data, error: selectError } = await supabase
    .from('cycles')
    .select('id, user_id, week_start, cycle_number, phase, locked_at, created_at')
    .eq('user_id', userId)
    .eq('week_start', cycle.localWeekStart)
    .single();

  if (selectError) return { data: null, error: selectError.message };
  return { data: data as CycleRow, error: null };
}
