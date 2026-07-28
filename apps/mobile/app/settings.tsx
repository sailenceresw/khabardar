import React, { useState } from "react";
import { Alert, Platform, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { panicDelete } from "../src/panic";
import { Body, Button, Card, Screen, Title } from "../src/ui";
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
      <Card>
        <Body dim>{t("settings.language")}</Body>
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

      <Card>
        <Body dim>{t("recovery.title")}</Body>
        <Button
          label={t("recovery.open")}
          variant="secondary"
          onPress={() => router.push("/recovery")}
        />
      </Card>

      <Card>
        <Body dim>{t("wallet.title")}</Body>
        <Button
          label={t("wallet.open")}
          variant="secondary"
          onPress={() => router.push("/wallet")}
        />
      </Card>

      <Card style={{ borderColor: colors.danger }}>
        <Title>{t("settings.panicTitle")}</Title>
        <Body dim>{t("settings.panicExplainer")}</Body>
        <Button label={t("settings.panicButton")} variant="danger" onPress={confirmWipe} loading={wiping} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
});
