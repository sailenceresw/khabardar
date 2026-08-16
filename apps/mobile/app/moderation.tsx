import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import {
  REPORT_CATEGORY_KEYS,
  TIER_SLUGS,
  VerificationTier,
  Visibility,
  type FeedReport,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReports } from "../src/feed";
import {
  applyModerationDecision,
  getDecisionLog,
  isModerator,
  setModeratorMode,
  type ModerationDecision,
} from "../src/moderation";
import {
  Body,
  Button,
  Card,
  Caption,
  EmptyState,
  Field,
  LoadingBlock,
  Notice,
  Screen,
  SectionHeader,
  TierBadge,
  Title,
} from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

const QUEUE_TIERS = [
  VerificationTier.Unverified,
  VerificationTier.UnderReview,
  VerificationTier.CommunityCorroborated,
];

export default function ModerationScreen() {
  const [moderator, setModerator] = useState(false);
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [log, setLog] = useState<ModerationDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mod, rows, decisions] = await Promise.all([
        isModerator(),
        getNetworkIndex().list(),
        getDecisionLog(),
      ]);
      setModerator(mod);
      setLog(decisions);

      const resolved = await resolveFeedReports(rows);
      setReports(
        resolved
          .filter((r) => QUEUE_TIERS.includes(r.tier) && !r.demo)
          .sort((a, b) => a.timestamp - b.timestamp)
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function decide(report: FeedReport, toTier: VerificationTier) {
    const reason = (reasons[report.onChainReportId] ?? "").trim();
    setBusyId(report.onChainReportId);
    try {
      await applyModerationDecision(report.onChainReportId, report.tier, toTier, reason);
      setReasons((p) => ({ ...p, [report.onChainReportId]: "" }));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleModerator() {
    await setModeratorMode(!moderator);
    await load();
  }

  return (
    <Screen>
      <Title>{t("moderation.title")}</Title>
      <Body dim>{t("moderation.intro")}</Body>

      <Notice tone="info">{t("moderation.devModeNote")}</Notice>
      <Button
        label={moderator ? t("moderation.leaveModeratorMode") : t("moderation.enterModeratorMode")}
        onPress={toggleModerator}
        variant={moderator ? "danger" : "secondary"}
      />

      {loading ? (
        <LoadingBlock label={t("common.loading")} />
      ) : reports.length === 0 ? (
        <EmptyState title={t("moderation.queueEmpty")} />
      ) : (
        <>
          <SectionHeader title={t("moderation.queueCount", { count: reports.length })} />
          {reports.map((r) => (
            <Card key={r.onChainReportId}>
              <View style={styles.row}>
                <Body>{t(REPORT_CATEGORY_KEYS[r.category])}</Body>
                <TierBadge tier={r.tier} />
              </View>

              {r.locked ? (
                <Body dim>
                  {r.visibility === Visibility.JournalistsOnly
                    ? `🔒 ${t("feed.restricted")}`
                    : `🔒 ${t("feed.unavailable")}`}
                </Body>
              ) : (
                <Body>{r.body}</Body>
              )}

              <Caption>
                {r.reporterCodename} · {r.coarseGeohash || "—"} ·{" "}
                {t("feed.corroborations", { count: r.corroborations })}
              </Caption>

              <Caption>
                {r.integrityVerified
                  ? `✅ ${t("feed.integrityOk")}`
                  : `⚠️ ${t("feed.integrityFail")}`}
              </Caption>

              {moderator ? (
                <>
                  <Field
                    placeholder={t("moderation.reasonPlaceholder")}
                    value={reasons[r.onChainReportId] ?? ""}
                    onChangeText={(v) => setReasons((p) => ({ ...p, [r.onChainReportId]: v }))}
                  />
                  <View style={styles.actions}>
                    {r.tier !== VerificationTier.UnderReview ? (
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.startReview")}
                          variant="secondary"
                          loading={busyId === r.onChainReportId}
                          onPress={() => decide(r, VerificationTier.UnderReview)}
                        />
                      </View>
                    ) : null}
                    <View style={styles.flex}>
                      <Button
                        label={t("moderation.verify")}
                        loading={busyId === r.onChainReportId}
                        onPress={() => decide(r, VerificationTier.Verified)}
                      />
                    </View>
                    <View style={styles.flex}>
                      <Button
                        label={t("moderation.reject")}
                        variant="danger"
                        loading={busyId === r.onChainReportId}
                        onPress={() => decide(r, VerificationTier.Disputed)}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <Caption>{t("moderation.readOnly")}</Caption>
              )}
            </Card>
          ))}
        </>
      )}

      {log.length > 0 ? (
        <Card>
          <SectionHeader title={t("moderation.auditLog")} />
          {log.slice(0, 8).map((d, i) => (
            <Caption key={`${d.reportId}-${d.decidedAt}-${i}`}>
              #{d.reportId}: {t(`tier.${TIER_SLUGS[d.fromTier]}`)} → {t(`tier.${TIER_SLUGS[d.toTier]}`)}
              {d.reason ? ` — ${d.reason}` : ""}
            </Caption>
          ))}
          <Body dim>{t("moderation.auditNote")}</Body>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 100 },
});
