# Decker — project rules for Claude Code

## What this app is
A weekly-rhythm photo social app. The entire value proposition is SCARCITY and
ritual, not engagement maximization. Mechanics that reduce session time are
intentional. Never "improve" the app by adding engagement features that smear
activity across the week — that destroys the concept.

## The weekly cycle (runs in USER-LOCAL time, IANA tz stored per user)
- Wed–Sun: PHOTO phase. Candidate photos accumulate from the camera roll.
- Sun→Mon boundary: CURATE + ROULETTE. User sees ~30 candidates, deletes the
  incriminating ones, server randomly draws 5 from survivors and publishes them.
- Mon–Tue: VIEWING phase. Vertical feed of friends' posts. Likes/comments LIVE
  ONLY during this phase.

## Locked rules — DO NOT soften these without explicit confirmation from me
- Survivor floor: user MUST keep >= 12 candidates; exactly 5 are drawn.
- Curation is a VETO (remove bad photos), never a SELECTION.
- Roulette is SERVER-AUTHORITATIVE and NON-rerollable. The client cannot
  influence or repeat the draw.
- Fail-safe on inaction = publish NOTHING that week. Never auto-publish raw photos.
- Deleted candidates are HARD-deleted: DB row AND storage object purged.
- Post-to-unlock: a user cannot see the viewing feed until they've locked their 5.
- Friends-only visibility is enforced at the DATABASE level via RLS, never trusted
  to the client.
- Photos come from the camera roll, date-filtered to the current week.
- Location on a post is optional and strictly opt-in.

## Stack (do not substitute)
- Expo (managed) + React Native + TypeScript (strict mode)
- expo-router for navigation
- Supabase: auth, Postgres, storage, realtime (@supabase/supabase-js)
- Zustand for minimal client state
- Secrets read ONLY from EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
  via env. Never hardcode keys. The service_role/secret key is SERVER-SIDE ONLY
  (Edge Functions), never in the app bundle or .env.

## Security
- RLS bugs fail silently (queries return rows they shouldn't). Treat every RLS
  policy as security-critical and explain each one in a comment.

## Working style
- Build in small, reviewable steps. After each, summarize what changed and what I
  should verify before continuing.
- If an implementation choice conflicts with a locked rule above, STOP and ask
  rather than resolving it silently.
