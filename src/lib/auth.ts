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

// Returns { needsConfirmation: true } when Supabase requires email verification.
// Profile creation is always deferred to choose-username.tsx, where the user
// picks a username after the auth user exists (regardless of whether email
// confirmation is enabled or disabled).
export async function signUp(
  email: string,
  password: string,
): Promise<{ needsConfirmation?: boolean; error?: string }> {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message };
  if (!data.user) return { error: 'Signup failed — please try again.' };

  if (!data.session) {
    // Email confirmation required. onAuthStateChange fires after the user
    // taps the link; profile creation happens on choose-username.
    return { needsConfirmation: true };
  }

  // Session available immediately (email confirmation disabled in Supabase).
  // onAuthStateChange fires, fetches profile (null) → profileStatus:'missing'.
  // AuthGuard routes to choose-username where profile creation happens.
  return {};
}

export async function updateProfile(
  userId: string,
  fields: { display_name?: string | null; avatar_url?: string | null },
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('users')
    .update(fields)
    .eq('id', userId);
  if (error) return { error: error.message };
  return {};
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}
