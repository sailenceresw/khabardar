import React from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProvider, useApp } from "../src/state/AppContext";
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
      <Stack.Screen name="feed/index" options={{ title: t("feed.title") }} />
      <Stack.Screen name="feed/[id]" options={{ title: t("feed.reportTitle") }} />
      <Stack.Screen name="recovery" options={{ title: t("recovery.title") }} />
      <Stack.Screen name="wallet" options={{ title: t("wallet.title") }} />
    </Stack>
  );
}

export default function Layout() {
  return (
    <AppProvider>
      <StatusBar style="light" />
      <RootStack />
    </AppProvider>
  );
}
