import React, { useCallback, useEffect, useState } from "react";
import { Alert, Platform, View, StyleSheet, Switch } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { panicDelete } from "../src/panic";
import { Body, Button, Card, Caption, Notice, Screen, SectionHeader, Title } from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";
import {
  applySavedTransportPrefs,
  getAnonymityStatus,
  saveTransportPrefs,
  type AnonymityStatus,
  type TransportPrefs,
} from "../src/transport";

export default function SettingsScreen() {
  const router = useRouter();
  const { locale, switchLocale, refreshIdentity, refreshReports } = useApp();
  const [wiping, setWiping] = useState(false);
  const [prefs, setPrefs] = useState<TransportPrefs>({ mode: "clearnet", orbotActive: false });
  const [status, setStatus] = useState<AnonymityStatus | null>(null);
  const [saving, setSaving] = useState(false);

  const refreshStatus = useCallback(async () => {
    const loaded = await applySavedTransportPrefs();
    setPrefs(loaded);
    setStatus(getAnonymityStatus());
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  async function updatePrefs(next: TransportPrefs) {
    setSaving(true);
    try {
      await saveTransportPrefs(next);
      setPrefs(next);
      setStatus(getAnonymityStatus());
    } finally {
      setSaving(false);
    }
  }

  async function doWipe() {
    setWiping(true);
    try {
      await panicDelete();
      await refreshIdentity();
      await refreshReports();
      if (Platform.OS === "web") window.alert(t("settings.panicDone"));
      router.replace("/onboarding");
    } finally {
      setWiping(false);
    }
  }

  function confirmWipe() {
    if (Platform.OS === "web") {
      if (window.confirm(`${t("settings.panicConfirmTitle")} ${t("settings.panicConfirmBody")}`)) {
        doWipe();
      }
      return;
    }
    Alert.alert(t("settings.panicConfirmTitle"), t("settings.panicConfirmBody"), [
      { text: t("settings.panicConfirmNo"), style: "cancel" },
      { text: t("settings.panicConfirmYes"), style: "destructive", onPress: doWipe },
    ]);
  }

  const torEnabled = prefs.mode === "tor";

  return (
    <Screen>
      <SectionHeader title={t("settings.language")} />
      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Button
              label={t("settings.english")}
              variant={locale === "en" ? "primary" : "secondary"}
              onPress={() => switchLocale("en")}
            />
          </View>
          <View style={styles.flex}>
            <Button
              label={t("settings.hindi")}
              variant={locale === "hi" ? "primary" : "secondary"}
              onPress={() => switchLocale("hi")}
            />
          </View>
        </View>
      </Card>

      <SectionHeader title={t("settings.transportTitle")} />
      <Card>
        <Body dim>{t("settings.transportExplainer")}</Body>

        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Title>{t("settings.torMode")}</Title>
            <Caption>{t("settings.torModeHint")}</Caption>
          </View>
          <Switch
            value={torEnabled}
            disabled={saving}
            onValueChange={(v) =>
              updatePrefs({ mode: v ? "tor" : "clearnet", orbotActive: prefs.orbotActive })
            }
            trackColor={{ false: colors.border, true: colors.accent }}
          />
        </View>

        {torEnabled ? (
          <View style={styles.switchRow}>
            <View style={styles.flex}>
              <Title>{t("settings.orbotActive")}</Title>
              <Caption>{t("settings.orbotActiveHint")}</Caption>
            </View>
            <Switch
              value={prefs.orbotActive}
              disabled={saving}
              onValueChange={(v) => updatePrefs({ mode: "tor", orbotActive: v })}
              trackColor={{ false: colors.border, true: colors.accent }}
            />
          </View>
        ) : null}

        {status ? (
          status.protected ? (
            <Notice tone="success">{t("settings.transportProtected")}</Notice>
          ) : (
            <Notice tone="warn">{status.warning ?? t("settings.transportUnprotected")}</Notice>
          )
        ) : null}

        <Caption>{t("settings.orbotInstallHint")}</Caption>
      </Card>

      <SectionHeader title={t("recovery.title")} />
      <Card>
        <Body dim>{t("recovery.explainer")}</Body>
        <Button label={t("recovery.open")} variant="secondary" onPress={() => router.push("/recovery")} />
      </Card>

      <SectionHeader title={t("wallet.title")} />
      <Card>
        <Body dim>{t("wallet.defaultNote")}</Body>
        <Button label={t("wallet.open")} variant="secondary" onPress={() => router.push("/wallet")} />
      </Card>

      <SectionHeader title={t("settings.dangerZone")} />
      <Card style={{ borderColor: colors.danger }}>
        <Title>{t("settings.panicTitle")}</Title>
        <Body dim>{t("settings.panicExplainer")}</Body>
        <Notice tone="danger">{t("settings.panicConfirmBody")}</Notice>
        <Button label={t("settings.panicButton")} variant="danger" onPress={confirmWipe} loading={wiping} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
  },
});
