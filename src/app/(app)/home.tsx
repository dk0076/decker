import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { signOut } from '@/lib/auth';
import { getCycle, type CycleInfo } from '@/lib/cycle';
import { ensureCycleRow, type CycleRow } from '@/lib/cycle/ensure-cycle-row';
import { useAuthStore } from '@/store/auth-store';
import { Spacing } from '@/constants/theme';

// ─── Countdown helpers ────────────────────────────────────────────────────────

function getRemainingDHMS(until: Date, now: Date) {
  const totalMs = until.getTime() - now.getTime();
  if (totalMs <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const totalSecs = Math.floor(totalMs / 1_000);
  return {
    days:    Math.floor(totalSecs / 86_400),
    hours:   Math.floor((totalSecs % 86_400) / 3_600),
    minutes: Math.floor((totalSecs % 3_600) / 60),
    seconds: totalSecs % 60,
  };
}

// Fixed-width container prevents layout shifts when digit count changes
// (e.g. "9" → "10"). fontVariant 'tabular-nums' gives each digit equal advance
// width within a supporting font, eliminating sub-pixel jitter between ticks.
function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <View style={unit.container}>
      <ThemedText style={unit.value}>
        {String(value).padStart(2, '0')}
      </ThemedText>
      <ThemedText style={unit.label} themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
}

const unit = StyleSheet.create({
  container: { alignItems: 'center', width: 64 },
  value:     { fontSize: 40, fontWeight: '200', fontVariant: ['tabular-nums'] },
  label:     { fontSize: 13, marginTop: 2 },
});

// ─── Sub-screens ──────────────────────────────────────────────────────────────

function LoadingScreen() {
  return (
    <ThemedView style={shared.center}>
      <ActivityIndicator size="large" />
    </ThemedView>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ThemedView style={shared.center}>
      <ThemedText themeColor="textSecondary" style={errStyles.msg}>
        {message}
      </ThemedText>
      <Pressable onPress={onRetry} style={errStyles.button}>
        <ThemedText>Try again</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function PlaceholderScreen({ label }: { label: string }) {
  return (
    <ThemedView style={shared.center}>
      <ThemedText themeColor="textSecondary">{label}</ThemedText>
      <Pressable style={phStyles.signOut} onPress={signOut}>
        <ThemedText themeColor="textSecondary">Sign out</ThemedText>
      </Pressable>
    </ThemedView>
  );
}

function PhotoPhaseScreen({
  username,
  cycleInfo,
  now,
  onEditProfile,
}: {
  username: string;
  cycleInfo: CycleInfo;
  now: Date;
  onEditProfile: () => void;
}) {
  const { days, hours, minutes, seconds } = getRemainingDHMS(cycleInfo.nextPhaseChangeAt, now);

  return (
    <ThemedView style={photoStyles.container}>
      <SafeAreaView style={photoStyles.safe}>

        {/* Top bar: edit button at trailing edge */}
        <View style={photoStyles.topBar}>
          <View style={photoStyles.topBarSpacer} />
          <Pressable onPress={onEditProfile} hitSlop={12}>
            <ThemedText style={photoStyles.editBtn} themeColor="textSecondary">
              Edit
            </ThemedText>
          </Pressable>
        </View>

        {/* Identity */}
        <View style={photoStyles.header}>
          <ThemedText themeColor="textSecondary" style={photoStyles.username}>
            @{username}
          </ThemedText>
          <ThemedText style={photoStyles.phaseBadge}>photo phase</ThemedText>
        </View>

        {/* Countdown — ticks every second via the 1 s interval in the root component */}
        <View style={photoStyles.countdownBlock}>
          <View style={photoStyles.countdown}>
            <CountdownUnit value={days}    label="d" />
            <CountdownUnit value={hours}   label="h" />
            <CountdownUnit value={minutes} label="m" />
            <CountdownUnit value={seconds} label="s" />
          </View>
          <ThemedText themeColor="textSecondary" style={photoStyles.countdownLabel}>
            until curate opens
          </ThemedText>
        </View>

        {/* Sign out */}
        <Pressable style={photoStyles.signOut} onPress={signOut}>
          <ThemedText themeColor="textSecondary">Sign out</ThemedText>
        </Pressable>

      </SafeAreaView>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const shared = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

const errStyles = StyleSheet.create({
  msg:    { textAlign: 'center', marginBottom: Spacing.three, paddingHorizontal: Spacing.four },
  button: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.four },
});

const phStyles = StyleSheet.create({
  signOut: { marginTop: Spacing.six, paddingVertical: Spacing.two },
});

const photoStyles = StyleSheet.create({
  container:      { flex: 1 },
  safe:           { flex: 1, paddingHorizontal: Spacing.four },
  topBar:         { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.two },
  topBarSpacer:   { flex: 1 },
  editBtn:        { fontSize: 16 },
  header:         { paddingTop: Spacing.three, alignItems: 'center', gap: Spacing.one },
  username:       { fontSize: 16 },
  phaseBadge:     { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.5 },
  countdownBlock: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  countdown:      { flexDirection: 'row', gap: Spacing.one },
  countdownLabel: { fontSize: 14 },
  signOut:        { alignSelf: 'center', paddingVertical: Spacing.three, marginBottom: Spacing.two },
});

// ─── Root component ───────────────────────────────────────────────────────────

type ScreenState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; cycleRow: CycleRow };

export default function HomeScreen() {
  const router  = useRouter();
  const session = useAuthStore(s => s.session);
  const profile = useAuthStore(s => s.profile);

  // Compute cycle synchronously at init. Profile is guaranteed non-null by
  // AuthGuard (profileStatus === 'loaded') before routing here.
  const [cycleInfo] = useState<CycleInfo | null>(
    () => profile ? getCycle(profile.timezone) : null,
  );

  const [screenState, setScreenState] = useState<ScreenState>({ status: 'loading' });

  // 1-second interval drives the countdown. Used only for cosmetic rendering;
  // phase decisions come from getCycle, not this clock.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Guard: ensure the upsert fires exactly once per mount, even under React
  // StrictMode's development double-invoke. Reset to false before a retry.
  const ensureCalledRef = useRef(false);

  function runEnsure() {
    if (!session?.user || !cycleInfo) return;
    setScreenState({ status: 'loading' });
    ensureCycleRow(session.user.id, cycleInfo).then(({ data, error }) => {
      if (error || !data) {
        setScreenState({ status: 'error', message: error ?? 'Could not load cycle.' });
      } else {
        setScreenState({ status: 'ready', cycleRow: data });
      }
    });
  }

  useEffect(() => {
    if (ensureCalledRef.current) return;
    ensureCalledRef.current = true;
    runEnsure();
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (screenState.status === 'loading') return <LoadingScreen />;

  if (screenState.status === 'error') {
    return (
      <ErrorScreen
        message={screenState.message}
        onRetry={() => {
          ensureCalledRef.current = false;
          runEnsure();
        }}
      />
    );
  }

  if (!cycleInfo || !profile) return <LoadingScreen />;

  if (cycleInfo.phase === 'photo') {
    return (
      <PhotoPhaseScreen
        username={profile.username}
        cycleInfo={cycleInfo}
        now={now}
        onEditProfile={() => router.push('/(app)/profile')}
      />
    );
  }

  if (cycleInfo.phase === 'curate') return <PlaceholderScreen label="curate coming soon" />;
  return <PlaceholderScreen label="viewing coming soon" />;
}
