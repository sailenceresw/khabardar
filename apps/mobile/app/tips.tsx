import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { listRecipients, listTips, sendTip, type TipRecord } from "../src/tips";
import {
  Body,
  Button,
  Card,
  Caption,
  Chip,
  EmptyState,
  Field,
  Mono,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function TipsScreen() {
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
      setResult(tip.status === "stored" ? t("tips.sealedStored") : t("tips.sealedOnly"));
      setMessage("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const msgLen = message.trim().length;
  const valid = msgLen >= 10 && !!recipientId;

  return (
    <Screen>
      <Title>{t("tips.title")}</Title>
      <Body dim>{t("tips.intro")}</Body>

      <Notice tone="warn">{t("tips.transportWarning")}</Notice>

      <Card>
        <Caption>{t("tips.recipientLabel")}</Caption>
        <View style={styles.chips}>
          {recipients.map((r) => (
            <Chip
              key={r.id}
              label={r.name}
              active={recipientId === r.id}
              onPress={() => setRecipientId(r.id)}
            />
          ))}
        </View>
        <Body dim>{t("tips.recipientKeyNote")}</Body>
      </Card>

      <Card>
        <Field
          label={t("tips.messageLabel")}
          placeholder={t("tips.messagePlaceholder")}
          value={message}
          onChangeText={setMessage}
          multiline
          numberOfLines={6}
        />
        <Caption>
          {msgLen < 10 ? t("compose.bodyMin", { min: 10 }) : `${msgLen} chars`}
        </Caption>
        {result ? <Notice tone="success">{result}</Notice> : null}
        <Button label={t("tips.send")} onPress={send} loading={busy} disabled={!valid} />
      </Card>

      <SectionHeader title={t("tips.sentTitle")} />
      {sent.length === 0 ? (
        <EmptyState title={t("tips.sentTitle")} body={t("tips.sentNote")} />
      ) : (
        <Card>
          {sent.map((tip) => (
            <View key={tip.id} style={styles.tipRow}>
              <Body>
                {tip.recipientName} · {new Date(tip.createdAt).toLocaleString()}
              </Body>
              <Body dim>{tip.preview}…</Body>
              <Mono>{tip.digest}</Mono>
              <Caption>{t(`tips.status.${tip.status}`)}</Caption>
            </View>
          ))}
          <Body dim>{t("tips.sentNote")}</Body>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tipRow: { gap: 4, marginBottom: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
});
