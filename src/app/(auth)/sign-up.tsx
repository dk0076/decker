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
import { Spacing } from '@/constants/theme';

function validateForm(email: string, password: string): string | null {
  if (!email.trim()) return 'Email is required.';
  if (!email.includes('@')) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  return null;
}

export default function SignUpScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleSignUp() {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    const validationError = validateForm(trimmedEmail, password);
    if (validationError) { setError(validationError); return; }

    setLoading(true);
    const result = await signUp(trimmedEmail, password);
    setLoading(false);

    if (result.error) { setError(result.error); return; }

    if (result.needsConfirmation) {
      // Email confirmation is enabled in Supabase. After the user taps the
      // link in their inbox, the deep link returns them to the app and
      // onAuthStateChange fires → profileStatus:'missing' → AuthGuard routes
      // to choose-username.
      setConfirming(true);
      return;
    }

    // Session was returned immediately (email confirmation disabled).
    // onAuthStateChange fires and sets profileStatus:'missing'.
    // AuthGuard routes to choose-username automatically — nothing to do here.
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
            {'\n\n'}Tap the link to activate your account, then return here to choose a username.
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
