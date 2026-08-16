import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { AnonymousReport } from "@khabardar/shared";
import { REPORT_CATEGORY_KEYS, VISIBILITY_KEYS } from "@khabardar/shared";
import { useApp } from "../../src/state/AppContext";
import { loadReport } from "../../src/drafts";
import { publishReport } from "../../src/submitReport";
import { Body, Button, Card, Screen, Title } from "../../src/ui";
import { colors } from "../../src/theme";
import { t } from "../../src/i18n";

export default function ReviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { upsertReport } = useApp();

  const [report, setReport] = useState<AnonymousReport | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sponsor, setSponsor] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadReport(id).then(setReport);
  }, [id]);

  if (!report) return <Screen scroll={false}><Body dim> </Body></Screen>;

  async function submit() {
    if (!report) return;
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
      />
    </Screen>
  );
}
