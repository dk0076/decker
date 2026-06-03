-- =============================================================================
-- 20260529000000_add_cycle_number_to_cycles.sql
--
-- Adds cycle_number (integer) to the cycles table.
--
-- cycle_number is a timezone-independent integer identifying the logical week,
-- computed by the client via getCycle() (src/lib/cycle/index.ts) and written
-- on first INSERT of each cycle row. The derivation:
--
--   cycle_number = round( (localWeekStart_as_UTC_midnight
--                         − '2026-01-07'_as_UTC_midnight) / 7 days )
--
-- Two users whose local clocks both show the same Wednesday date share the
-- same cycle_number even if their UTC offsets differ by up to 25 hours.
--
-- WHY NOT NOT NULL?
-- Existing rows created before this migration have no cycle_number; adding NOT
-- NULL with no default would fail on a non-empty table. New rows written by
-- the updated client will always supply cycle_number. A follow-up migration
-- can backfill old rows and add the NOT NULL constraint once stale rows are
-- cleared.
--
-- FUTURE: update viewer_has_locked_for_cycle() to join on cycle_number rather
-- than week_start to fix cross-timezone post-to-unlock correctness. See the
-- TODO comment in 20260528000000_initial_schema.sql. That change must be made
-- in a separate migration after all cycle rows carry cycle_number.
-- =============================================================================

ALTER TABLE public.cycles
  ADD COLUMN cycle_number integer;

-- Index supports the future join in viewer_has_locked_for_cycle() and any
-- admin queries that look up cycles by logical week.
CREATE INDEX idx_cycles_cycle_number ON public.cycles (cycle_number);
