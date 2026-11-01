import React, { useCallback, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  clearEgressLog,
  egressLog,
  getRequireAnonymity,
  probeAnonymity,
  setRequireAnonymity,
  type EgressEntry,
} from "../src/net/transport";
import { loadBridgePaste, saveBridgePaste, serializeBridges } from "../src/net/bridges";
import {
  ensureTorRunning,
  shutdownTor,
  torAvailability,
  torStatus,
  type TorAvailability,
} from "../src/net/torTransport";
import type { TorStatus } from "expo-tor";
import { Badge, Body, Button, Card, Mono, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

/**
 * Shows what the app talks to, and lets the user refuse to talk unprotected.
 *
 * The egress list exists because "we never see your data" is a claim, and a
 * claim is worth less than a list the user can read. Someone deciding whether
 * it is safe to open this app on their network deserves the actual answer.
 */
export default function NetworkScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<EgressEntry[]>([]);
  const [required, setRequired] = useState(false);
  const [availability, setAvailability] = useState<TorAvailability>("unsupported");
  const [tor, setTor] = useState<TorStatus>({ state: "stopped", socksPort: 0 });
  const [busy, setBusy] = useState(false);
  const [torError, setTorError] = useState<string | null>(null);
  const [bridgePaste, setBridgePaste] = useState("");
  const [bridgeNote, setBridgeNote] = useState<string | null>(null);

  const probe = probeAnonymity();

  const load = useCallback(async () => {
    setEntries(await egressLog());
    setRequired(await getRequireAnonymity());
    setAvailability(torAvailability());
    setTor(torStatus());
    setBridgePaste(await loadBridgePaste());
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function toggleRequire() {
    await setRequireAnonymity(!required);
    await load();
  }

  async function toggleTor() {
    setBusy(true);
    setTorError(null);
    try {
      if (tor.state === "running") await shutdownTor();
      else {
        // Persist before starting, not merely parse. The `load()` below refills
        // this field from storage, so starting on unsaved text would blank the
        // box the user just pasted into while Tor ran on those bridges — and the
        // next start would then go to the public directory, which is the one
        // thing bridges exist to avoid on a censored network.
        const parsed = await saveBridgePaste(bridgePaste);
        if (parsed.errors.length) {
          setTorError(parsed.errors[0]);
          return;
        }
        await ensureTorRunning(serializeBridges(parsed.vanilla));
      }
    } catch (e) {
      setTorError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <Screen>
      <Title>{t("net.title")}</Title>

      <Card style={{ borderColor: probe.verified ? colors.success : colors.danger }}>
        <Body dim>{t("net.transport")}</Body>
        <Body>
          {probe.verified
            ? t("net.tor")
            : probe.claimed
              ? t("net.proxied")
              : t("net.direct")}
        </Body>
        <Mono>{probe.transport}</Mono>
        {/* Claimed-but-unverified is its own state and must read as weaker than
            verified. Collapsing the two is how someone over-trusts a proxy. */}
        {probe.claimed && !probe.verified ? <Body dim>{t("net.claimedNotVerified")}</Body> : null}
        {!probe.claimed ? <Body>{t("net.warning")}</Body> : null}
      </Card>

      <Card style={{ borderColor: tor.state === "running" ? colors.success : colors.border }}>
        <View style={styles.row}>
          <Body dim>{t("net.torTitle")}</Body>
          <Badge
            label={t(`net.torState.${tor.state}`)}
            tone={
              tor.state === "running" ? "success" : tor.state === "failed" ? "danger" : "dim"
            }
          />
        </View>

        {availability === "unsupported" ? (
          <Body>{t("net.torUnsupported")}</Body>
        ) : (
          <>
            <Body dim>{t("net.torExplainer")}</Body>
            {tor.state === "running" ? (
              <Body dim>{t("net.torPort", { port: tor.socksPort })}</Body>
            ) : null}
            {tor.state === "starting" || busy ? <Body dim>{t("net.torBootstrapping")}</Body> : null}
            {torError ?? tor.lastError ? (
              <Body>{torError ?? tor.lastError}</Body>
            ) : null}
            <Button
              label={tor.state === "running" ? t("net.torStop") : t("net.torStart")}
              onPress={toggleTor}
              loading={busy}
              variant={tor.state === "running" ? "secondary" : "primary"}
            />
          </>
        )}
      </Card>

      {availability === "available" ? (
        <Card>
          <Body dim>{t("net.bridgesTitle")}</Body>
          <Body dim>{t("net.bridgesExplainer")}</Body>
          <TextInput
            style={styles.bridges}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder={t("net.bridgesPlaceholder")}
            placeholderTextColor={colors.textDim}
            value={bridgePaste}
            onChangeText={(text) => {
              setBridgePaste(text);
              setBridgeNote(null);
            }}
          />
          {bridgeNote ? <Body dim>{bridgeNote}</Body> : null}
          <Button
            label={t("net.bridgesSave")}
            variant="secondary"
            onPress={async () => {
              const parsed = await saveBridgePaste(bridgePaste);
              if (parsed.errors.length) {
                setBridgeNote(parsed.errors[0]);
                return;
              }
              setBridgeNote(
                parsed.vanilla.length
                  ? t("net.bridgesSaved", { count: parsed.vanilla.length })
                  : t("net.bridgesCleared")
              );
              if (tor.state === "running") {
                setBridgeNote(t("net.bridgesRestart"));
              }
            }}
          />
        </Card>
      ) : null}

      <Card>
        <Body dim>{t("net.requireTitle")}</Body>
        <Body dim>{t("net.requireExplainer")}</Body>
        <Button
          label={required ? `✅ ${t("net.requireTitle")}` : t("net.requireTitle")}
          onPress={toggleRequire}
          variant={required ? "primary" : "secondary"}
        />
      </Card>

      <Card>
        <Body dim>{t("net.egressTitle")}</Body>
        {entries.length === 0 ? (
          <Body dim>{t("net.egressEmpty")}</Body>
        ) : (
          entries.map((e, i) => (
            <Body key={`${e.host}-${e.at}-${i}`} dim>
              {e.anonymised ? "🧅" : "🌐"} {e.host} · {e.purpose} ·{" "}
              {new Date(e.at).toLocaleTimeString()}
            </Body>
          ))
        )}
        <Body dim>{t("net.egressNote")}</Body>
        {entries.length > 0 ? (
          <Button
            label={t("net.egressClear")}
            onPress={async () => {
              await clearEgressLog();
              await load();
            }}
            variant="secondary"
          />
        ) : null}
      </Card>

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  bridges: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 96,
    textAlignVertical: "top",
    fontSize: 13,
    fontFamily: "monospace",
  },
});
