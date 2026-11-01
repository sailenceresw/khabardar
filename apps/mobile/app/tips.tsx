import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  checkPublishedKey,
  fingerprintOf,
  journalistKeysArePlaceholders,
  wellKnownUrl,
  type KeyCheck,
} from "../src/content/recipients";
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
  const [keyChecks, setKeyChecks] = useState<Record<string, KeyCheck>>({});

  const recipient = recipients.find((r) => r.id === recipientId);
  const check = recipient ? keyChecks[recipient.id] : undefined;

  // Corroborate the pinned key against the organisation's own domain. The
  // result never changes which key is used, only what the reporter is told
  // about it, so a slow or failed lookup degrades to "unverified" rather than
  // blocking the tip or silently trusting whatever came back.
  async function verifyKey() {
    if (!recipient) return;
    setKeyChecks((prev) => ({ ...prev, [recipient.id]: undefined as never }));
    const outcome = await checkPublishedKey(recipient);
    setKeyChecks((prev) => ({ ...prev, [recipient.id]: outcome }));
  }

  const load = useCallback(async () => {
    setSent(await listTips());
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function send() {
    if (!recipient || message.trim().length < 10) return;
    // A key that does not match what the organisation publishes is the one
    // case where sending is refused outright. Everything else is a warning.
    if (check?.state === "mismatch") return;

    setBusy(true);
    setResult(null);
    try {
      const tip = await sendTip(message.trim(), recipient);
      setResult(tip.simulated ? t("tips.sealedLocal") : t("tips.sealedStored"));
      setMessage("");
      await load();
    } catch (e) {
      setResult(e instanceof Error ? e.message : t("tips.sealedOnly"));
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

      {journalistKeysArePlaceholders() ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{t("tips.demoKeysWarning")}</Body>
        </Card>
      ) : null}

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

      {/* The fingerprint is shown whether or not it has been checked, because
          its real use is out of band: reading it back to the journalist over a
          channel this app does not control. The verification below only says
          whether the organisation's own domain agrees with it. */}
      {recipient ? (
        <Card
          style={
            check?.state === "mismatch" ? { borderColor: colors.danger } : undefined
          }
        >
          <Body dim>{t("tips.keyFingerprintLabel")}</Body>
          <Mono>{fingerprintOf(recipient.pubKey)}</Mono>
          <Body dim>{t("tips.keyFingerprintHint")}</Body>

          {check?.state === "match" ? (
            <Body>{t("tips.keyVerified", { domain: recipient.domain ?? "" })}</Body>
          ) : null}

          {check?.state === "mismatch" ? (
            <>
              <Title>{t("tips.keyMismatchTitle")}</Title>
              <Body>{t("tips.keyMismatchBody")}</Body>
              <Body dim>{t("tips.keyMismatchPublished")}</Body>
              <Mono>{check.publishedFingerprint}</Mono>
            </>
          ) : null}

          {check?.state === "unverified" ? (
            <Body dim>
              {recipient.domain
                ? t("tips.keyUnverified", { reason: check.reason })
                : t("tips.keyNoDomain")}
            </Body>
          ) : null}

          {recipient.domain ? (
            <>
              <Button
                label={t("tips.verifyKey")}
                variant="secondary"
                onPress={verifyKey}
              />
              <Body dim>{wellKnownUrl(recipient.domain)}</Body>
            </>
          ) : null}
        </Card>
      ) : null}

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
