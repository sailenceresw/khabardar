import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApp } from "../src/state/AppContext";
import { createIdentity, getRecoveryPhrase } from "../src/identity";
import { Body, Button, Card, Caption, Notice, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { identity, refreshIdentity } = useApp();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [wroteDown, setWroteDown] = useState(false);

  /**
   * Creating an identity writes to the keystore, and that write can fail — no
   * storage permission, a browser with `localStorage` blocked, a full disk.
   * Swallowing the error left the button simply stopping, which reads as the
   * app being broken and is the one screen a new user cannot get past.
   */
  async function handleCreate() {
    setCreating(true);
    setError(null);
    setPhraseError(null);
    try {
      await createIdentity();
      await refreshIdentity();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCreating(false);
      return;
    }

    // Reading the phrase is its own step, because by this point the identity is
    // saved. Sharing a `try` with the write above reported a failed read as
    // "Nothing was saved" — untrue — and reported it into the branch that the
    // now-present identity had just made unreachable. The user saw nothing at
    // all and walked past the only screen that shows them their 12 words.
    try {
      // Shown now, not later in Settings. A phrase the user never sees is
      // not a recovery phrase; it is a key they will lose with the phone.
      setPhrase(await getRecoveryPhrase());
      setWroteDown(false);
    } catch (e) {
      setPhraseError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  const goHome = () => router.replace("/");

  // The main action for whichever stage the user is at, pinned to the bottom
  // so it is always under the thumb and never scrolls away.
  const footer = !identity ? (
    <>
      <Button
        label={creating ? t("onboarding.creating") : t("onboarding.createIdentity")}
        onPress={handleCreate}
        loading={creating}
      />
      <Button
        label={t("onboarding.alreadyHavePhrase")}
        onPress={() => router.push("/recovery")}
        variant="ghost"
      />
    </>
  ) : phrase && !wroteDown ? (
    <Button label={t("onboarding.iWroteThemDown")} onPress={() => setWroteDown(true)} />
  ) : (
    <Button label={t("onboarding.continue")} onPress={goHome} />
  );

  return (
    <Screen footer={footer}>
      {identity ? (
        <View style={[styles.readyHead, { paddingTop: insets.top + spacing.md }]}>
          <View style={[styles.heroIcon, styles.heroIconReady]}>
            <Ionicons name="finger-print" size={36} color={colors.success} />
          </View>
          <Caption>{t("onboarding.yourCodename")}</Caption>
          <Title>{identity.codename}</Title>
        </View>
      ) : (
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={40} color={colors.accent} />
          </View>
          <Text style={styles.brand}>{t("appName")}</Text>
          <Text style={styles.heroTitle} accessibilityRole="header">
            {t("onboarding.title")}
          </Text>
          <Body dim>{t("tagline")}</Body>
        </View>
      )}

      {identity ? (
        phrase ? (
          <Card style={styles.readyCard}>
            <Body>{t("onboarding.writeTheseDown")}</Body>
            <View style={styles.phraseGrid}>
              {phrase.split(" ").map((word, i) => (
                <View key={`${word}-${i}`} style={styles.word}>
                  <Text style={styles.wordNum}>{i + 1}</Text>
                  <Text style={styles.wordText} selectable>
                    {word}
                  </Text>
                </View>
              ))}
            </View>
            <Notice tone="warn">{t("recovery.warning")}</Notice>
          </Card>
        ) : (
          <Card style={styles.readyCard}>
            {/* The identity exists either way, so this is not a failure the
                user can retry here. It is one they have to be told about,
                and pointed at the other place the words can be read. */}
            {phraseError ? (
              <>
                <Body>{t("onboarding.phraseUnavailable")}</Body>
                <Caption>{phraseError}</Caption>
              </>
            ) : (
              <Body dim>{t("onboarding.readyHint")}</Body>
            )}
          </Card>
        )
      ) : (
        <>
          <Card>
            <Step icon="key-outline" text={t("onboarding.step1")} />
            <Step icon="lock-closed-outline" text={t("onboarding.step2")} />
            <Step icon="eye-off-outline" text={t("onboarding.step3")} />
          </Card>

          <Caption>{t("onboarding.explainer")}</Caption>

          {error ? (
            <Card style={{ borderColor: colors.danger }}>
              <Body>{t("onboarding.createFailed")}</Body>
              <Caption>{error}</Caption>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Step({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepBadge}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={styles.stepText}>
        <Body>{text}</Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  heroIconReady: { backgroundColor: colors.successMuted, width: 72, height: 72, borderRadius: 36 },
  heroTitle: { color: colors.text, fontSize: 26, fontWeight: "800", textAlign: "center", lineHeight: 32 },
  brand: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  readyHead: { alignItems: "center", gap: spacing.xs, paddingBottom: spacing.sm },
  readyCard: { borderColor: colors.success },
  phraseGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  word: {
    width: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  wordNum: { color: colors.textMuted, fontSize: 12, fontWeight: "700", width: 18, textAlign: "right" },
  wordText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "center", paddingVertical: spacing.xs },
  stepText: { flex: 1 },
  stepBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
});
