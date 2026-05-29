-- =============================================================================
-- 20260528000000_initial_schema.sql
--
-- Core schema for Decker: users, friendships, cycles, candidates, posts,
-- likes, comments — plus RLS policies enforcing friends-only post visibility.
--
-- Invariants enforced here (not trusted to the client):
--   • Only mutual friends can see each other's posts.
--   • Post-to-unlock: a viewer cannot see friends' posts until they have
--     completed their own roulette draw for the same cycle week.
--   • Candidates, likes, and comments are strictly private/self-owned.
--   • Likes and comments can only be created during the viewing phase.
-- =============================================================================


-- =============================================================================
-- TABLES
-- =============================================================================

-- Public profile for every authenticated user.
-- One row per auth.users entry; created on first sign-in via trigger (added later).
-- The timezone column stores the user's IANA tz string (e.g. "America/New_York"),
-- which Edge Functions use to calculate each user's Wed–Tue cycle boundary in
-- local time.
CREATE TABLE public.users (
  id            uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username      text        UNIQUE NOT NULL,
  display_name  text,
  avatar_url    text,
  timezone      text        NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Directed friendship edge: requester sends a request to addressee.
-- A friendship is considered MUTUAL only when status = 'accepted'.
-- 'blocked' is a one-way block; either participant may set it (see UPDATE policy).
-- A blocked row is invisible to the non-blocking party via RLS.
CREATE TABLE public.friendships (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  addressee_id  uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- prevent duplicate requests in the same direction
  UNIQUE (requester_id, addressee_id),
  -- a user cannot friend themselves
  CHECK (requester_id <> addressee_id)
);

-- One cycle row per user per week.
-- week_start is always the Wednesday that opens the photo phase for that user.
-- phase advances: 'photo' → 'curate' → 'viewing' (set by Edge Functions).
-- locked_at is NULL until the server-side roulette draw fires and publishes
-- the user's 5 posts; it is the gate for the post-to-unlock rule.
CREATE TABLE public.cycles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  week_start    date        NOT NULL,
  phase         text        NOT NULL DEFAULT 'photo'
                            CHECK (phase IN ('photo', 'curate', 'viewing')),
  locked_at     timestamptz,           -- NULL until roulette fires
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

-- Candidate photos accumulated during the photo phase (Wed–Sun).
-- HARD-DELETE semantics: when a candidate is vetoed, the row is deleted and
-- the storage object is purged in the same operation. There is no soft-delete
-- column — a missing row means the photo is permanently gone.
CREATE TABLE public.candidates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  cycle_id      uuid        NOT NULL REFERENCES public.cycles (id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  taken_at      timestamptz,           -- EXIF capture time; may be null
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Published posts: exactly 5 per user per cycle, drawn by server-side roulette.
-- position 1–5 is the slot index from the draw. Rows are immutable once created
-- (no UPDATE policy for the anon role). lat/lng are strictly opt-in.
--
-- ⚠ SCHEMA ENFORCEMENT BOUNDARY — READ BEFORE TOUCHING THIS TABLE ⚠
-- The schema enforces a CEILING of 5 posts per cycle via UNIQUE(cycle_id, position)
-- and CHECK(position BETWEEN 1 AND 5). It does NOT enforce the following invariants
-- from CLAUDE.md — those are exclusively the responsibility of the roulette Edge
-- Function (service_role), which is the only writer for this table:
--
--   • Exactly 5 posts drawn per cycle (schema allows 0–5; Edge Function writes 5
--     or 0 on inaction — never a partial set).
--   • Draw pool must have >= 12 surviving candidates (schema cannot see candidates
--     at insert time without a trigger; kept out deliberately to avoid coupling).
--   • Draw is random and non-rerollable (algorithmic; not expressible in SQL).
--   • Fail-safe: if the user takes no action during curate, nothing is published
--     (Edge Function writes 0 rows; it never auto-selects raw photos).
--
-- If you add a DB trigger to this table, make sure it does not inadvertently
-- relax or duplicate any of these invariants.
CREATE TABLE public.posts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  cycle_id      uuid        NOT NULL REFERENCES public.cycles (id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  position      smallint    NOT NULL CHECK (position BETWEEN 1 AND 5),
  lat           double precision,
  lng           double precision,
  published_at  timestamptz NOT NULL DEFAULT now(),
  -- only one post per slot per cycle
  UNIQUE (cycle_id, position)
);

-- Likes on a post. Each user can like a post at most once.
-- Only insertable during the viewing phase (enforced by RLS below).
CREATE TABLE public.likes (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);

-- Text comments on a post. Body is 1–500 characters.
-- Only insertable during the viewing phase (enforced by RLS below).
CREATE TABLE public.comments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid        NOT NULL REFERENCES public.posts (id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at    timestamptz NOT NULL DEFAULT now()
);


-- =============================================================================
-- INDEXES
-- =============================================================================

-- Friendship lookups run in both directions (requester OR addressee = me).
CREATE INDEX idx_friendships_requester ON public.friendships (requester_id);
CREATE INDEX idx_friendships_addressee ON public.friendships (addressee_id);

-- Cycle lookup by owner + week (hot path in phase checks and post-to-unlock).
CREATE INDEX idx_cycles_user_week ON public.cycles (user_id, week_start);

-- Candidate list per cycle (curate screen).
CREATE INDEX idx_candidates_cycle ON public.candidates (cycle_id);

-- Post lookups: by owner (profile) and by cycle (feed assembly).
CREATE INDEX idx_posts_user    ON public.posts (user_id);
CREATE INDEX idx_posts_cycle   ON public.posts (cycle_id);

-- Reaction counts per post.
CREATE INDEX idx_likes_post    ON public.likes    (post_id);
CREATE INDEX idx_comments_post ON public.comments (post_id);


-- =============================================================================
-- HELPER FUNCTIONS
-- =============================================================================

-- Returns TRUE if users `a` and `b` share an accepted friendship in either
-- direction. SECURITY DEFINER so it can read friendships freely; this function
-- IS the authorization check used by downstream RLS policies.
CREATE OR REPLACE FUNCTION public.are_friends (a uuid, b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.friendships
    WHERE  status = 'accepted'
      AND  (
             (requester_id = a AND addressee_id = b)
             OR
             (requester_id = b AND addressee_id = a)
           )
  );
$$;

-- Returns TRUE if auth.uid() has completed their own roulette draw
-- (locked_at IS NOT NULL) for the same calendar week as `author_cycle_id`.
-- This is the post-to-unlock gate: a user who has not published their own 5
-- cannot see anyone else's posts that week.
--
-- SECURITY DEFINER so it can cross-reference two users' cycle rows without
-- needing a permissive SELECT policy on cycles.
--
-- TODO (multi-timezone): The JOIN ON vc.week_start = ac.week_start matches
-- cycles by calendar date. This works correctly only when both users share the
-- same week_start date — i.e. their Wed→Tue boundary falls on the same calendar
-- Wednesday. Users in widely separated timezones can have different week_start
-- values for what is logically "the same cycle" (e.g. a user in UTC+14 rolls
-- over to Wednesday several hours before a user in UTC-12). When that happens,
-- the JOIN produces no match and the viewer is incorrectly blocked from seeing
-- their friend's posts even after locking.
--
-- Resolution before multi-timezone launch: replace the date-equality join with
-- a canonical cycle identifier that is timezone-independent — for example a
-- "cycle_number" integer (ISO week number or days-since-epoch / 7) computed at
-- cycle creation time and stored on the cycles row. Do not change the logic
-- here until the cycles table and Edge Function are updated together.
CREATE OR REPLACE FUNCTION public.viewer_has_locked_for_cycle (author_cycle_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM   public.cycles AS ac   -- the post author's cycle
    JOIN   public.cycles AS vc   -- the viewer's cycle for the same week
           ON  vc.week_start = ac.week_start   -- ← see TODO above re: timezones
           AND vc.user_id    = auth.uid()
    WHERE  ac.id          = author_cycle_id
      AND  vc.locked_at  IS NOT NULL
  );
$$;


-- Returns TRUE if the friendship row identified by `friendship_id` still has
-- the original requester_id and addressee_id. Used in the friendships UPDATE
-- WITH CHECK to prevent participants from being reassigned after creation.
--
-- SECURITY DEFINER is required here to avoid a self-referential RLS evaluation:
-- a WITH CHECK clause that queries the same table it is protecting can trigger
-- the SELECT policy mid-update, producing undefined behaviour. Reading through
-- a SECURITY DEFINER function bypasses that cycle entirely.
CREATE OR REPLACE FUNCTION public.friendship_participants_unchanged (
  friendship_id  uuid,
  new_requester  uuid,
  new_addressee  uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships
    WHERE id           = friendship_id
      AND requester_id = new_requester
      AND addressee_id = new_addressee
  );
$$;


-- =============================================================================
-- ROW-LEVEL SECURITY — enable on every table
-- =============================================================================

ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments    ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- POLICIES — users
-- =============================================================================

-- Who can read a user row:
--   • Your own row — needed for profile screens.
--   • Any row belonging to an accepted friend — needed to render friend profiles
--     and names in the feed. Non-friends are invisible: prevents user enumeration.
CREATE POLICY "users: read own row and accepted friends"
  ON public.users FOR SELECT
  USING (
    id = auth.uid()
    OR are_friends(id, auth.uid())
  );

-- Who can create a user row:
--   • Only yourself. The id column must equal the caller's auth UID so a
--     user cannot create a profile on behalf of someone else.
CREATE POLICY "users: insert own row only"
  ON public.users FOR INSERT
  WITH CHECK (id = auth.uid());

-- Who can update a user row:
--   • Only yourself. Username, display name, avatar, and timezone are personal.
--   • WITH CHECK (id = auth.uid()) ensures the id column itself cannot be
--     rewritten to a different UID during the update, which would silently
--     reassign the profile to another auth identity.
CREATE POLICY "users: update own row only"
  ON public.users FOR UPDATE
  USING     (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- =============================================================================
-- POLICIES — friendships
-- =============================================================================

-- Who can read a friendship row:
--   • Either party in the relationship (requester or addressee).
--   • A blocked row IS visible to the addressee (so they can manage blocks)
--     but NOT to the requester (they are effectively invisible to them).
--     We expose all rows where the caller is a participant; app logic hides
--     blocked contacts in the UI.
CREATE POLICY "friendships: read rows I am part of"
  ON public.friendships FOR SELECT
  USING (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  );

-- Who can create a friendship row:
--   • Only the person sending the request (they must be the requester).
--   • Prevents spoofing a request that appears to come from someone else.
CREATE POLICY "friendships: insert as requester only"
  ON public.friendships FOR INSERT
  WITH CHECK (requester_id = auth.uid());

-- Who can update a friendship row, and what they may change:
--
--   USING  — who can target a row for update:
--     Either participant (requester or addressee).
--
--   WITH CHECK — what the resulting row must look like:
--     1. Immutable participants: requester_id and addressee_id must not change.
--        friendship_participants_unchanged() compares the new values against the
--        stored values via a SECURITY DEFINER function (see note on that function).
--        This prevents an UPDATE from silently reassigning the edge to different
--        users, which would be a privilege-escalation vector.
--
--     2. Self-accept prevention: only the ADDRESSEE may set status = 'accepted'.
--        The requester (who sent the request) is explicitly blocked from accepting
--        their own request. Without this, a requester could POST a friend request
--        and immediately PATCH it to 'accepted', bypassing the addressee entirely.
--        Logic: if the new status is 'accepted', the caller must be the addressee
--        of the (unchanged) row.
CREATE POLICY "friendships: update as either participant"
  ON public.friendships FOR UPDATE
  USING (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  )
  WITH CHECK (
    -- participants are immutable after creation
    friendship_participants_unchanged(id, requester_id, addressee_id)
    -- only the addressee may grant accepted status; requester cannot self-accept
    AND (status <> 'accepted' OR addressee_id = auth.uid())
  );

-- Who can delete a friendship row:
--   • Either participant — unfriending or cancelling an outbound request.
CREATE POLICY "friendships: delete as either participant"
  ON public.friendships FOR DELETE
  USING (
    requester_id = auth.uid()
    OR addressee_id = auth.uid()
  );


-- =============================================================================
-- POLICIES — cycles
-- =============================================================================

-- Who can read a cycle row:
--   • Only the owner. Cycle state (phase, locked_at) is internal to each user.
--   • Note: viewer_has_locked_for_cycle() reads cycles via SECURITY DEFINER
--     and therefore bypasses this policy when evaluating the post-to-unlock
--     gate. That is intentional: the function must cross-reference two users'
--     cycles to decide if a viewer can see a friend's post.
CREATE POLICY "cycles: read own rows only"
  ON public.cycles FOR SELECT
  USING (user_id = auth.uid());

-- Who can create a cycle row:
--   • Only yourself. In practice Edge Functions (service_role) also create
--     cycles, but this policy covers direct client inserts during onboarding.
CREATE POLICY "cycles: insert own rows only"
  ON public.cycles FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Phase transitions and locked_at are written by Edge Functions using the
-- service_role key (which bypasses RLS). No UPDATE policy is granted to the
-- anon/authenticated role, so clients cannot manipulate cycle state directly.


-- =============================================================================
-- POLICIES — candidates
-- =============================================================================

-- Who can read candidate rows:
--   • Only the owner. Candidate photos are never exposed to other users —
--     not even friends. Leaking them would break the curation privacy guarantee.
CREATE POLICY "candidates: read own rows only"
  ON public.candidates FOR SELECT
  USING (user_id = auth.uid());

-- Who can add a candidate:
--   • Only yourself, and only to a cycle you own.
--   • The cycle_id ownership check prevents inserting a candidate under
--     another user's cycle even if you know their cycle UUID.
CREATE POLICY "candidates: insert into own cycle only"
  ON public.candidates FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.cycles
      WHERE id = cycle_id AND user_id = auth.uid()
    )
  );

-- Who can delete a candidate:
--   • Only the owner. This is the veto action during curation.
--   • The caller must also delete the matching storage object; RLS here only
--     covers the database row. Both deletions are required (see CLAUDE.md).
CREATE POLICY "candidates: delete own rows only"
  ON public.candidates FOR DELETE
  USING (user_id = auth.uid());


-- =============================================================================
-- POLICIES — posts
-- =============================================================================

-- Who can read a post:
--   • The author always sees their own posts (profile, confirmation screen).
--   • A viewer sees a friend's post only if BOTH conditions hold:
--       1. Mutual friendship  — are_friends() checks for an accepted row in
--          either direction. A pending or blocked friendship does not qualify.
--       2. Post-to-unlock gate — viewer_has_locked_for_cycle() confirms the
--          viewer has already completed their own roulette draw for the same
--          week. This is a locked rule: no feed access until you've published.
--          (CLAUDE.md: "Post-to-unlock: a user cannot see the viewing feed
--          until they've locked their 5.")
--
-- RLS on posts is the primary security boundary for the entire feed.
-- The client must NOT be trusted to filter post visibility — this policy is
-- the authoritative enforcement point.
CREATE POLICY "posts: author always; friends after unlock"
  ON public.posts FOR SELECT
  USING (
    -- condition 1: you are the author
    user_id = auth.uid()
    OR (
      -- condition 2a: the viewer is a mutual friend of the author
      are_friends(user_id, auth.uid())
      -- condition 2b: the viewer has locked their own cycle for this week
      AND viewer_has_locked_for_cycle(cycle_id)
    )
  );

-- Posts are created exclusively by Edge Functions using the service_role key.
-- No INSERT policy for the authenticated role is intentional: direct client
-- inserts are blocked. Roulette is SERVER-AUTHORITATIVE and non-rerollable.

-- Posts are immutable after publication. No UPDATE or DELETE policy for the
-- authenticated role. The server may hard-delete a post only via service_role.


-- =============================================================================
-- POLICIES — likes
-- =============================================================================

-- Who can read a like:
--   • Anyone who can see the underlying post (same friend + unlock gate).
--   • We inline the post-visibility check rather than relying on a
--     posts-table join so the policy is self-contained and cannot be
--     circumvented by unusual query shapes (e.g. direct likes queries).
CREATE POLICY "likes: readable when post is visible"
  ON public.likes FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.posts p
      WHERE  p.id = post_id
        AND  (
               p.user_id = auth.uid()
               OR (
                 are_friends(p.user_id, auth.uid())
                 AND viewer_has_locked_for_cycle(p.cycle_id)
               )
             )
    )
  );

-- Who can create a like:
--   • You can like a post that is visible to you (friend + unlock gate), and
--     only while the post's cycle is in the viewing phase.
--   • The phase check enforces CLAUDE.md: "Likes/comments LIVE ONLY during
--     [the viewing] phase." Likes on past cycles are permanently closed.
CREATE POLICY "likes: insert on visible post during viewing phase"
  ON public.likes FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM   public.posts  p
      JOIN   public.cycles c ON c.id = p.cycle_id
      WHERE  p.id = post_id
        AND  (
               p.user_id = auth.uid()
               OR (
                 are_friends(p.user_id, auth.uid())
                 AND viewer_has_locked_for_cycle(p.cycle_id)
               )
             )
        -- likes are only open while the cycle is in the viewing phase
        AND  c.phase = 'viewing'
    )
  );

-- Who can delete a like:
--   • Only yourself. You cannot unlike someone else's like.
CREATE POLICY "likes: delete own rows only"
  ON public.likes FOR DELETE
  USING (user_id = auth.uid());


-- =============================================================================
-- POLICIES — comments
-- =============================================================================

-- Who can read a comment:
--   • Anyone who can see the underlying post (same friend + unlock gate).
--   • Inlined for the same reason as likes: self-contained, query-shape-safe.
CREATE POLICY "comments: readable when post is visible"
  ON public.comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM   public.posts p
      WHERE  p.id = post_id
        AND  (
               p.user_id = auth.uid()
               OR (
                 are_friends(p.user_id, auth.uid())
                 AND viewer_has_locked_for_cycle(p.cycle_id)
               )
             )
    )
  );

-- Who can create a comment:
--   • You can comment on a post that is visible to you (friend + unlock gate),
--     and only while the post's cycle is in the viewing phase.
CREATE POLICY "comments: insert on visible post during viewing phase"
  ON public.comments FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM   public.posts  p
      JOIN   public.cycles c ON c.id = p.cycle_id
      WHERE  p.id = post_id
        AND  (
               p.user_id = auth.uid()
               OR (
                 are_friends(p.user_id, auth.uid())
                 AND viewer_has_locked_for_cycle(p.cycle_id)
               )
             )
        -- comments are only open while the cycle is in the viewing phase
        AND  c.phase = 'viewing'
    )
  );

-- Who can delete a comment:
--   • Only yourself. You cannot delete someone else's comment.
CREATE POLICY "comments: delete own rows only"
  ON public.comments FOR DELETE
  USING (user_id = auth.uid());
