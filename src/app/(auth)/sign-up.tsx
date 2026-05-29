import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { signUp } from '@/lib/auth';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';
import { Spacing } from '@/constants/theme';

// 3–20 chars, letters / digits / underscore only.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function validateForm(
  email: string,
  password: string,
  username: string,
): string | null {
  if (!email.trim()) return 'Email is required.';
  if (!email.includes('@')) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!USERNAME_RE.test(username))
    return 'Username must be 3–20 characters: letters, digits, or underscore.';
  return null;
}

export default function SignUpScreen() {
  const theme = useTheme();
  const { setProfile } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleSignUp() {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUsername = username.trim();
    const validationError = validateForm(trimmedEmail, password, trimmedUsername);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const result = await signUp(trimmedEmail, password, trimmedUsername, timezone);
    setLoading(false);

    if (result.error) { setError(result.error); return; }

    if (result.needsConfirmation) {
      // Email confirmation is enabled in Supabase. After the user taps the
      // link in their inbox, the deep link returns them to the app and
      // AuthGuard routes them to complete-profile to finish setup.
      setConfirming(true);
      return;
    }

    // Push the profile into the store explicitly. onAuthStateChange fires a
    // fetchProfile concurrently with createProfile in signUp(), so it may
    // race and set profile=null before the INSERT commits. This write happens
    // after createProfile returns, so it always wins that race.
    if (result.profile) setProfile(result.profile);
    // AuthGuard sees profile !== null and navigates to /(app)/home.
  }

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected },
  ];

  if (confirming) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.confirmContainer}>
          <ThemedText type="title" style={styles.title}>Check your email</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.confirmText}>
            We sent a confirmation link to{'\n'}
            <ThemedText style={{ fontWeight: '600' }}>{email.trim()}</ThemedText>
            {'\n\n'}Tap the link to activate your account, then return here to finish setting up your profile.
          </ThemedText>
          <Link href="/(auth)/sign-in" replace>
            <ThemedText type="link" style={styles.backLink}>Back to sign in</ThemedText>
          </Link>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled">

          <ThemedText type="title" style={styles.title}>Create account</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            Join Decker
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <View style={styles.fields}>
            <TextInput
              style={inputStyle}
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={inputStyle}
              placeholder="Password (min. 8 characters)"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              value={password}
              onChangeText={setPassword}
            />
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
              onSubmitEditing={handleSignUp}
              returnKeyType="go"
            />
          </View>

          <Pressable
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSignUp}
            disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <ThemedText style={styles.buttonText}>Create account</ThemedText>}
          </Pressable>

          <View style={styles.footer}>
            <ThemedText themeColor="textSecondary">Already have an account? </ThemedText>
            <Link href="/(auth)/sign-in">
              <ThemedText type="link">Sign in</ThemedText>
            </Link>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
    gap: Spacing.three,
  },
  title: { textAlign: 'center' },
  subtitle: { textAlign: 'center', marginBottom: Spacing.two },
  error: { color: '#E5383B', textAlign: 'center' },
  fields: { gap: Spacing.two },
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: Spacing.two,
  },
  confirmContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  confirmText: { textAlign: 'center', lineHeight: 24 },
  backLink: { marginTop: Spacing.two },
});
