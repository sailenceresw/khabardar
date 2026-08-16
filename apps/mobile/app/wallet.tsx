import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  beginConnect,
  disconnectWallet,
  getWalletSession,
  isWalletConnectConfigured,
  type WalletSession,
} from "../src/wallet";
import {
  Body,
  Button,
  Card,
  Caption,
  Mono,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function WalletScreen() {
  const router = useRouter();
  const [session, setSession] = useState<WalletSession | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const configured = isWalletConnectConfigured();

  useEffect(() => {
    getWalletSession().then(setSession);
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const handle = await beginConnect();
      setUri(handle.uri);
      const approved = await handle.approval();
      setSession(approved);
      setUri(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUri(null);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await disconnectWallet();
      setSession(null);
      setAcknowledged(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t("wallet.title")}</Title>
      <Body dim>{t("wallet.intro")}</Body>

      {/* Warning stays ABOVE any connect control — anonymity trade-off, not a convenience toggle. */}
      <Card style={{ borderColor: colors.danger, backgroundColor: colors.dangerMuted }}>
        <Title>{t("wallet.warningTitle")}</Title>
        <Body>{t("wallet.warningBody")}</Body>
        <Caption>{t("wallet.risk1")}</Caption>
        <Caption>{t("wallet.risk2")}</Caption>
        <Caption>{t("wallet.risk3")}</Caption>
        <Body dim>{t("wallet.recommendation")}</Body>
      </Card>

      <SectionHeader title={session ? t("wallet.connectedAs") : t("wallet.connect")} />

      {session ? (
        <Card style={{ borderColor: colors.accent }}>
          <Caption>{t("wallet.usingWallet")}</Caption>
          <Mono>{session.address}</Mono>
          {session.peerName ? <Body dim>{session.peerName}</Body> : null}
          <Body dim>{t("wallet.connectedNote")}</Body>
          <Button
            label={t("wallet.disconnect")}
            onPress={disconnect}
            loading={busy}
            variant="danger"
          />
        </Card>
      ) : !configured ? (
        <Notice tone="warn">{t("wallet.notConfigured")}</Notice>
      ) : (
        <Card>
          {!acknowledged ? (
            <Button
              label={t("wallet.acknowledge")}
              onPress={() => setAcknowledged(true)}
              variant="secondary"
            />
          ) : (
            <>
              <Button label={t("wallet.connect")} onPress={connect} loading={busy} />
              {uri ? (
                <>
                  <Caption>{t("wallet.scanUri")}</Caption>
                  <ScrollView horizontal style={styles.uriBox}>
                    <Text selectable style={styles.uriText}>
                      {uri}
                    </Text>
                  </ScrollView>
                </>
              ) : null}
            </>
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Card>
      )}

      <Notice tone="info">{t("wallet.defaultNote")}</Notice>

      <Button label={t("common.back")} onPress={() => router.back()} variant="ghost" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  uriBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    maxHeight: 64,
  },
  uriText: {
    color: colors.textDim,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
    fontSize: 11,
  },
});
