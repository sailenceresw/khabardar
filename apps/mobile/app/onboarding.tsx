import React, { useState } from "react";
import { View, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { createIdentity } from "../src/identity";
import { Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function OnboardingScreen() {
  const router = useRouter();
  const { identity, refreshIdentity } = useApp();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createIdentity();
      await refreshIdentity();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Text style={styles.brand}>{t("appName")}</Text>
        <Title>{t("onboarding.title")}</Title>
        <Body dim>{t("tagline")}</Body>
      </View>

      <Card>
        <Body>{t("onboarding.explainer")}</Body>
      </Card>

      <Card>
        <Step n={1} text={t("onboarding.step1")} />
        <Step n={2} text={t("onboarding.step2")} />
        <Step n={3} text={t("onboarding.step3")} />
      </Card>

      {identity ? (
        <Card style={styles.readyCard}>
          <Body dim>{t("onboarding.yourCodename")}</Body>
          <Title>{identity.codename}</Title>
          <Body dim>{t("onboarding.readyHint")}</Body>
          <Button label={t("onboarding.continue")} onPress={() => router.replace("/")} />
        </Card>
      ) : (
        <Button
          label={creating ? t("onboarding.creating") : t("onboarding.createIdentity")}
          onPress={handleCreate}
          loading={creating}
        />
      )}
    </Screen>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Text style={styles.stepNum}>{n}</Text>
      </View>
      <Body dim>{text}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm, marginBottom: spacing.xs },
  brand: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  readyCard: { borderColor: colors.success },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNum: { color: colors.accent, fontWeight: "700", fontSize: 13 },
});
