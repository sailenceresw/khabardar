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
import { Body, Button, Card, Mono, Screen, TierBadge, Title } from "../../src/ui";
import { colors, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

export default function FeedReportScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity } = useApp();

  const [report, setReport] = useState<FeedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    const row = await getNetworkIndex().get(Number(id));
    setReport(row ? await resolveFeedReport(row) : null);
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!report) {
    return (
      <Screen>
        <Body dim>{t("common.loading")}</Body>
      </Screen>
    );
  }

  const isOwn = identity?.address?.toLowerCase() === report.reporter.toLowerCase();

  /**
   * Corroboration in mock mode updates the local mirror. With a real relayer
   * this becomes a sponsored `corroborate(reportId)` call — the contract
   * enforces one-per-account and blocks self-corroboration.
   */
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

      {report.demo ? (
        <Card style={{ borderColor: colors.info }}>
          <Body dim>{t("feed.sampleNotice")}</Body>
        </Card>
      ) : null}

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
        <Body dim>{t("feed.reporter")}</Body>
        <Body>{report.reporterCodename}</Body>
        <Body dim>{t("feed.area")}</Body>
        <Body>{report.coarseGeohash || "—"}</Body>
        <Body dim>{t("feed.submittedAt")}</Body>
        <Body>{new Date(report.timestamp).toLocaleString()}</Body>
        {report.evidenceCount !== undefined ? (
          <>
            <Body dim>{t("compose.evidenceLabel")}</Body>
            <Body>{report.evidenceCount}</Body>
          </>
        ) : null}
      </Card>

      <Card>
        <Body dim>{t("feed.integrity")}</Body>
        <Body>
          {report.demo
            ? t("feed.integritySample")
            : report.integrityVerified
              ? `✅ ${t("feed.integrityOk")}`
              : `⚠️ ${t("feed.integrityFail")}`}
        </Body>
        <Body dim>{t("status.reportHash")}</Body>
        <Mono>{report.reportHash}</Mono>
        <Body dim>{t("feed.cid")}</Body>
        <Mono>{report.cid}</Mono>
      </Card>

      <Card>
        <Body dim>
          {t("feed.corroborations", { count: report.corroborations })} ·{" "}
          {t("feed.threshold", { n: CORROBORATION_THRESHOLD })}
        </Body>
        <Body dim>{t("feed.corroborateHelp")}</Body>
        {note ? <Body>{note}</Body> : null}
        <Button
          label={t("feed.corroborate")}
          onPress={corroborate}
          loading={busy}
          disabled={isOwn || report.demo}
          variant="secondary"
        />
        {isOwn ? <Body dim>{t("feed.cannotCorroborateOwn")}</Body> : null}
      </Card>

      <Button label={t("feed.backToFeed")} onPress={() => router.push("/feed")} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
});
