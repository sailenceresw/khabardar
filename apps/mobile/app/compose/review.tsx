import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { AnonymousReport } from "@khabardar/shared";
import { REPORT_CATEGORY_KEYS, VISIBILITY_KEYS, Visibility } from "@khabardar/shared";
import { useApp } from "../../src/state/AppContext";
import { journalistKeysArePlaceholders } from "../../src/content/recipients";
import { loadReport } from "../../src/drafts";
import { publishReport } from "../../src/submitReport";
import { anchoredFrom, dequeue, enqueue } from "../../src/submissionQueue";
import { Body, Button, Card, Caption, Notice, Screen, Title } from "../../src/ui";
import { colors, spacing } from "../../src/theme";
import { t } from "../../src/i18n";
import { probeAnonymity } from "../../src/net/transport";

export default function ReviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { upsertReport } = useApp();

  const [report, setReport] = useState<AnonymousReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const [sponsor, setSponsor] = useState<string | null>(null);
  const [anonymity, setAnonymity] = useState(() => probeAnonymity());
  /** User explicitly chose to submit without Tor after seeing the warning. */
  const [acceptedClearnet, setAcceptedClearnet] = useState(false);

  const refreshAnonymity = useCallback(async () => {
    setAnonymity(probeAnonymity());
  }, []);

  useEffect(() => {
    if (id) loadReport(id).then(setReport);
  }, [id]);

  useEffect(() => {
    refreshAnonymity();
  }, [refreshAnonymity]);

  if (!report) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Body dim>{t("common.loading")}</Body>
        </View>
      </Screen>
    );
  }

  const isProtected = anonymity.verified;
  const needsTorAck = !isProtected && !acceptedClearnet;

  async function submit() {
    if (!report) return;
    // Block accidental clearnet submit until the user acknowledges.
    if (needsTorAck) return;

    setSubmitting(true);
    setError(null);
    setProgressLabel(null);

    const submittingReport: AnonymousReport = { ...report, status: "submitting" };
    await upsertReport(submittingReport);

    try {
      const published = await publishReport(report, {
        onEvidenceProgress: ({ current, total }) => {
          if (total <= 1) {
            setProgressLabel(t("review.uploadingEvidenceOne"));
          } else {
            setProgressLabel(t("review.uploadingEvidence", { current, total }));
          }
        },
      });

      // Evidence finished, so the chain anchor step starts here.
      setProgressLabel(t("review.submitting"));
      setSponsor(published.sponsorName);

      // `anchoredFrom` is shared with the retry queue so a queued submission
      // persists exactly what a first-try one does, evidence CIDs included.
      await upsertReport(anchoredFrom(report, published));
      await dequeue(report.id);
      router.replace(`/report/${report.id}`);
    } catch (e) {
      // Queue it rather than losing it. Someone reporting from a district
      // office with no signal should not have to remember to try again later
      // from somewhere else, having already taken the risk of writing it down.
      await upsertReport({ ...report, status: "failed" });
      await enqueue(report.id, e instanceof Error ? e.message : String(e));
      setQueued(true);
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
      setProgressLabel(null);
    }
  }

  return (
    <Screen>
      <Card style={{ borderColor: colors.accent }}>
        <Title>{t("review.warningTitle")}</Title>
        <Body>{t("review.warning")}</Body>
      </Card>

      {/* Pre-submit Tor / network protection status */}
      {isProtected ? (
        <Notice tone="success">{t("review.torWarningProtected")}</Notice>
      ) : (
          <Card style={{ borderColor: colors.danger }}>
            <Title>{t("review.torWarningTitle")}</Title>
            <Body>{t("review.torWarningBody")}</Body>
            <Button
              label={t("review.torWarningOpenSettings")}
              variant="secondary"
              onPress={() => router.push("/settings")}
            />
            {!acceptedClearnet ? (
              <Button
                label={t("review.torWarningContinueAnyway")}
                variant="danger"
                onPress={() => setAcceptedClearnet(true)}
              />
            ) : (
              <Caption>{t("review.torWarningContinueAnyway")}</Caption>
            )}
        </Card>
      )}

      {report.visibility === Visibility.JournalistsOnly && journalistKeysArePlaceholders() ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{t("review.journalistsDemoWarning")}</Body>
        </Card>
      ) : null}

      <Card>
        <Body dim>{t("compose.categoryLabel")}</Body>
        <Body>{t(REPORT_CATEGORY_KEYS[report.category])}</Body>
        <Body dim>{t("compose.bodyLabel")}</Body>
        <Body>{report.body}</Body>
        {report.coarseGeohash ? (
          <>
            <Body dim>{t("compose.locationLabel")}</Body>
            <Body>{report.coarseGeohash}</Body>
          </>
        ) : null}
        <Body dim>
          {t("compose.evidenceLabel")}: {report.evidence.length}
        </Body>
        <Body dim>{t("compose.visibilityLabel")}</Body>
        <Body>{t(VISIBILITY_KEYS[report.visibility])}</Body>
      </Card>

      <Card>
        <Body dim>{t("review.hashNote")}</Body>
        <Body dim>{t("review.gasNote")}</Body>
        {sponsor ? <Body dim>{t("review.sponsoredBy", { name: sponsor })}</Body> : null}
      </Card>

      {error ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{error}</Body>
          {queued ? <Body dim>{t("queue.queuedNotice")}</Body> : null}
        </Card>
      ) : null}

      <Button
        label={
          submitting
            ? progressLabel ?? t("review.submitting")
            : t("review.submit")
        }
        onPress={submit}
        loading={submitting}
        // Disable primary submit until protected or user explicitly continues
        disabled={needsTorAck || submitting}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
});
