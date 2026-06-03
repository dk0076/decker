import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { signOut, updateProfile } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth-store';

const DISPLAY_NAME_MAX = 40;

// ─── Avatar upload ────────────────────────────────────────────────────────────

// Uploads a locally-picked image to the avatars bucket under the user's
// UID-namespaced path, then returns the resulting public URL.
// The image is compressed to quality 0.7 by expo-image-picker before this is
// called, so we don't resize here.
async function uploadAvatar(
  userId: string,
  asset: ImagePicker.ImagePickerAsset,
): Promise<{ url: string | null; error: string | null }> {
  const ext = (asset.uri.split('.').pop() ?? 'jpg').toLowerCase();
  const path = `${userId}/avatar.${ext}`;
  const mime = asset.mimeType ?? 'image/jpeg';

  let buffer: ArrayBuffer;
  try {
    const response = await fetch(asset.uri);
    buffer = await response.arrayBuffer();
  } catch {
    return { url: null, error: 'Could not read the selected image.' };
  }

  // upsert: true overwrites the existing avatar at the same path so the
  // URL is stable across re-uploads (the bucket path never changes per user).
  const { error: storageError } = await supabase.storage
    .from('avatars')
    .upload(path, buffer, { contentType: mime, upsert: true });

  if (storageError) return { url: null, error: storageError.message };

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);

  // Append a timestamp so the image URL changes on each upload, preventing
  // the OS image cache from serving the old avatar after an update.
  return { url: `${publicUrl}?t=${Date.now()}`, error: null };
}

// ─── Profile tab ─────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const theme = useTheme();
  const session = useAuthStore(s => s.session);
  const profile = useAuthStore(s => s.profile);
  const setProfile = useAuthStore(s => s.setProfile);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const userId = session?.user?.id;

  // ── Display name ────────────────────────────────────────────────────────────

  async function handleSaveDisplayName() {
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      setNameError('Display name cannot be empty.');
      return;
    }
    if (trimmed.length > DISPLAY_NAME_MAX) {
      setNameError(`Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`);
      return;
    }
    if (!userId || !profile) return;

    setNameError(null);
    setNameSaving(true);
    setNameSaved(false);

    const { error } = await updateProfile(userId, { display_name: trimmed });

    setNameSaving(false);
    if (error) {
      setNameError(error);
    } else {
      setProfile({ ...profile, display_name: trimmed });
      setNameSaved(true);
    }
  }

  // ── Avatar ──────────────────────────────────────────────────────────────────

  async function handlePickAvatar() {
    if (!userId || !profile) return;

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setAvatarError('Photo library access was denied. Enable it in Settings.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images',
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      exif: false,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    setAvatarError(null);
    setAvatarLoading(true);

    const { url, error: uploadError } = await uploadAvatar(userId, asset);

    if (uploadError || !url) {
      setAvatarError(uploadError ?? 'Upload failed. Please try again.');
      setAvatarLoading(false);
      return;
    }

    const { error: dbError } = await updateProfile(userId, { avatar_url: url });

    setAvatarLoading(false);
    if (dbError) {
      setAvatarError(dbError);
    } else {
      setProfile({ ...profile, avatar_url: url });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const inputStyle = [
    styles.input,
    { backgroundColor: theme.backgroundElement, color: theme.text, borderColor: theme.backgroundSelected },
  ];

  const currentAvatar = profile?.avatar_url ?? null;
  // Hero shows the in-progress display name so it acts as a live preview.
  const heroName = displayName.trim() || profile?.username ?? '';
  const initial = (profile?.display_name ?? profile?.username ?? '?')[0].toUpperCase();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.kvFill}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >

            {/* ── Identity hero ───────────────────────────────────────────── */}
            <View style={styles.hero}>
              <View style={styles.avatarWrap}>
                {currentAvatar ? (
                  <Image
                    source={{ uri: currentAvatar }}
                    style={styles.avatar}
                    contentFit="cover"
                    transition={200}
                  />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: theme.backgroundElement }]}>
                    <ThemedText style={styles.avatarInitial} themeColor="textSecondary">
                      {initial}
                    </ThemedText>
                  </View>
                )}
                {avatarLoading && (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
              </View>

              <Pressable
                onPress={handlePickAvatar}
                disabled={avatarLoading}
                style={[styles.changePhotoBtn, avatarLoading && styles.disabled]}
              >
                <ThemedText style={styles.changePhotoText}>
                  {avatarLoading ? 'Uploading…' : 'Change photo'}
                </ThemedText>
              </Pressable>

              {avatarError && (
                <ThemedText style={styles.errorText}>{avatarError}</ThemedText>
              )}

              <ThemedText style={styles.heroName}>{heroName}</ThemedText>
              <ThemedText style={styles.heroHandle} themeColor="textSecondary">
                @{profile?.username}
              </ThemedText>
            </View>

            {/* ── Edit display name ───────────────────────────────────────── */}
            <View style={styles.section}>
              <ThemedText style={styles.label} themeColor="textSecondary">
                Display name
              </ThemedText>
              <TextInput
                style={inputStyle}
                value={displayName}
                onChangeText={text => {
                  setDisplayName(text);
                  setNameSaved(false);
                  setNameError(null);
                }}
                placeholder="Your name (optional)"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="words"
                autoCorrect={false}
                maxLength={DISPLAY_NAME_MAX}
                returnKeyType="done"
                onSubmitEditing={handleSaveDisplayName}
              />
              <ThemedText style={styles.charCount} themeColor="textSecondary">
                {displayName.trim().length}/{DISPLAY_NAME_MAX}
              </ThemedText>
              {nameError && <ThemedText style={styles.errorText}>{nameError}</ThemedText>}
              {nameSaved && <ThemedText style={styles.savedText}>Saved.</ThemedText>}
              <Pressable
                onPress={handleSaveDisplayName}
                disabled={nameSaving}
                style={[styles.saveBtn, nameSaving && styles.disabled]}
              >
                {nameSaving
                  ? <ActivityIndicator color="#fff" />
                  : <ThemedText style={styles.saveBtnText}>Save</ThemedText>}
              </Pressable>
            </View>

            {/* ── Username (read-only) ────────────────────────────────────── */}
            <View style={styles.section}>
              <ThemedText style={styles.label} themeColor="textSecondary">
                Username
              </ThemedText>
              <ThemedText style={styles.usernameReadOnly}>@{profile?.username}</ThemedText>
              <ThemedText style={styles.usernameNote} themeColor="textSecondary">
                Usernames cannot be changed after signup.
              </ThemedText>
            </View>

            {/* ── Sign out ────────────────────────────────────────────────── */}
            <Pressable onPress={signOut} style={styles.signOutBtn}>
              <ThemedText style={styles.signOutText} themeColor="textSecondary">
                Sign out
              </ThemedText>
            </Pressable>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 96;

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe:      { flex: 1 },
  kvFill:    { flex: 1 },

  scroll: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },

  // Hero section
  hero: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  avatarWrap:        { position: 'relative', marginBottom: Spacing.one },
  avatar:            { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarInitial:     { fontSize: 36, fontWeight: '300' },
  avatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  changePhotoBtn:  { paddingVertical: Spacing.one },
  changePhotoText: { color: '#208AEF', fontSize: 15, fontWeight: '500' },
  disabled:        { opacity: 0.5 },
  heroName:        { fontSize: 22, fontWeight: '600', marginTop: Spacing.two },
  heroHandle:      { fontSize: 15 },

  // Edit sections
  section: { gap: Spacing.one },
  label:   { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8 },

  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    fontSize: 16,
  },
  charCount: { fontSize: 12, textAlign: 'right' },
  errorText: { color: '#E5383B', fontSize: 14 },
  savedText: { color: '#3CB371', fontSize: 14 },

  saveBtn: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 4,
    alignItems: 'center',
    marginTop: Spacing.one,
  },
  saveBtnText:     { color: '#fff', fontWeight: '600', fontSize: 16 },
  usernameReadOnly: { fontSize: 16 },
  usernameNote:     { fontSize: 13 },

  // Sign out
  signOutBtn: {
    borderWidth: 1,
    borderColor: 'rgba(128,128,128,0.3)',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two + 4,
    alignItems: 'center',
    marginTop: Spacing.two,
  },
  signOutText: { fontSize: 16 },
});
