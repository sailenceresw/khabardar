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
  const [karmaChecking, setKarmaChecking] = React.useState(false);
  const [karmaAsked, setKarmaAsked] = React.useState(false);
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
        {karma === null && !karmaChecking && !karmaAsked && !net.verified ? (
          <Pressable onPress={checkKarma} accessibilityRole="button">
            <Body dim>
              {t("home.karma")}: {t("home.karmaCheck")}
            </Body>
          </Pressable>
        ) : (
          <Body dim>
            {t("home.karma")}:{" "}
            {karma !== null
              ? String(karma)
              : karmaChecking
                ? t("common.loading")
                : t("home.karmaUnknown")}
          </Body>
        )}
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
