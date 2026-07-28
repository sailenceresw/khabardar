import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { listRecipients, listTips, sendTip, type TipRecord } from "../src/tips";
import { Body, Button, Card, Mono, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function TipsScreen() {
  const router = useRouter();
  const recipients = listRecipients();

  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState<TipRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSent(await listTips());
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function send() {
    const recipient = recipients.find((r) => r.id === recipientId);
    if (!recipient || message.trim().length < 10) return;

    setBusy(true);
    setResult(null);
    try {
      const tip = await sendTip(message.trim(), recipient);
      setResult(
        tip.status === "stored" ? t("tips.sealedStored") : t("tips.sealedOnly")
      );
      setMessage("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const valid = message.trim().length >= 10 && !!recipientId;

  return (
    <Screen>
      <Title>{t("tips.title")}</Title>

      <Card>
        <Body dim>{t("tips.intro")}</Body>
      </Card>

      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("tips.transportWarning")}</Body>
      </Card>

      <Card>
        <Body dim>{t("tips.recipientLabel")}</Body>
        <View style={styles.chips}>
          {recipients.map((r) => (
            <Pressable key={r.id} onPress={() => setRecipientId(r.id)}>
              <View style={[styles.chip, recipientId === r.id && styles.chipActive]}>
                <Text style={[styles.chipText, recipientId === r.id && styles.chipTextActive]}>
                  {r.name}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <Body dim>{t("tips.recipientKeyNote")}</Body>
      </Card>

      <Card>
        <Body dim>{t("tips.messageLabel")}</Body>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={6}
          placeholder={t("tips.messagePlaceholder")}
          placeholderTextColor={colors.textDim}
          value={message}
          onChangeText={setMessage}
        />
        {result ? <Body>{result}</Body> : null}
        <Button label={t("tips.send")} onPress={send} loading={busy} disabled={!valid} />
      </Card>

      {sent.length > 0 ? (
        <Card>
          <Body dim>{t("tips.sentTitle")}</Body>
          {sent.map((tip) => (
            <View key={tip.id} style={styles.tipRow}>
              <Body>
                {tip.recipientName} · {new Date(tip.createdAt).toLocaleString()}
              </Body>
              <Body dim>{tip.preview}…</Body>
              <Mono>{tip.digest}</Mono>
              <Body dim>{t(`tips.status.${tip.status}`)}</Body>
            </View>
          ))}
          <Body dim>{t("tips.sentNote")}</Body>
        </Card>
      ) : null}

      <Pressable onPress={() => router.push("/")}>
        <Text style={styles.link}>{t("feed.backHome")}</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13 },
  chipTextActive: { color: colors.accentText, fontWeight: "600" },
  textArea: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 15,
  },
  tipRow: { gap: 2, marginBottom: spacing.sm },
  link: { color: colors.info, fontSize: 15, fontWeight: "600", textAlign: "center" },
});
