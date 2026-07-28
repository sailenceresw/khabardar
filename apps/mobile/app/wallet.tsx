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
import { Body, Button, Card, Mono, Screen, Title } from "../src/ui";
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
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>{t("wallet.title")}</Title>

      <Card>
        <Body dim>{t("wallet.intro")}</Body>
      </Card>

      {/* The warning is deliberately unmissable and sits ABOVE the connect
          control — connecting is a real anonymity trade-off, not a convenience
          toggle. */}
      <Card style={{ borderColor: colors.danger }}>
        <Title>{t("wallet.warningTitle")}</Title>
        <Body>{t("wallet.warningBody")}</Body>
        <View style={styles.bullets}>
          <Body>• {t("wallet.risk1")}</Body>
          <Body>• {t("wallet.risk2")}</Body>
          <Body>• {t("wallet.risk3")}</Body>
        </View>
        <Body dim>{t("wallet.recommendation")}</Body>
      </Card>

      {session ? (
        <Card>
          <Body dim>{t("wallet.connectedAs")}</Body>
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
        <Card>
          <Body dim>{t("wallet.notConfigured")}</Body>
        </Card>
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
                  <Body dim>{t("wallet.scanUri")}</Body>
                  <ScrollView horizontal style={styles.uriBox}>
                    <Text selectable style={styles.uriText}>
                      {uri}
                    </Text>
                  </ScrollView>
                </>
              ) : null}
            </>
          )}
          {error ? <Body>{error}</Body> : null}
        </Card>
      )}

      <Card>
        <Body dim>{t("wallet.defaultNote")}</Body>
      </Card>

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.xs, marginVertical: spacing.sm },
  uriBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
    maxHeight: 60,
  },
  uriText: { color: colors.textDim, fontFamily: Platform.OS === "web" ? "monospace" : undefined, fontSize: 11 },
});
