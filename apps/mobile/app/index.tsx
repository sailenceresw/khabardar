import React, { useEffect } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { REPORT_CATEGORY_KEYS } from "@khabardar/shared";
import { useApp } from "../src/state/AppContext";
import { Badge, Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function HomeScreen() {
  const router = useRouter();
  const { identity, identityLoaded, reports, queue, flushing, refreshReports, retryQueued } = useApp();

  useEffect(() => {
    if (identityLoaded && !identity) {
      router.replace("/onboarding");
    }
  }, [identityLoaded, identity, router]);

  useFocusEffect(
    React.useCallback(() => {
      refreshReports();
    }, [refreshReports])
  );

  if (!identityLoaded || !identity) return <Screen scroll={false}><View /></Screen>;

  const statusTone = { draft: "dim", submitting: "info", anchored: "success", failed: "danger" } as const;

  return (
    <Screen>
      <Card>
        <Body dim>{t("home.codename")}</Body>
        <Title>{identity.codename}</Title>
        <Body dim>
          {t("home.karma")}: 0
        </Body>
      </Card>

      <Button label={t("home.newReport")} onPress={() => router.push("/compose")} />
      <Button label={t("feed.open")} onPress={() => router.push("/feed")} variant="secondary" />

      {queue.length > 0 ? (
        <Card style={{ borderColor: colors.info }}>
          <Body dim>{t("queue.pending", { count: queue.length })}</Body>
          <Body dim>{t("queue.explainer")}</Body>
          <Button
            label={t("queue.retryNow")}
            onPress={retryQueued}
            loading={flushing}
            variant="secondary"
          />
        </Card>
      ) : null}

      {reports.length === 0 ? (
        <Card>
          <Body dim>{t("home.empty")}</Body>
        </Card>
      ) : (
        reports.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/report/${r.id}`)}>
            <Card>
              <View style={styles.row}>
                <Body>{t(REPORT_CATEGORY_KEYS[r.category])}</Body>
                <Badge label={t(`status.${r.status}`)} tone={statusTone[r.status]} />
              </View>
              <Body dim>
                {r.body.length > 80 ? `${r.body.slice(0, 80)}…` : r.body}
              </Body>
            </Card>
          </Pressable>
        ))
      )}

      <View style={styles.footerLinks}>
        <FooterLink label={t("common.settings")} onPress={() => router.push("/settings")} />
        <FooterLink label={t("common.moderation")} onPress={() => router.push("/moderation")} />
        <FooterLink label={t("common.tips")} onPress={() => router.push("/tips")} />
        <FooterLink label={t("org.open")} onPress={() => router.push("/org")} />
      </View>
    </Screen>
  );
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Text style={styles.link}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  footerLinks: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: spacing.lg,
  },
  link: { color: colors.info, fontSize: 15, fontWeight: "600" },
});
