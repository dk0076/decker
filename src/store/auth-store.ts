import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
};

// 'unknown'  — initial state; no fetch has started yet. Guard does not route.
// 'loading'  — fetch is in flight. Guard does not route.
// 'missing'  — fetch returned no row (definitive). Guard routes to choose-username.
// 'loaded'   — fetch returned a row. Guard routes to home.
// 'error'    — all retry attempts failed. Guard routes to network-error screen.
//
// Errors resolve to 'error' after retries, never to 'missing', so a transient
// network failure cannot incorrectly send the user to choose-username.
export type ProfileStatus = 'unknown' | 'loading' | 'missing' | 'loaded' | 'error';

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  profileStatus: ProfileStatus;
  isInitialized: boolean;
  setSession: (session: Session | null) => void;
  // Atomically updates profile + profileStatus in one set() call:
  //   non-null profile → profileStatus:'loaded'
  //   null             → profileStatus:'missing'
  setProfile: (profile: Profile | null) => void;
  setProfileStatus: (status: ProfileStatus) => void;
  setInitialized: () => void;
  // Atomically clears session + profile + resets profileStatus to 'unknown'.
  clearAuth: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  profile: null,
  profileStatus: 'unknown',
  isInitialized: false,
  setSession: (session) => set({ session }),
  setProfile: (profile) =>
    set(profile ? { profile, profileStatus: 'loaded' } : { profile: null, profileStatus: 'missing' }),
  setProfileStatus: (profileStatus) => set({ profileStatus }),
  setInitialized: () => set({ isInitialized: true }),
  clearAuth: () => set({ session: null, profile: null, profileStatus: 'unknown' }),
}));
