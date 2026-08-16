import React, { useCallback, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { AnonymousReport } from "@khabardar/shared";
import { ACTIVE_CHAIN, REPORT_CATEGORY_KEYS } from "@khabardar/shared";
import { loadReport } from "../../src/drafts";
import {
  Badge,
  Body,
  Button,
  Card,
  Caption,
  Divider,
  LoadingBlock,
  Mono,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from "../../src/ui";
import { colors, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

export default function ReportStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<AnonymousReport | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      setLoading(true);
      loadReport(id)
        .then(setReport)
        .finally(() => setLoading(false));
    }, [id])
  );

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
        <Notice tone="warn">{t("common.error")}</Notice>
        <Button label={t("common.back")} onPress={() => router.back()} variant="ghost" />
      </Screen>
    );
  }

  const tone = {
    draft: "dim" as const,
    submitting: "info" as const,
    anchored: "success" as const,
    failed: "danger" as const,
  };

  const statusNoticeTone =
    report.status === "anchored"
      ? ("success" as const)
      : report.status === "failed"
        ? ("danger" as const)
        : report.status === "submitting"
          ? ("info" as const)
          : ("warn" as const);

  const statusCopy =
    report.status === "draft"
      ? t("status.draft")
      : report.status === "submitting"
        ? t("status.submitting")
        : report.status === "anchored"
          ? t("status.anchored")
          : t("status.failed");

  return (
    <Screen>
      <Notice tone={statusNoticeTone}>{statusCopy}</Notice>

      <Card>
        <View style={styles.row}>
          <Badge label={t(`status.${report.status}`)} tone={tone[report.status]} />
        </View>
        <Title>{t(REPORT_CATEGORY_KEYS[report.category])}</Title>
        <Caption>{new Date(report.createdAt).toLocaleString()}</Caption>
        <Body>{report.body}</Body>
      </Card>

      {report.status === "submitting" ? (
        <Notice tone="info">{t("status.pendingNote")}</Notice>
      ) : null}

      {report.reportHash ? (
        <Card
          style={{
            borderColor:
              report.status === "anchored"
                ? colors.success
                : report.status === "failed"
                  ? colors.danger
                  : colors.border,
          }}
        >
          <SectionHeader title={t("status.reportHash")} />
          <Mono>{report.reportHash}</Mono>

          {report.txHash ? (
            <>
              <Divider />
              <Caption>
                {report.status === "submitting" ? t("status.userOpHash") : t("status.txHash")}
              </Caption>
              <Mono>{report.txHash}</Mono>
            </>
          ) : null}

          {report.onChainReportId !== undefined && report.onChainReportId >= 0 ? (
            <>
              <Divider />
              <Caption>{t("status.onChainId")}</Caption>
              <Body>#{report.onChainReportId}</Body>
            </>
          ) : null}

          {report.txHash && report.status === "anchored" ? (
            <Button
              label={t("status.viewOnExplorer")}
              variant="secondary"
              onPress={() => Linking.openURL(`${ACTIVE_CHAIN.explorerUrl}/tx/${report.txHash}`)}
            />
          ) : null}
        </Card>
      ) : null}

      {report.cid ? (
        <Card>
          <Caption>{t("status.bundleCid")}</Caption>
          <Mono>{report.cid}</Mono>
        </Card>
      ) : null}

      {report.evidence.length > 0 ? (
        <Card>
          <SectionHeader title={`${t("compose.evidenceLabel")} · ${report.evidence.length}`} />
          {report.evidence.map((e) => (
            <View key={e.id} style={styles.evidenceRow}>
              <Caption>
                {e.kind} · {(e.sizeBytes / 1024).toFixed(0)} KB
              </Caption>
              <Mono>{e.cid ?? t("status.evidenceNotUploaded")}</Mono>
            </View>
          ))}
          <Body dim>{t("status.evidenceNote")}</Body>
        </Card>
      ) : null}

      {report.status === "failed" || report.status === "draft" ? (
        <Button
          label={t("status.retry")}
          onPress={() => router.push({ pathname: "/compose/review", params: { id: report.id } })}
        />
      ) : null}

      <Button label={t("common.back")} onPress={() => router.back()} variant="ghost" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  evidenceRow: { gap: 4, marginBottom: spacing.sm },
});
