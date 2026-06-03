import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { createProfile, fetchProfile } from '@/lib/auth';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';
import { Spacing } from '@/constants/theme';

// 3–20 chars, letters / digits / underscore only.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// This screen serves two cases:
//
//  1. New signup (email confirmed or confirmation disabled): the user has a
//     live session but no public.users row. AuthGuard routes here when
//     profileStatus is 'missing'.
//
//  2. Orphaned-auth recovery: a previous signup created an auth user but the
//     profile INSERT failed (network error, etc.). On the next app open
//     AuthGuard sees session + no profile and routes here again.
//     On mount we re-check whether a profile was actually created (handles the
//     race where the INSERT succeeded but the store wasn't updated).
export default function ChooseUsernameScreen() {
  const theme = useTheme();
  const { session, setProfile } = useAuthStore();
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  // Re-check for an existing profile on mount. If one already exists (e.g.
  // the INSERT succeeded but onAuthStateChange fired before it committed),
  // update the store — AuthGuard will redirect to /(app)/home automatically.
  useEffect(() => {
    async function checkExisting() {
      if (!session?.user) { setChecking(false); return; }
      try {
        const existing = await fetchProfile(session.user.id);
        if (existing) {
          setProfile(existing);
          // AuthGuard takes over from here; no need to navigate manually.
          return;
        }
      } catch {
        // Network error — fall through and show the form; user can try submitting.
      }
      setChecking(false);
    }
    checkExisting();
  }, []);

  async function handleSubmit() {
    setError(null);
    const trimmed = username.trim();
    if (!USERNAME_RE.test(trimmed)) {
      setError('Username must be 3–20 characters: letters, digits, or underscore.');
      return;
    }
    if (!session?.user) { setError('No active session — please sign in again.'); return; }

    setLoading(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const result = await createProfile({ id: session.user.id, username: trimmed, timezone });
    if (result.error) {
      // The profile may already exist from a concurrent attempt whose INSERT
      // wasn't visible when this screen mounted (PK conflict shows as 23505,
      // same code as a username clash). Re-check before surfacing the error.
      try {
        const existing = await fetchProfile(session.user.id);
        if (existing) { setProfile(existing); return; }
      } catch {
        // Network error — fall through and show the original createProfile error.
      }
      setLoading(false);
      setError(result.error);
      return;
    }

    // Fetch the newly created row and push it into the store.
    // AuthGuard sees profileStatus:'loaded' and navigates to /(app)/home.
    const profile = await fetchProfile(session.user.id);
    if (profile) setProfile(profile);
    setLoading(false);
  }

  if (checking) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected },
  ];

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.content}>
          <ThemedText type="title" style={styles.title}>Choose a username</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Pick a handle to complete your account.
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <TextInput
            style={inputStyle}
            placeholder="Username (3–20 chars, a–z 0–9 _)"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username-new"
            textContentType="username"
            value={username}
            onChangeText={setUsername}
            onSubmitEditing={handleSubmit}
            returnKeyType="go"
            autoFocus
          />

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <ThemedText style={styles.buttonText}>Finish setup</ThemedText>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  inner: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.two },
  error: { color: '#E5383B', textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 4,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
