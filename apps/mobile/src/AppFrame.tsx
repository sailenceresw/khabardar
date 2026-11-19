import React from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { colors } from "./theme";

/** Widest the app column gets on a large screen: a large phone, not a web page. */
export const APP_MAX_WIDTH = 440;
/** Below this window width the frame steps aside and the app fills the screen. */
const FRAME_BREAKPOINT = 520;

/**
 * On a laptop or projector the web build used to stretch across the whole
 * window, which made a phone app look like a website. Here it sits in a
 * phone-width column in the middle of the screen instead. On a phone, and in
 * native builds, this renders its children unchanged.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web" || width < FRAME_BREAKPOINT) return <>{children}</>;

  return (
    <View style={styles.backdrop}>
      <View style={styles.device}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    backgroundColor: colors.backdrop,
  },
  device: {
    flex: 1,
    width: "100%",
    maxWidth: APP_MAX_WIDTH,
    backgroundColor: colors.bg,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    // React Native Web maps this to a CSS box-shadow.
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
});
