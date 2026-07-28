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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadReport(id).then(setReport);
  }, [id]);

  if (!report) return <Screen scroll={false}><Body dim> </Body></Screen>;

  async function submit() {
    if (!report) return;
    setSubmitting(true);
    setError(null);

    const submittingReport: AnonymousReport = { ...report, status: "submitting" };
    await upsertReport(submittingReport);

    try {
      const { reportHash, cid, relay } = await publishReport(report);
      const anchored: AnonymousReport = {
        ...report,
        status: "anchored",
        reportHash,
        cid,
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
      </Card>

      {error ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{error}</Body>
        </Card>
      ) : null}

      <Button
        label={submitting ? t("review.submitting") : t("review.submit")}
        onPress={submit}
        loading={submitting}
      />
    </Screen>
  );
}
