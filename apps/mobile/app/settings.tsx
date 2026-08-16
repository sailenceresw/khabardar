import React, { useState } from "react";
import { Alert, Platform, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { panicDelete } from "../src/panic";
import { Body, Button, Card, Notice, Screen, SectionHeader, Title } from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function SettingsScreen() {
  const router = useRouter();
  const { locale, switchLocale, refreshIdentity, refreshReports } = useApp();
  const [wiping, setWiping] = useState(false);

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
});
