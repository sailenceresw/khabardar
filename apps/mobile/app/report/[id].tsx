import React, { useCallback, useState } from "react";
import { Linking } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { AnonymousReport } from "@khabardar/shared";
import { ACTIVE_CHAIN, REPORT_CATEGORY_KEYS } from "@khabardar/shared";
import { loadReport } from "../../src/drafts";
import { Badge, Body, Button, Card, Mono, Screen, Title } from "../../src/ui";
import { t } from "../../src/i18n";

export default function ReportStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<AnonymousReport | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (id) loadReport(id).then(setReport);
    }, [id])
  );

  if (!report) return <Screen scroll={false}><Body dim> </Body></Screen>;

  const tone = { draft: "dim", submitting: "info", anchored: "success", failed: "danger" } as const;

  return (
    <Screen>
      <Card>
        <Badge label={t(`status.${report.status}`)} tone={tone[report.status]} />
        <Title>{t(REPORT_CATEGORY_KEYS[report.category])}</Title>
        <Body dim>{new Date(report.createdAt).toLocaleString()}</Body>
        <Body>{report.body}</Body>
      </Card>

      {report.reportHash ? (
        <Card>
          <Body dim>{t("status.reportHash")}</Body>
          <Mono>{report.reportHash}</Mono>
          {report.txHash ? (
            <>
              <Body dim>{t("status.txHash")}</Body>
              <Mono>{report.txHash}</Mono>
            </>
          ) : null}
          {report.onChainReportId !== undefined ? (
            <Body dim>
              {t("status.onChainId")}: #{report.onChainReportId}
            </Body>
          ) : null}
          {report.txHash ? (
            <Button
              label={t("status.viewOnExplorer")}
              variant="secondary"
              onPress={() => Linking.openURL(`${ACTIVE_CHAIN.explorerUrl}/tx/${report.txHash}`)}
            />
          ) : null}
        </Card>
      ) : null}

      {report.status === "failed" || report.status === "draft" ? (
        <Button
          label={t("status.retry")}
          onPress={() => router.push({ pathname: "/compose/review", params: { id: report.id } })}
        />
      ) : null}
    </Screen>
  );
}
