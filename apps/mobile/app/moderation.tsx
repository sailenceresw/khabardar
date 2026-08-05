import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  JURY_QUORUM_WEIGHT,
  REPORT_CATEGORY_KEYS,
  TIER_SLUGS,
  VerificationTier,
  Visibility,
  type FeedReport,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReports } from "../src/feed";
import {
  castJuryVote,
  isJurorMode,
  jurorLabel,
  JuryVoteRejected,
  karmaOf,
  publicDecisionLog,
  setJurorMode,
  simulatePeerReview,
  tallyFor,
  weightFromKarma,
  type JuryTally,
  type JuryVote,
} from "../src/moderation";
import { useApp } from "../src/state/AppContext";
import { Badge, Body, Button, Card, Screen, TierBadge, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

const QUEUE_TIERS = [
  VerificationTier.Unverified,
  VerificationTier.UnderReview,
  VerificationTier.CommunityCorroborated,
];

export default function ModerationScreen() {
  const router = useRouter();
  const { identity } = useApp();

  const [juror, setJuror] = useState(false);
  const [weight, setWeight] = useState(1);
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [tallies, setTallies] = useState<Record<number, JuryTally>>({});
  const [log, setLog] = useState<JuryVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [mode, rows, decisions] = await Promise.all([
        isJurorMode(),
        getNetworkIndex().list(),
        publicDecisionLog(),
      ]);
      setJuror(mode);
      setLog(decisions);

      if (identity) setWeight(weightFromKarma(await karmaOf(identity.address)));

      const resolved = await resolveFeedReports(rows);
      // The queue is everything not yet finally adjudicated, oldest first —
      // a report that has waited longest should be seen first.
      const queue = resolved
        .filter((r) => QUEUE_TIERS.includes(r.tier) && !r.demo)
        .sort((a, b) => a.timestamp - b.timestamp);
      setReports(queue);

      const entries = await Promise.all(
        queue.map(async (r) => [r.onChainReportId, await tallyFor(r.onChainReportId)] as const)
      );
      setTallies(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function vote(report: FeedReport, tier: VerificationTier) {
    if (!identity) return;
    setBusyId(report.onChainReportId);
    setError(null);
    try {
      await castJuryVote({
        reportId: report.onChainReportId,
        juror: identity.address,
        reporter: report.reporter,
        tier,
        reason: reasons[report.onChainReportId] ?? "",
      });
      setReasons((p) => ({ ...p, [report.onChainReportId]: "" }));
      await load();
    } catch (e) {
      setError(
        e instanceof JuryVoteRejected ? t(`jury.rejected.${e.code}`) : t("common.error")
      );
    } finally {
      setBusyId(null);
    }
  }

  async function simulate(report: FeedReport) {
    const tally = tallies[report.onChainReportId];
    const mine = tally?.votes.find(
      (v) => v.juror.toLowerCase() === identity?.address.toLowerCase()
    );
    setBusyId(report.onChainReportId);
    try {
      await simulatePeerReview({
        reportId: report.onChainReportId,
        reporter: report.reporter,
        tier: mine?.tier ?? VerificationTier.UnderReview,
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleJuror() {
    await setJurorMode(!juror);
    await load();
  }

  return (
    <Screen>
      <Title>{t("moderation.title")}</Title>

      <Card>
        <Body dim>{t("jury.intro")}</Body>
      </Card>

      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("jury.devModeNote")}</Body>
        <Button
          label={juror ? t("jury.leaveJurorMode") : t("jury.enterJurorMode")}
          onPress={toggleJuror}
          variant="secondary"
        />
        {juror ? (
          <Body dim>
            {t("jury.yourWeight", { weight })} · {t("jury.quorum", { n: JURY_QUORUM_WEIGHT })}
          </Body>
        ) : null}
      </Card>

      {error ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {loading ? (
        <Card>
          <ActivityIndicator color={colors.accent} />
        </Card>
      ) : reports.length === 0 ? (
        <Card>
          <Body dim>{t("moderation.queueEmpty")}</Body>
        </Card>
      ) : (
        <>
          <Body dim>{t("moderation.queueCount", { count: reports.length })}</Body>
          {reports.map((r) => {
            const tally = tallies[r.onChainReportId];
            const votes = tally?.votes ?? [];
            const mine = votes.find(
              (v) => v.juror.toLowerCase() === identity?.address.toLowerCase()
            );
            const isOwn = identity?.address.toLowerCase() === r.reporter.toLowerCase();

            return (
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

                <Body dim>
                  {r.reporterCodename} · {r.coarseGeohash || "—"} ·{" "}
                  {t("feed.corroborations", { count: r.corroborations })}
                </Body>

                <Body dim>
                  {r.integrityVerified
                    ? `✅ ${t("feed.integrityOk")}`
                    : `⚠️ ${t("feed.integrityFail")}`}
                </Body>

                <TallyBar tally={tally} />

                {votes.length > 0 ? (
                  <View style={styles.votes}>
                    {votes.map((v) => (
                      <View key={`${v.juror}-${v.castAt}`} style={styles.voteRow}>
                        <Body dim>
                          {jurorLabel(v.juror)} → {t(`tier.${TIER_SLUGS[v.tier]}`)} (
                          {t("jury.weight", { weight: v.weight })}): {v.reason}
                        </Body>
                        {v.simulated ? (
                          <Text style={styles.simTag}>{t("jury.simulatedTag")}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}

                {!juror ? (
                  <Body dim>{t("moderation.readOnly")}</Body>
                ) : isOwn ? (
                  <Body dim>{t("jury.rejected.self-review")}</Body>
                ) : mine ? (
                  <>
                    <Body dim>
                      {t("jury.yourVote", { tier: t(`tier.${TIER_SLUGS[mine.tier]}`) })}
                    </Body>
                    <Button
                      label={t("jury.simulatePeers")}
                      variant="secondary"
                      loading={busyId === r.onChainReportId}
                      onPress={() => simulate(r)}
                    />
                    <Body dim>{t("jury.simulateNote")}</Body>
                  </>
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder={t("jury.reasonPlaceholder")}
                      placeholderTextColor={colors.textDim}
                      multiline
                      value={reasons[r.onChainReportId] ?? ""}
                      onChangeText={(v) => setReasons((p) => ({ ...p, [r.onChainReportId]: v }))}
                    />
                    <Body dim>{t("jury.reasonNote")}</Body>
                    <View style={styles.actions}>
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.startReview")}
                          variant="secondary"
                          loading={busyId === r.onChainReportId}
                          onPress={() => vote(r, VerificationTier.UnderReview)}
                        />
                      </View>
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.verify")}
                          loading={busyId === r.onChainReportId}
                          onPress={() => vote(r, VerificationTier.Verified)}
                        />
                      </View>
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.reject")}
                          variant="danger"
                          loading={busyId === r.onChainReportId}
                          onPress={() => vote(r, VerificationTier.Disputed)}
                        />
                      </View>
                    </View>
                  </>
                )}
              </Card>
            );
          })}
        </>
      )}

      {log.length > 0 ? (
        <Card>
          <Body dim>{t("jury.auditLog")}</Body>
          {log.slice(0, 10).map((v) => (
            <Body key={`${v.reportId}-${v.juror}-${v.castAt}`} dim>
              #{v.reportId} · {jurorLabel(v.juror)} → {t(`tier.${TIER_SLUGS[v.tier]}`)}
              {v.reason ? ` — ${v.reason}` : ""}
            </Body>
          ))}
          <Body dim>{t("jury.auditNote")}</Body>
        </Card>
      ) : null}

      <Pressable onPress={() => router.push("/")}>
        <Text style={styles.link}>{t("feed.backHome")}</Text>
      </Pressable>
    </Screen>
  );
}

/** Weight accumulated behind each tier, against the quorum needed to finalize. */
function TallyBar({ tally }: { tally?: JuryTally }) {
  const entries = Object.entries(tally?.weightByTier ?? {}).filter(([, w]) => w > 0);
  if (entries.length === 0) return <Body dim>{t("jury.noVotesYet")}</Body>;

  return (
    <View style={styles.tally}>
      {entries.map(([tier, w]) => (
        <Badge
          key={tier}
          label={`${t(`tier.${TIER_SLUGS[Number(tier) as VerificationTier]}`)} ${w}/${JURY_QUORUM_WEIGHT}`}
          tone={w >= JURY_QUORUM_WEIGHT ? "success" : "info"}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 100 },
  tally: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  votes: { gap: 2, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.sm },
  voteRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  simTag: { color: colors.textDim, fontSize: 11, fontStyle: "italic" },
  link: { color: colors.info, fontSize: 15, fontWeight: "600", textAlign: "center" },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    marginTop: spacing.sm,
  },
});
