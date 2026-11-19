import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from "react-native";
import { Redirect, useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { REPORT_CATEGORY_KEYS } from "@khabardar/shared";
import { useApp } from "../src/state/AppContext";
import { readKarma } from "../src/karma";
import { probeAnonymity } from "../src/net/transport";
import { Badge, Body, Button, Caption, Card, Screen, SectionHeader, Title } from "../src/ui";
import { colors, spacing, radius } from "../src/theme";
import { t } from "../src/i18n";

export default function HomeScreen() {
  const router = useRouter();
  const {
    identity,
    identityLoaded,
    storageError,
    reports,
    queue,
    flushing,
    refreshIdentity,
    refreshReports,
    retryQueued,
  } = useApp();

  const [karma, setKarma] = React.useState<bigint | null>(null);
  const [karmaChecking, setKarmaChecking] = React.useState(false);
  const [karmaAsked, setKarmaAsked] = React.useState(false);
  const [net, setNet] = React.useState(() => probeAnonymity());

  // Deliberately not awaited by the render path: karma is a network read, and
  // a home screen that waits on the chain is a home screen that hangs when the
  // chain is unreachable. It fills in when it arrives, or stays unknown.
  //
  // Unprompted only behind a verified anonymising transport. Unlike the feed,
  // this read is keyed to the reporter's own address, so on a direct connection
  // it would hand the RPC provider an IP↔pseudonym link merely because someone
  // opened the app. That is the linkage the whole relayer path exists to avoid,
  // and it is not a thing to do on the user's behalf. Without Tor the read waits
  // for the deliberate tap below.
  useEffect(() => {
    if (!identity || !net.verified) return;
    let active = true;
    readKarma(identity.address as `0x${string}`).then((k) => {
      if (active) setKarma(k);
    });
    return () => {
      active = false;
    };
  }, [identity, net.verified]);

  // The same read, but asked for. `karmaAsked` stops a failed check from
  // re-offering the tap forever, which would read as the number being one tap
  // away when it is actually unreachable.
  async function checkKarma() {
    if (!identity || karmaChecking) return;
    setKarmaChecking(true);
    try {
      setKarma(await readKarma(identity.address as `0x${string}`));
    } finally {
      setKarmaAsked(true);
      setKarmaChecking(false);
    }
  }

  useFocusEffect(
    React.useCallback(() => {
      refreshReports();
      setNet(probeAnonymity());
    }, [refreshReports])
  );

  // Never render an empty screen here. This branch is hit both while storage is
  // being read and in the frame before the redirect to onboarding lands, and a
  // bare <View/> in either case is indistinguishable from the app being broken.
  if (!identityLoaded) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Body dim>{t("common.loading")}</Body>
        </View>
      </Screen>
    );
  }

  // Storage is unreadable, so onboarding cannot write an identity either —
  // saying so beats bouncing the user into a flow that will silently fail.
  if (storageError) {
    return (
      <Screen scroll={false}>
        <Card style={{ borderColor: colors.danger }}>
          <Title>{t("common.error")}</Title>
          <Body>{t("home.storageUnreadable")}</Body>
          <Body dim>{storageError}</Body>
          <Button label={t("common.retry")} onPress={refreshIdentity} />
        </Card>
      </Screen>
    );
  }

  // Declarative, not a router.replace() in an effect.
  //
  // The gates above this screen render in place of the navigator until they
  // clear, so on the first frame after they do there is no mounted navigator
  // to receive an imperative call. expo-router throws "Attempted to navigate
  // before mounting the Root Layout component", the ErrorBoundary catches it,
  // and every route in the app renders the error card instead. <Redirect>
  // waits for the navigator rather than assuming it.
  if (!identity) return <Redirect href="/onboarding" />;

  const statusTone = { draft: "dim", submitting: "info", anchored: "success", failed: "danger" } as const;

  return (
    <Screen>
      <Card style={styles.identityCard}>
        <View style={styles.identityRow}>
          <View style={styles.avatar}>
            <Ionicons name="finger-print" size={26} color={colors.accent} />
          </View>
          <View style={styles.identityText}>
            <Caption>{t("home.codename")}</Caption>
            <Text style={styles.codename} numberOfLines={1}>
              {identity.codename}
            </Text>
          </View>
        </View>

        <View style={styles.pillRow}>
          <Pressable
            onPress={() => router.push("/network")}
            style={[styles.pill, net.verified ? styles.pillSafe : styles.pillRisk]}
            accessibilityRole="button"
            accessibilityLabel={net.verified ? t("home.protected") : t("home.networkUnprotected")}
          >
            <Ionicons
              name={net.verified ? "shield-checkmark" : "warning"}
              size={14}
              color={net.verified ? colors.success : colors.danger}
            />
            <Text style={[styles.pillText, { color: net.verified ? colors.success : colors.danger }]}>
              {net.verified ? t("home.protected") : t("home.direct")}
            </Text>
          </Pressable>

          {karma === null && !karmaChecking && !karmaAsked && !net.verified ? (
            <Pressable onPress={checkKarma} style={styles.pill} accessibilityRole="button">
              <Text style={styles.pillText}>
                {t("home.karma")}: {t("home.karmaCheck")}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {t("home.karma")}:{" "}
                {karma !== null ? String(karma) : karmaChecking ? t("common.loading") : t("home.karmaUnknown")}
              </Text>
            </View>
          )}
        </View>

        {!net.verified ? <Caption>{t("home.networkUnprotected")}</Caption> : null}
      </Card>

      <Pressable
        onPress={() => router.push("/compose")}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={t("home.newReport")}
      >
        <View style={styles.ctaIcon}>
          <Ionicons name="create-outline" size={26} color={colors.accentText} />
        </View>
        <View style={styles.ctaText}>
          <Text style={styles.ctaTitle}>{t("home.newReport")}</Text>
          <Text style={styles.ctaHint}>{t("home.newReportHint")}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.accentText} />
      </Pressable>

      <SectionHeader title={t("home.more")} />
      <View style={styles.tileGrid}>
        <Tile icon="lock-closed-outline" label={t("common.tips")} onPress={() => router.push("/tips")} />
        <Tile icon="people-outline" label={t("common.moderation")} onPress={() => router.push("/moderation")} />
        <Tile icon="globe-outline" label={t("net.title")} onPress={() => router.push("/network")} />
        <Tile icon="eye-off-outline" label={t("stealth.title")} onPress={() => router.push("/stealth")} />
      </View>

      <SectionHeader title={t("home.myReports")} />

      {queue.length > 0 ? (
        <Card style={{ borderColor: colors.info }}>
          <Body dim>{t("queue.pending", { count: queue.length })}</Body>
          <Body dim>{t("queue.explainer")}</Body>
          <Button label={t("queue.retryNow")} onPress={retryQueued} loading={flushing} variant="secondary" />
        </Card>
      ) : null}

      {reports.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="document-text-outline" size={28} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{t("home.emptyTitle")}</Text>
          <Text style={styles.emptyBody}>{t("home.empty")}</Text>
        </Card>
      ) : (
        reports.map((r) => (
          <Pressable
            key={r.id}
            onPress={() => router.push(`/report/${r.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`${t(REPORT_CATEGORY_KEYS[r.category])}, ${t(`status.${r.status}`)}`}
          >
            <Card>
              <View style={styles.row}>
                <Body>{t(REPORT_CATEGORY_KEYS[r.category])}</Body>
                <Badge label={t(`status.${r.status}`)} tone={statusTone[r.status]} />
              </View>
              <Body dim>{r.body.length > 100 ? `${r.body.slice(0, 100)}…` : r.body}</Body>
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

type IconName = React.ComponentProps<typeof Ionicons>["name"];

function Tile({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={22} color={colors.accent} />
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  identityCard: { gap: spacing.md },
  identityRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  identityText: { flex: 1, gap: 2 },
  codename: { color: colors.text, fontSize: 20, fontWeight: "700" },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minHeight: 32,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillSafe: { backgroundColor: colors.successMuted, borderColor: colors.success },
  pillRisk: { backgroundColor: colors.dangerMuted, borderColor: colors.danger },
  pillText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 76,
  },
  ctaIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { flex: 1, gap: 2 },
  ctaTitle: { color: colors.accentText, fontSize: 18, fontWeight: "800" },
  ctaHint: { color: colors.accentText, fontSize: 13, opacity: 0.8 },
  tileGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    width: "48%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    minHeight: 56,
  },
  tileLabel: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1 },
  emptyCard: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  emptyBody: { color: colors.textDim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  meta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
