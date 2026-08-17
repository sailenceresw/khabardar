import React, { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { AnonymousReport } from "@khabardar/shared";
import { REPORT_CATEGORY_KEYS, VISIBILITY_KEYS } from "@khabardar/shared";
import { useApp } from "../../src/state/AppContext";
import { loadReport } from "../../src/drafts";
import { publishReport } from "../../src/submitReport";
import { Body, Button, Card, Caption, Notice, Screen, Title } from "../../src/ui";
import { colors } from "../../src/theme";
import { t } from "../../src/i18n";
import {
  applySavedTransportPrefs,
  getAnonymityStatus,
  type AnonymityStatus,
} from "../../src/transport";

export default function ReviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { upsertReport } = useApp();

  const [report, setReport] = useState<AnonymousReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<string | null>(null);
  const [anonymity, setAnonymity] = useState<AnonymityStatus | null>(null);
  /** User explicitly chose to submit without Tor after seeing the warning. */
  const [acceptedClearnet, setAcceptedClearnet] = useState(false);

  const refreshAnonymity = useCallback(async () => {
    await applySavedTransportPrefs();
    setAnonymity(getAnonymityStatus());
  }, []);

  useEffect(() => {
    if (id) loadReport(id).then(setReport);
  }, [id]);

  useEffect(() => {
    refreshAnonymity();
  }, [refreshAnonymity]);

  if (!report) return <Screen scroll={false}><Body dim> </Body></Screen>;

  const isProtected = anonymity?.protected === true;
  const needsTorAck = anonymity !== null && !isProtected && !acceptedClearnet;

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
      const { reportHash, cid, relay, sponsorName, evidence } = await publishReport(report, {
        onEvidenceProgress: ({ current, total }) => {
          if (total <= 1) {
            setProgressLabel(t("review.uploadingEvidenceOne"));
          } else {
            setProgressLabel(t("review.uploadingEvidence", { current, total }));
          }
        },
      });

      // Evidence finished — now the chain anchor step.
      setProgressLabel(t("review.submitting"));
      setSponsor(sponsorName);

      const anchored: AnonymousReport = {
        ...report,
        status: "anchored",
        reportHash,
        cid,
        // Persist the evidence CIDs returned by the upload, otherwise the
        // blobs are on the content layer but the device forgets where.
        evidence,
        txHash: relay.txHash,
        onChainReportId: relay.onChainReportId,
        anchoredAt: Date.now(),
      };
      await upsertReport(anchored);
      router.replace(`/report/${report.id}`);
    } catch (e) {
      await upsertReport({ ...report, status: "failed" });
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
      {anonymity ? (
        isProtected ? (
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
        )
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
