import React, { useEffect, useLayoutEffect, useMemo } from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { useRouter, useFocusEffect, useNavigation } from "expo-router";
import { REPORT_CATEGORY_KEYS } from "@khabardar/shared";
import { useApp } from "../src/state/AppContext";
import { Badge, Body, Button, Card, EmptyState, Screen, SectionHeader, Title } from "../src/ui";
import { colors, spacing, radius } from "../src/theme";
import { t } from "../src/i18n";

export default function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { identity, identityLoaded, reports, refreshReports } = useApp();

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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => router.push("/settings")} hitSlop={12} style={{ paddingHorizontal: 12 }}>
          <Text style={{ color: colors.info, fontWeight: "600", fontSize: 15 }}>{t("common.settings")}</Text>
        </Pressable>
      ),
    });
  }, [navigation, router]);

  const localKarma = useMemo(
    () => reports.filter((r) => r.status === "anchored").length,
    [reports]
  );

  if (!identityLoaded || !identity) return <Screen scroll={false}><View /></Screen>;

  const statusTone = { draft: "dim", submitting: "info", anchored: "success", failed: "danger" } as const;

  return (
    <Screen>
      <Card style={styles.identityCard}>
        <Body dim>{t("home.codename")}</Body>
        <Title>{identity.codename}</Title>
        <View style={styles.karmaRow}>
          <View style={styles.karmaPill}>
            <Text style={styles.karmaLabel}>{t("home.karma")}</Text>
            <Text style={styles.karmaValue}>{localKarma}</Text>
          </View>
          <CaptionSoft>{t("home.karmaHint")}</CaptionSoft>
        </View>
      </Card>

      <Button label={t("home.newReport")} onPress={() => router.push("/compose")} />

      <View style={styles.quickGrid}>
        <QuickAction label={t("feed.open")} onPress={() => router.push("/feed")} />
        <QuickAction label={t("common.tips")} onPress={() => router.push("/tips")} />
        <QuickAction label={t("common.moderation")} onPress={() => router.push("/moderation")} />
        <QuickAction label={t("org.open")} onPress={() => router.push("/org")} />
      </View>

      <SectionHeader title={t("home.myReports")} />

      {reports.length === 0 ? (
        <EmptyState
          title={t("home.emptyTitle")}
          body={t("home.empty")}
          action={{ label: t("home.newReport"), onPress: () => router.push("/compose") }}
        />
      ) : (
        reports.map((r) => (
          <Pressable key={r.id} onPress={() => router.push(`/report/${r.id}`)}>
            <Card>
              <View style={styles.row}>
                <Body>{t(REPORT_CATEGORY_KEYS[r.category])}</Body>
                <Badge label={t(`status.${r.status}`)} tone={statusTone[r.status]} />
              </View>
              <Body dim>
                {r.body.length > 100 ? `${r.body.slice(0, 100)}…` : r.body}
              </Body>
              <Text style={styles.meta}>
                {new Date(r.createdAt).toLocaleDateString()} · {r.evidence.length} {t("compose.evidenceLabel").toLowerCase()}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

function QuickAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.quickBtn, pressed && { opacity: 0.75 }]}>
      <Text style={styles.quickLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function CaptionSoft({ children }: { children: React.ReactNode }) {
  return <Text style={styles.captionSoft}>{children}</Text>;
}

const styles = StyleSheet.create({
  identityCard: {
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted,
  },
  karmaRow: { gap: spacing.xs, marginTop: spacing.xs },
  karmaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  karmaLabel: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  karmaValue: { color: colors.accent, fontSize: 15, fontWeight: "700" },
  captionSoft: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quickBtn: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: 52,
    justifyContent: "center",
  },
  quickLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
