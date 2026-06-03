-- =============================================================================
-- 20260529000001_create_avatars_bucket.sql
--
-- Creates the 'avatars' Supabase Storage bucket and its RLS policies.
--
-- READ-ACCESS DECISION — public vs. friends-only:
--   This migration sets public = true (open read for anyone with the URL).
--
--   Rationale for public read:
--     • Avatar URLs are surfaced to friends via the feed and profile screens.
--       Treating them as public simplifies delivery and CDN caching — the
--       Supabase Storage CDN can serve them without per-request auth checks.
--     • The URL path embeds the user's UUID ({uid}/avatar), which is not
--       guessable or enumerable; security-through-obscurity is not the goal,
--       but the attack surface for random discovery is minimal in practice.
--     • Post photos (the sensitive content) will live in a separate non-public
--       bucket, not here.
--     • Instagram, Twitter, and similar apps use public avatar URLs.
--
--   Tradeoff of friends-only read (if you prefer this):
--     + Stricter: a deleted account's avatar stops resolving immediately.
--     + A user who blocks a friend stops being visible to them in all surfaces.
--     − Every avatar image request would evaluate are_friends() via RLS,
--       adding DB load and latency on each image load; CDN caching cannot help.
--     − Much more complex storage policy; are_friends() is defined on
--       public.friendships, which storage.objects policies cannot join easily.
--
--   Review this choice before applying. If you want friends-only, say so and
--   I will rewrite the SELECT policy to gate on friendship status.
--
-- PATH CONVENTION:  avatars/{user_uid}/avatar[.ext]
--   The first path segment is ALWAYS the uploader's auth UID.  Every write
--   policy below enforces that  (storage.foldername(name))[1] = auth.uid()::text
--   so a user can never write to another user's folder.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

-- public = true enables unauthenticated GET requests (CDN-friendly public read).
-- Row-level policies below still govern INSERT / UPDATE / DELETE.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true);


-- ---------------------------------------------------------------------------
-- RLS policies on storage.objects
-- ---------------------------------------------------------------------------

-- SELECT — anyone (including unauthenticated users) may read avatar objects.
-- This is the public-read choice described above. The USING clause still
-- gates on bucket_id so this policy does not bleed into other buckets.
CREATE POLICY "avatars: public read"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- INSERT — authenticated user may upload to their own UID-prefixed folder only.
-- (storage.foldername(name))[1] returns the first path segment of the object
-- name. For 'abc-123/avatar.jpg' that is 'abc-123'.  Comparing it to
-- auth.uid()::text ensures no user can write into another user's folder.
-- Note: this policy is evaluated for the INITIAL upload.  A re-upload of the
-- same path uses UPDATE (see below) because the object already exists.
CREATE POLICY "avatars: insert own folder only"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE — authenticated user may overwrite (upsert) their own avatar.
-- Required because uploading with upsert:true on an existing path triggers
-- an UPDATE rather than an INSERT. Same UID-prefix check as INSERT.
CREATE POLICY "avatars: update own folder only"
ON storage.objects FOR UPDATE
TO authenticated
USING  (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE — authenticated user may remove their own avatar.
-- Used if we ever add a "remove avatar" feature.
CREATE POLICY "avatars: delete own folder only"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
