import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  AnalyticsNotEntitledError,
  computeAnalytics,
  MIN_BUCKET_SIZE,
  type Bucket,
  type CorpusAnalytics,
} from "../src/analytics";
import { getNetworkIndex, resolveFeedReports } from "../src/feed";
import { Badge, Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

export default function AnalyticsScreen() {
  const router = useRouter();
  const [data, setData] = useState<CorpusAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getNetworkIndex().list();
      setData(await computeAnalytics(await resolveFeedReports(rows)));
    } catch (e) {
      setData(null);
      setError(
        e instanceof AnalyticsNotEntitledError ? t("analytics.notEntitled") : t("common.error")
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

  return (
    <Screen>
      <Title>{t("analytics.title")}</Title>

      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("analytics.privacyNote", { n: MIN_BUCKET_SIZE })}</Body>
      </Card>

      {loading ? (
        <Card>
          <ActivityIndicator color={colors.accent} />
        </Card>
      ) : error ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{error}</Body>
        </Card>
      ) : data ? (
        <>
          <Card>
            <Body dim>{t("analytics.overview")}</Body>
            <Title>{data.totalReports}</Title>
            <Body dim>{t("analytics.totalReports")}</Body>
            <Body>
              {t("analytics.verifiedShare", { pct: (data.verifiedShare * 100).toFixed(0) })}
            </Body>
            <Body>
              {t("analytics.corroborationRate", {
                pct: (data.corroborationRate * 100).toFixed(0),
              })}
            </Body>
          </Card>

          {data.suppressedBuckets > 0 ? (
            <Card style={{ borderColor: colors.info }}>
              <Body dim>
                {t("analytics.suppressed", {
                  buckets: data.suppressedBuckets,
                  reports: data.suppressedReports,
                })}
              </Body>
            </Card>
          ) : null}

          <BucketCard title={t("analytics.byCategory")} buckets={data.byCategory} />
          <BucketCard title={t("analytics.byTier")} buckets={data.byTier} />
          <BucketCard title={t("analytics.byRegion")} buckets={data.byRegion} />
          <BucketCard
            title={t("analytics.topEntities")}
            buckets={data.topEntities}
            note={t("analytics.entityNote")}
            truncateKeys
          />

          <Card>
            <Body dim>{t("analytics.weekly")}</Body>
            {data.weeklyVolume.length === 0 ? (
              <Body dim>{t("analytics.noData")}</Body>
            ) : (
              data.weeklyVolume.map((w) => (
                <View key={w.weekStart} style={styles.barRow}>
                  <Body dim>{new Date(w.weekStart).toLocaleDateString()}</Body>
                  <Bar count={w.count} max={Math.max(...data.weeklyVolume.map((x) => x.count))} />
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

function BucketCard({
  title,
  buckets,
  note,
  truncateKeys,
}: {
  title: string;
  buckets: Bucket[];
  note?: string;
  truncateKeys?: boolean;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <Card>
      <Body dim>{title}</Body>
      {buckets.length === 0 ? (
        <Body dim>{t("analytics.noData")}</Body>
      ) : (
        buckets.map((b) => (
          <View key={b.key} style={styles.barRow}>
            <Body>
              {b.labelKey ? t(b.labelKey) : truncateKeys ? `${b.key.slice(0, 10)}…` : b.key}
            </Body>
            <Bar count={b.count} max={max} />
          </View>
        ))
      )}
      {note ? <Body dim>{note}</Body> : null}
    </Card>
  );
}

function Bar({ count, max }: { count: number; max: number }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { flex: Math.max(0.02, count / max) }]} />
      <Badge label={String(count)} tone="info" />
    </View>
  );
}

const styles = StyleSheet.create({
  barRow: { gap: 4, marginBottom: spacing.sm },
  barTrack: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barFill: { height: 8, backgroundColor: colors.accent, borderRadius: radius.sm },
});
