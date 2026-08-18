import React, { useEffect } from "react";
import { ActivityIndicator, Pressable, Text, View, StyleSheet } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { REPORT_CATEGORY_KEYS } from "@khabardar/shared";
import { useApp } from "../src/state/AppContext";
import { readKarma } from "../src/karma";
import { probeAnonymity } from "../src/net/transport";
import { Badge, Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, spacing } from "../src/theme";
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
  const [net, setNet] = React.useState(() => probeAnonymity());

  useEffect(() => {
    // A storage failure means onboarding cannot write an identity either —
    // stay here and say so instead of bouncing into a flow that will fail.
    if (identityLoaded && !identity && !storageError) {
      router.replace("/onboarding");
    }
  }, [identityLoaded, identity, storageError, router]);

  // Deliberately not awaited by the render path: karma is a network read, and
  // a home screen that waits on the chain is a home screen that hangs when the
  // chain is unreachable. It fills in when it arrives, or stays unknown.
  useEffect(() => {
    if (!identity) return;
    let active = true;
    readKarma(identity.address as `0x${string}`).then((k) => {
      if (active) setKarma(k);
    });
    return () => {
      active = false;
    };
  }, [identity]);

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

  if (!identity) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Body dim>{t("common.loading")}</Body>
        </View>
      </Screen>
    );
  }

  const statusTone = { draft: "dim", submitting: "info", anchored: "success", failed: "danger" } as const;

  return (
    <Screen>
      <Card>
        <Body dim>{t("home.codename")}</Body>
        <Title>{identity.codename}</Title>
        <Body dim>
          {t("home.karma")}: {karma === null ? t("home.karmaUnknown") : String(karma)}
        </Body>
        {!net.verified ? (
          <Pressable onPress={() => router.push("/network")}>
            <Body dim>{t("home.networkUnprotected")}</Body>
          </Pressable>
        ) : null}
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
        <FooterLink label={t("common.tips")} onPress={() => router.push("/tips")} />
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
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  footerLinks: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginTop: spacing.lg,
  },
  link: { color: colors.info, fontSize: 15, fontWeight: "600" },
});
