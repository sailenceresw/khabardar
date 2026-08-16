import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { getRecoveryPhrase, restoreIdentity } from "../src/identity";
import { isValidRecoveryPhrase } from "../src/recovery";
import {
  Body,
  Button,
  Card,
  Caption,
  Field,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from "../src/ui";
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

  const words = phrase ? phrase.split(" ") : [];

  return (
    <Screen>
      <Title>{t("recovery.title")}</Title>
      <Body dim>{t("recovery.explainer")}</Body>

      <Notice tone="danger">{t("recovery.warning")}</Notice>

      <SectionHeader title={t("recovery.reveal")} />
      <Card>
        {phrase ? (
          <>
            <View style={styles.phraseBox}>
              {words.map((word, i) => (
                <View key={`${word}-${i}`} style={styles.wordChip}>
                  <Text style={styles.wordIndex}>{i + 1}</Text>
                  <Text style={styles.wordText}>{word}</Text>
                </View>
              ))}
            </View>
            <Button label={t("recovery.hide")} onPress={() => setPhrase(null)} variant="secondary" />
          </>
        ) : (
          <>
            <Body dim>{t("recovery.explainer")}</Body>
            <Button label={t("recovery.reveal")} onPress={reveal} variant="secondary" />
          </>
        )}
      </Card>

      <SectionHeader title={t("recovery.restoreTitle")} />
      <Card>
        <Body dim>{t("recovery.restoreExplainer")}</Body>
        <Field
          placeholder={t("recovery.restorePlaceholder")}
          value={input}
          onChangeText={(v) => {
            setInput(v);
            if (error) setError(null);
          }}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          error={error ?? undefined}
        />
        {note ? <Notice tone="success">{note}</Notice> : null}
        <Button label={t("recovery.restore")} onPress={restore} loading={busy} />
      </Card>

      <Button label={t("common.back")} onPress={() => router.back()} variant="ghost" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  phraseBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  wordChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minWidth: "30%",
    flexGrow: 1,
  },
  wordIndex: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  wordText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});
