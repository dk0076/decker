import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { signOut } from '@/lib/auth';
import { useAuthStore } from '@/store/auth-store';
import { Spacing } from '@/constants/theme';

// Placeholder home screen. Replace with the actual viewing feed when the
// cycle engine, roulette, and feed are built.
export default function HomeScreen() {
  const profile = useAuthStore((s) => s.profile);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <ThemedText type="title">Decker</ThemedText>
          {profile && (
            <ThemedText themeColor="textSecondary">
              Signed in as @{profile.username}
            </ThemedText>
          )}
          <ThemedText themeColor="textSecondary" style={styles.placeholder}>
            Feed coming soon.
          </ThemedText>
        </View>
        <Pressable style={styles.signOutButton} onPress={signOut}>
          <ThemedText themeColor="textSecondary">Sign out</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: Spacing.four },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
  },
  placeholder: { marginTop: Spacing.three },
  signOutButton: {
    alignSelf: 'center',
    paddingVertical: Spacing.three,
  },
});
