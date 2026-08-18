import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { createIdentity, getRecoveryPhrase } from "../src/identity";
import { Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function OnboardingScreen() {
  const router = useRouter();
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

  return (
    <Screen>
      <Title>{t("onboarding.title")}</Title>
      <Card>
        <Body>{t("onboarding.explainer")}</Body>
      </Card>

      {identity ? (
        <Card>
          <Body dim>{t("onboarding.yourCodename")}</Body>
          <Title>{identity.codename}</Title>
          {phrase ? (
            <>
              <Body>{t("onboarding.writeTheseDown")}</Body>
              <View style={styles.phraseBox}>
                {phrase.split(" ").map((word, i) => (
                  <Body key={`${word}-${i}`}>
                    {i + 1}. {word}
                  </Body>
                ))}
              </View>
              <Body>{t("recovery.warning")}</Body>
              {wroteDown ? (
                <Button label={t("onboarding.continue")} onPress={() => router.replace("/")} />
              ) : (
                <Button
                  label={t("onboarding.iWroteThemDown")}
                  onPress={() => setWroteDown(true)}
                  variant="secondary"
                />
              )}
            </>
          ) : (
            <>
              {/* The identity exists either way, so this is not a failure the
                  user can retry here — it is one they have to be told about,
                  and pointed at the other place the words can be read. */}
              {phraseError ? (
                <>
                  <Body>{t("onboarding.phraseUnavailable")}</Body>
                  <Body dim>{phraseError}</Body>
                </>
              ) : null}
              <Button label={t("onboarding.continue")} onPress={() => router.replace("/")} />
            </>
          )}
        </Card>
      ) : (
        <>
          <Button
            label={creating ? t("onboarding.creating") : t("onboarding.createIdentity")}
            onPress={handleCreate}
            loading={creating}
          />
          <Button
            label={t("onboarding.alreadyHavePhrase")}
            onPress={() => router.push("/recovery")}
            variant="secondary"
          />
          {error ? (
            <Card style={{ borderColor: colors.danger }}>
              <Body>{t("onboarding.createFailed")}</Body>
              <Body dim>{error}</Body>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  phraseBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
});
