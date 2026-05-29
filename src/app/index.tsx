import { View } from 'react-native';

// Entry point for the "/" route. The AuthGuard in _layout.tsx replaces this
// immediately with the correct screen once auth initialises. The
// AnimatedSplashOverlay covers it during that brief window, so nothing
// visible renders here.
export default function Index() {
  return <View style={{ flex: 1 }} />;
}
