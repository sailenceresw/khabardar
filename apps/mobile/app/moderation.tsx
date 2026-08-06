import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  REPORT_CATEGORY_KEYS,
  TIER_SLUGS,
  VerificationTier,
  Visibility,
  type FeedReport,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReports } from "../src/feed";
import {
  appealVerdict,
  ballotsFor,
  canAppeal,
  commitVote,
  isJurorMode,
  jurorLabel,
  jurorRecord,
  JuryActionRejected,
  JuryPhase,
  JURY_QUORUM,
  publicDecisionLog,
  revealVote,
  roundFor,
  setJurorMode,
  simulatePeerReview,
  type Ballot,
  type JuryRound,
  type JurorRecord,
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

interface RowState {
  round: JuryRound;
  ballots: Ballot[];
  appealable: boolean;
}

export default function ModerationScreen() {
  const router = useRouter();
  const { identity } = useApp();

  const [juror, setJuror] = useState(false);
  const [record, setRecord] = useState<JurorRecord>({ completed: 0, abandoned: 0 });
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [state, setState] = useState<Record<number, RowState>>({});
  const [log, setLog] = useState<Ballot[]>([]);
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
      if (identity) setRecord(await jurorRecord(identity.address));

      const resolved = await resolveFeedReports(rows);
      const queue = resolved
        .filter((r) => QUEUE_TIERS.includes(r.tier) && !r.demo)
        .sort((a, b) => a.timestamp - b.timestamp);
      setReports(queue);

      const entries = await Promise.all(
        queue.map(async (r) => {
          const id = r.onChainReportId;
          return [
            id,
            {
              round: await roundFor(id),
              ballots: await ballotsFor(id),
              appealable: await canAppeal(id),
            },
          ] as const;
        })
      );
      setState(Object.fromEntries(entries));
    } finally {
      setLoading(false);
    }
  }, [identity]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  function report(e: unknown) {
    setError(e instanceof JuryActionRejected ? t(`jury.rejected.${e.code}`) : t("common.error"));
  }

  async function commit(r: FeedReport, tier: VerificationTier) {
    if (!identity) return;
    setBusyId(r.onChainReportId);
    setError(null);
    try {
      // The tier is sealed here — it is not stored anywhere readable until the
      // panel fills and this juror reveals it.
      await commitVote({
        reportId: r.onChainReportId,
        juror: identity.address,
        reporter: r.reporter,
        tier,
      });
      setPendingTier((p) => ({ ...p, [r.onChainReportId]: tier }));
      await load();
    } catch (e) {
      report(e);
    } finally {
      setBusyId(null);
    }
  }

  const [pendingTier, setPendingTier] = useState<Record<number, VerificationTier>>({});

  async function reveal(r: FeedReport) {
    if (!identity) return;
    const tier = pendingTier[r.onChainReportId];
    if (tier === undefined) {
      setError(t("jury.rejected.no-salt"));
      return;
    }
    setBusyId(r.onChainReportId);
    setError(null);
    try {
      await revealVote({
        reportId: r.onChainReportId,
        juror: identity.address,
        tier,
        reason: reasons[r.onChainReportId] ?? "",
      });
      setReasons((p) => ({ ...p, [r.onChainReportId]: "" }));
      await load();
    } catch (e) {
      report(e);
    } finally {
      setBusyId(null);
    }
  }

  async function simulate(r: FeedReport) {
    setBusyId(r.onChainReportId);
    try {
      await simulatePeerReview({
        reportId: r.onChainReportId,
        reporter: r.reporter,
        tier: pendingTier[r.onChainReportId] ?? VerificationTier.UnderReview,
      });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function appeal(r: FeedReport) {
    setBusyId(r.onChainReportId);
    try {
      await appealVerdict(r.onChainReportId);
      await load();
    } finally {
      setBusyId(null);
    }
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
          onPress={async () => {
            await setJurorMode(!juror);
            await load();
          }}
          variant="secondary"
        />
        {juror ? (
          <Body dim>
            {t("jury.yourRecord", { done: record.completed, missed: record.abandoned })}
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
            const id = r.onChainReportId;
            const row = state[id];
            const ballots = row?.ballots ?? [];
            const mine = ballots.find(
              (b) => b.juror.toLowerCase() === identity?.address.toLowerCase()
            );
            const isOwn = identity?.address.toLowerCase() === r.reporter.toLowerCase();
            const phase = row?.round.phase ?? JuryPhase.None;
            const revealed = ballots.filter((b) => b.tier !== undefined);

            return (
              <Card key={id}>
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

                <PhaseBar round={row?.round} sealed={ballots.length} opened={revealed.length} />

                {/* Sealed ballots show WHO committed and nothing else. Showing a
                    running tally here is exactly what would let a late juror
                    read the room instead of the evidence. */}
                {ballots.length > 0 ? (
                  <View style={styles.ballots}>
                    {ballots.map((b) => (
                      <View key={`${b.juror}-${b.round}`} style={styles.ballotRow}>
                        <Body dim>
                          {jurorLabel(b.juror)} —{" "}
                          {b.tier === undefined
                            ? t("jury.sealed")
                            : `${t(`tier.${TIER_SLUGS[b.tier]}`)}: ${b.reason}`}
                        </Body>
                        {b.simulated ? (
                          <Text style={styles.simTag}>{t("jury.simulatedTag")}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                ) : null}

                {row?.appealable && isOwn ? (
                  <>
                    <Body dim>{t("jury.appealExplainer")}</Body>
                    <Button
                      label={t("jury.appeal")}
                      variant="secondary"
                      loading={busyId === id}
                      onPress={() => appeal(r)}
                    />
                  </>
                ) : null}

                {!juror ? (
                  <Body dim>{t("moderation.readOnly")}</Body>
                ) : isOwn ? (
                  <Body dim>{t("jury.rejected.self-review")}</Body>
                ) : phase === JuryPhase.Revealing && mine && mine.tier === undefined ? (
                  <>
                    <Body dim>{t("jury.revealPrompt")}</Body>
                    <TextInput
                      style={styles.input}
                      placeholder={t("jury.reasonPlaceholder")}
                      placeholderTextColor={colors.textDim}
                      multiline
                      value={reasons[id] ?? ""}
                      onChangeText={(v) => setReasons((p) => ({ ...p, [id]: v }))}
                    />
                    <Body dim>{t("jury.reasonNote")}</Body>
                    <Button
                      label={t("jury.reveal")}
                      loading={busyId === id}
                      onPress={() => reveal(r)}
                    />
                  </>
                ) : mine ? (
                  <>
                    <Body dim>
                      {mine.tier === undefined ? t("jury.committed") : t("jury.revealed")}
                    </Body>
                    <Button
                      label={t("jury.simulatePeers")}
                      variant="secondary"
                      loading={busyId === id}
                      onPress={() => simulate(r)}
                    />
                    <Body dim>{t("jury.simulateNote")}</Body>
                  </>
                ) : phase === JuryPhase.Decided ? (
                  <Body dim>{t("jury.rejected.not-committing")}</Body>
                ) : (
                  <>
                    <Body dim>{t("jury.commitPrompt")}</Body>
                    <View style={styles.actions}>
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.startReview")}
                          variant="secondary"
                          loading={busyId === id}
                          onPress={() => commit(r, VerificationTier.UnderReview)}
                        />
                      </View>
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.verify")}
                          loading={busyId === id}
                          onPress={() => commit(r, VerificationTier.Verified)}
                        />
                      </View>
                      <View style={styles.flex}>
                        <Button
                          label={t("moderation.reject")}
                          variant="danger"
                          loading={busyId === id}
                          onPress={() => commit(r, VerificationTier.Disputed)}
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
          {log.slice(0, 10).map((b) => (
            <Body key={`${b.reportId}-${b.round}-${b.juror}`} dim>
              #{b.reportId} · {jurorLabel(b.juror)} → {t(`tier.${TIER_SLUGS[b.tier!]}`)}
              {b.reason ? ` — ${b.reason}` : ""}
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

/**
 * Progress through the two phases.
 *
 * Deliberately shows counts and never a tally: how many ballots are sealed is
 * safe to publish, which way they lean is not.
 */
function PhaseBar({
  round,
  sealed,
  opened,
}: {
  round?: JuryRound;
  sealed: number;
  opened: number;
}) {
  const phase = round?.phase ?? JuryPhase.None;
  const quorum = round?.quorum ?? JURY_QUORUM;

  const tone =
    phase === JuryPhase.Decided ? "success" : phase === JuryPhase.Undecided ? "danger" : "info";

  return (
    <View style={styles.phase}>
      <Badge label={t(`jury.phase.${JuryPhase[phase].toLowerCase()}`)} tone={tone} />
      {phase === JuryPhase.Committing ? (
        <Badge label={t("jury.sealedCount", { n: sealed, quorum })} tone="dim" />
      ) : null}
      {phase === JuryPhase.Revealing ? (
        <Badge label={t("jury.openedCount", { n: opened, total: sealed })} tone="dim" />
      ) : null}
      {round?.appealed ? <Badge label={t("jury.onAppeal")} tone="info" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 100 },
  phase: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  ballots: { gap: 2, borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: spacing.sm },
  ballotRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
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
