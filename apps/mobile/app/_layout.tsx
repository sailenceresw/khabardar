import React, { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as ScreenCapture from "expo-screen-capture";
import { LockGate } from "../src/LockGate";
import { AppProvider, useApp } from "../src/state/AppContext";
import { getStealthConfig } from "../src/stealth";
import { colors } from "../src/theme";
import { t } from "../src/i18n";

function RootStack() {
  // Re-render titles when locale changes.
  useApp();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: t("appName") }} />
      <Stack.Screen name="onboarding" options={{ title: t("onboarding.title"), headerBackVisible: false }} />
      <Stack.Screen name="compose/index" options={{ title: t("compose.title") }} />
      <Stack.Screen name="compose/review" options={{ title: t("review.title") }} />
      <Stack.Screen name="report/[id]" options={{ title: t("status.title") }} />
      <Stack.Screen name="settings" options={{ title: t("settings.title") }} />
      <Stack.Screen name="moderation" options={{ title: t("moderation.title") }} />
      <Stack.Screen name="tips" options={{ title: t("tips.title") }} />
      <Stack.Screen name="org" options={{ title: t("org.title") }} />
      <Stack.Screen name="feed/index" options={{ title: t("feed.title") }} />
      <Stack.Screen name="feed/[id]" options={{ title: t("feed.reportTitle") }} />
      <Stack.Screen name="recovery" options={{ title: t("recovery.title") }} />
      <Stack.Screen name="wallet" options={{ title: t("wallet.title") }} />
      <Stack.Screen name="stealth" options={{ title: t("stealth.title") }} />
      <Stack.Screen name="network" options={{ title: t("net.title") }} />
      <Stack.Screen name="analytics" options={{ title: t("analytics.title") }} />
      <Stack.Screen name="cases" options={{ title: t("cases.title") }} />
    </Stack>
  );
}

/**
 * Block screenshots and the app-switcher snapshot while the app is open.
 *
 * Both OSes capture the current screen for the task switcher, and that snapshot
 * lands in storage that survives the app being closed. A snapshot of an open
 * report is the report. Enabled by default and switchable off in Settings,
 * because on some devices it also blocks legitimate screen sharing.
 */
function ScreenCaptureGuard() {
  useEffect(() => {
    let active = true;

    (async () => {
      const { blockScreenCapture } = await getStealthConfig();
      if (!active) return;
      try {
        if (blockScreenCapture) await ScreenCapture.preventScreenCaptureAsync();
        else await ScreenCapture.allowScreenCaptureAsync();
      } catch {
        // Unsupported on web and on some Android builds. Not being able to
        // block capture is worth knowing about but must not stop the app.
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return null;
}

export default function Layout() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <ScreenCaptureGuard />
      <LockGate>
        <RootStack />
      </LockGate>
    </AppProvider>
  );
}
