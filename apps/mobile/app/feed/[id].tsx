import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CORROBORATION_THRESHOLD,
  REPORT_CATEGORY_KEYS,
  VerificationTier,
  Visibility,
  type FeedReport,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReport } from "../../src/feed";
import { updateMirrorRow } from "../../src/feed/localChainMirror";
import { useApp } from "../../src/state/AppContext";
import {
  Body,
  Button,
  Card,
  Caption,
  Divider,
  LoadingBlock,
  Mono,
  Notice,
  Screen,
  TierBadge,
  Title,
} from "../../src/ui";
import { colors, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

export default function FeedReportScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity } = useApp();

  const [report, setReport] = useState<FeedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const row = await getNetworkIndex().get(Number(id));
      setReport(row ? await resolveFeedReport(row) : null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <Screen>
        <LoadingBlock label={t("common.loading")} />
      </Screen>
    );
  }

  if (!report) {
    return (
      <Screen>
        <Notice tone="warn">{t("feed.unavailable")}</Notice>
        <Button label={t("feed.backToFeed")} onPress={() => router.push("/feed")} variant="secondary" />
      </Screen>
    );
  }

  const isOwn = identity?.address?.toLowerCase() === report.reporter.toLowerCase();

  async function corroborate() {
    if (!report) return;
    setBusy(true);
    try {
      const next = report.corroborations + 1;
      const promoted =
        next >= CORROBORATION_THRESHOLD && report.tier === VerificationTier.Unverified
          ? VerificationTier.CommunityCorroborated
          : report.tier;

      await updateMirrorRow(report.onChainReportId, { corroborations: next, tier: promoted });
      await load();
      setNote(t("feed.corroborateThanks"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.row}>
        <Title>{t(REPORT_CATEGORY_KEYS[report.category])}</Title>
        <TierBadge tier={report.tier} />
      </View>

      {report.demo ? <Notice tone="info">{t("feed.sampleNotice")}</Notice> : null}

      <Card>
        {report.locked ? (
          <Body dim>
            {report.visibility === Visibility.JournalistsOnly
              ? `🔒 ${t("feed.restrictedLong")}`
              : `🔒 ${t("feed.unavailable")}`}
          </Body>
        ) : (
          <Body>{report.body}</Body>
        )}
      </Card>

      <Card>
        <Caption>{t("feed.reporter")}</Caption>
        <Body>{report.reporterCodename}</Body>
        <Divider />
        <Caption>{t("feed.area")}</Caption>
        <Body>{report.coarseGeohash || "—"}</Body>
        <Divider />
        <Caption>{t("feed.submittedAt")}</Caption>
        <Body>{new Date(report.timestamp).toLocaleString()}</Body>
        {report.evidenceCount !== undefined ? (
          <>
            <Divider />
            <Caption>{t("compose.evidenceLabel")}</Caption>
            <Body>{report.evidenceCount}</Body>
          </>
        ) : null}
      </Card>

      <Card
        style={{
          borderColor: report.demo
            ? colors.border
            : report.integrityVerified
              ? colors.success
              : colors.danger,
        }}
      >
        <Caption>{t("feed.integrity")}</Caption>
        <Body>
          {report.demo
            ? t("feed.integritySample")
            : report.integrityVerified
              ? `✅ ${t("feed.integrityOk")}`
              : `⚠️ ${t("feed.integrityFail")}`}
        </Body>
        <Caption>{t("status.reportHash")}</Caption>
        <Mono>{report.reportHash}</Mono>
        <Caption>{t("feed.cid")}</Caption>
        <Mono>{report.cid}</Mono>
      </Card>

      <Card>
        <Body dim>
          {t("feed.corroborations", { count: report.corroborations })} ·{" "}
          {t("feed.threshold", { n: CORROBORATION_THRESHOLD })}
        </Body>
        <Body dim>{t("feed.corroborateHelp")}</Body>
        {note ? <Notice tone="success">{note}</Notice> : null}
        <Button
          label={t("feed.corroborate")}
          onPress={corroborate}
          loading={busy}
          disabled={isOwn || report.demo}
          variant="secondary"
        />
        {isOwn ? <Caption>{t("feed.cannotCorroborateOwn")}</Caption> : null}
      </Card>

      <Button label={t("feed.backToFeed")} onPress={() => router.push("/feed")} variant="ghost" />
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
});
