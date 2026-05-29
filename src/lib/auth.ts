import type { Profile } from '@/store/auth-store';

import { supabase } from './supabase';

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, display_name, avatar_url, timezone')
    .eq('id', userId)
    .single();

  if (error) {
    // PGRST116 = "no rows found" — the expected result when the profile hasn't
    // been created yet. Any other code is a network, RLS, or server error;
    // throw so the caller can stay in 'loading' rather than flip to 'missing'.
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return data as Profile;
}

export async function createProfile(params: {
  id: string;
  username: string;
  timezone: string;
}): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('users')
    .insert({ id: params.id, username: params.username, timezone: params.timezone });

  if (error) {
    // Postgres unique-violation code — username column has a UNIQUE constraint.
    if (error.code === '23505') return { error: 'That username is already taken.' };
    return { error: error.message };
  }
  return {};
}

// Retries fetchProfile up to maxAttempts times with linear backoff.
// Delays: attempt 1 → immediate, attempt 2 → baseDelayMs, attempt 3 → 2×baseDelayMs.
// Throws the last error if all attempts fail, so callers can set 'error' status.
export async function fetchProfileWithRetry(
  userId: string,
  maxAttempts = 3,
  baseDelayMs = 1000,
): Promise<Profile | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      await new Promise<void>(r => setTimeout(r, baseDelayMs * attempt));
    }
    try {
      return await fetchProfile(userId);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return {};
}

// Returns { needsConfirmation: true } when Supabase requires email verification
// (the default). The profile is NOT created here in that case — it is deferred
// to complete-profile.tsx which runs after the user taps the confirmation link
// and a live session is available.
//
// When email confirmation is disabled (Auth → Email → "Confirm email" off in the
// Supabase dashboard), session is returned immediately and the profile is created
// inline here.
export async function signUp(
  email: string,
  password: string,
  username: string,
  timezone: string,
): Promise<{ needsConfirmation?: boolean; profile?: Profile; error?: string }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (!data.user) return { error: 'Signup failed — please try again.' };

  if (!data.session) {
    // Email confirmation required; profile creation happens in complete-profile.
    return { needsConfirmation: true };
  }

  const profileResult = await createProfile({
    id: data.user.id,
    username,
    timezone,
  });
  if (profileResult.error) return { error: profileResult.error };

  return {
    profile: { id: data.user.id, username, timezone, display_name: null, avatar_url: null },
  };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
