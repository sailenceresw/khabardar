import React, { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { getRecoveryPhrase, restoreIdentity } from "../src/identity";
import { isValidRecoveryPhrase } from "../src/recovery";
import { Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function RecoveryScreen() {
  const router = useRouter();
  const { refreshIdentity, refreshReports } = useApp();

  const [phrase, setPhrase] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setPhrase(await getRecoveryPhrase());
  }

  async function restore() {
    setError(null);
    setNote(null);

    if (!isValidRecoveryPhrase(input)) {
      setError(t("recovery.invalid"));
      return;
    }

    setBusy(true);
    try {
      await restoreIdentity(input);
      await refreshIdentity();
      await refreshReports();
      setNote(t("recovery.restored"));
      setInput("");
      router.replace("/");
    } catch {
      setError(t("recovery.invalid"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t("recovery.title")}</Title>

      <Card>
        <Body>{t("recovery.explainer")}</Body>
      </Card>

      <Card style={{ borderColor: colors.danger }}>
        <Body>{t("recovery.warning")}</Body>
      </Card>

      <Card>
        {phrase ? (
          <>
            <View style={styles.phraseBox}>
              {phrase.split(" ").map((word, i) => (
                <Body key={`${word}-${i}`}>
                  {i + 1}. {word}
                </Body>
              ))}
            </View>
            <Button label={t("recovery.hide")} onPress={() => setPhrase(null)} variant="secondary" />
          </>
        ) : (
          <Button label={t("recovery.reveal")} onPress={reveal} variant="secondary" />
        )}
      </Card>

      <Card>
        <Title>{t("recovery.restoreTitle")}</Title>
        <Body dim>{t("recovery.restoreExplainer")}</Body>
        <TextInput
          style={styles.input}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={t("recovery.restorePlaceholder")}
          placeholderTextColor={colors.textDim}
          value={input}
          onChangeText={setInput}
        />
        {error ? <Body>{error}</Body> : null}
        {note ? <Body>{note}</Body> : null}
        <Button label={t("recovery.restore")} onPress={restore} loading={busy} />
      </Card>

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
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
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    fontSize: 15,
  },
});
