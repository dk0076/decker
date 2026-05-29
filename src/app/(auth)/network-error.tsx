import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { fetchProfileWithRetry } from '@/lib/auth';
import { useTheme } from '@/hooks/use-theme';
import { useAuthStore } from '@/store/auth-store';
import { Spacing } from '@/constants/theme';

export default function NetworkErrorScreen() {
  const theme = useTheme();
  const { session, setProfile, setProfileStatus } = useAuthStore();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    if (!session?.user) return;
    setRetrying(true);
    setProfileStatus('loading');
    try {
      const profile = await fetchProfileWithRetry(session.user.id);
      setProfile(profile); // AuthGuard routes to home or complete-profile
    } catch {
      setProfileStatus('error'); // AuthGuard keeps us here; button re-enables
    } finally {
      setRetrying(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <ThemedText type="title" style={styles.title}>Couldn't connect</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.body}>
          We couldn't reach the server. Check your connection and try again.
        </ThemedText>
        <Pressable
          style={[styles.button, retrying && styles.buttonDisabled]}
          onPress={handleRetry}
          disabled={retrying}>
          {retrying
            ? <ActivityIndicator color="#fff" />
            : <ThemedText style={styles.buttonText}>Try again</ThemedText>}
      </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.four,
  },
  title: { textAlign: 'center' },
  body: { textAlign: 'center', lineHeight: 22 },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 4,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
