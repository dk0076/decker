// Must be the first import — patches the global URL constructor for React Native.
import 'react-native-url-polyfill/auto';

import type { RelativePathString } from 'expo-router';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { fetchProfileWithRetry } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

// Null-rendering component that owns two concerns:
//   1. Bootstrapping auth state (subscribe to Supabase, fetch profile).
//   2. Driving top-level route decisions whenever that state changes.
//
// Lives as a sibling to <Stack> so useRouter() and useSegments() are
// available inside the navigation context.
function AuthGuard() {
  const {
    session, profileStatus,
    isInitialized,
    setSession, setProfile, setProfileStatus, setInitialized, clearAuth,
  } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  // ── Step 1: subscribe to Supabase auth ─────────────────────────────────────
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          // clearAuth resets profileStatus → 'unknown' atomically with session/profile.
          clearAuth();
          setInitialized();
          return;
        }

        if (event === 'TOKEN_REFRESHED') {
          // Token refresh doesn't change user identity or profile data.
          setSession(session);
          setInitialized();
          return;
        }

        setSession(session);

        if (session?.user) {
          // Signal that a fetch is in flight BEFORE awaiting. This keeps
          // profileStatus in 'loading' so the guard never sees session+no-profile
          // and incorrectly routes to complete-profile mid-fetch.
          setProfileStatus('loading');
          try {
            const profile = await fetchProfileWithRetry(session.user.id);
            // setProfile atomically sets profile + profileStatus ('loaded'|'missing').
            setProfile(profile);
          } catch {
            // All retry attempts failed — surface the error so the user can
            // act rather than hanging on the splash indefinitely.
            setProfileStatus('error');
          }
        } else {
          setProfile(null);
        }

        // Mark initialized AFTER the profile fetch so the guard never acts on
        // stale data from a previous session.
        setInitialized();
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── Step 2: redirect whenever auth state settles ────────────────────────────
  useEffect(() => {
    if (!isInitialized) return;

    const segs = segments as string[];
    const inAuth = segs[0] === '(auth)';
    const onCompleteProfile = inAuth && segs[1] === 'complete-profile';
    const onNetworkError = inAuth && segs[1] === 'network-error';

    const r = (p: string) => router.replace(p as RelativePathString);

    if (!session) {
      // Not authenticated → force to sign-in.
      if (!inAuth) r('/(auth)/sign-in');
    } else if (profileStatus === 'missing') {
      // Session exists, profile definitively absent → finish setup.
      if (!onCompleteProfile) r('/(auth)/complete-profile');
    } else if (profileStatus === 'loaded') {
      // Fully authenticated → leave the auth stack.
      if (inAuth) r('/(app)/home');
    } else if (profileStatus === 'error') {
      // All retries failed — let the user see an error and retry manually.
      if (!onNetworkError) r('/(auth)/network-error');
    }
    // 'unknown' | 'loading': fetch still in flight — don't route; splash covers the wait.
  }, [isInitialized, session, profileStatus, segments]);

  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthGuard />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
      {/* Covers the initial route flash while auth initializes (600 ms animation). */}
      <AnimatedSplashOverlay />
    </ThemeProvider>
  );
}
