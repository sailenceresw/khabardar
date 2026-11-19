import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { planCards } from "../src/plans";
import { Body, Button, Caption, Card, Notice, Screen, Title } from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

/**
 * Plans for organisations. Static: there is no billing backend, and the page
 * says the prices are pilot pricing. Reporters never pay and never see this.
 */
export default function PlansScreen() {
  const router = useRouter();
  const cards = planCards();

  return (
    <Screen>
      <Notice tone="success">{t("plans.reportersFree")}</Notice>
      <Body dim>{t("plans.intro")}</Body>
      <Notice tone="warn">{t("plans.pilot")}</Notice>

      {cards.map((c) => (
        <Card key={c.plan}>
          <View style={styles.header}>
            <Title>{t(c.nameKey)}</Title>
            <Text style={styles.price}>
              {c.priceUsdMonth === 0 ? t("plans.free") : t("plans.perMonth", { price: c.priceUsdMonth.toLocaleString("en-US") })}
            </Text>
          </View>
          <Caption>{t(c.forKey)}</Caption>
          {c.features.map((f) => (
            <Body key={f.key}>• {t(f.key, f.options)}</Body>
          ))}
        </Card>
      ))}

      <Body dim>{t("plans.accreditation")}</Body>
      <Body dim>{t("plans.lapse")}</Body>
      <Button label={t("plans.openOrg")} variant="secondary" onPress={() => router.push("/org")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  price: { color: colors.accent, fontSize: 18, fontWeight: "700" },
});
