import React, { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  REPORT_CATEGORY_KEYS,
  ReportCategory,
  TIER_SLUGS,
  VerificationTier,
  Visibility,
  type FeedReport,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReports, type FeedQuery } from "../../src/feed";
import {
  Body,
  Card,
  Chip,
  EmptyState,
  Field,
  LoadingBlock,
  Screen,
  SectionHeader,
  TierBadge,
  Title,
} from "../../src/ui";
import { colors, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

const CATEGORIES = Object.values(ReportCategory).filter(
  (v): v is ReportCategory => typeof v === "number"
);

const TIER_FILTERS = [
  VerificationTier.Verified,
  VerificationTier.CommunityCorroborated,
  VerificationTier.UnderReview,
  VerificationTier.Unverified,
];

const DATE_RANGES = [
  { key: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

export default function FeedScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState<ReportCategory | undefined>();
  const [tier, setTier] = useState<VerificationTier | undefined>();
  const [region, setRegion] = useState("");
  const [search, setSearch] = useState("");
  const [since, setSince] = useState<number | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query: FeedQuery = { category, tier, region: region.trim() || undefined, since };
      const rows = await getNetworkIndex().list(query);
      setReports(await resolveFeedReports(rows));
    } finally {
      setLoading(false);
    }
  }, [category, tier, region, since]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return reports;
    return reports.filter((r) => (r.body ?? "").toLowerCase().includes(q));
  }, [reports, search]);

  const activeFilters = [category !== undefined, tier !== undefined, !!region.trim(), !!since].filter(
    Boolean
  ).length;

  function clearFilters() {
    setCategory(undefined);
    setTier(undefined);
    setRegion("");
    setSearch("");
    setSince(undefined);
  }

  return (
    <Screen>
      <Title>{t("feed.title")}</Title>
      <Body dim>{t("feed.subtitle")}</Body>

      <Card>
        <Field
          placeholder={t("feed.searchPlaceholder")}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />

        <Body dim>{t("feed.filterCategory")}</Body>
        <View style={styles.chips}>
          <Chip label={t("feed.all")} active={category === undefined} onPress={() => setCategory(undefined)} />
          {CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={t(REPORT_CATEGORY_KEYS[c])}
              active={category === c}
              onPress={() => setCategory(category === c ? undefined : c)}
            />
          ))}
        </View>

        <Body dim>{t("feed.filterTier")}</Body>
        <View style={styles.chips}>
          <Chip label={t("feed.all")} active={tier === undefined} onPress={() => setTier(undefined)} />
          {TIER_FILTERS.map((tr) => (
            <Chip
              key={tr}
              label={t(`tier.${TIER_SLUGS[tr]}`)}
              active={tier === tr}
              onPress={() => setTier(tier === tr ? undefined : tr)}
            />
          ))}
        </View>

        <Body dim>{t("feed.filterDate")}</Body>
        <View style={styles.chips}>
          <Chip label={t("feed.anyTime")} active={since === undefined} onPress={() => setSince(undefined)} />
          {DATE_RANGES.map((d) => {
            const value = Date.now() - d.ms;
            const active = since !== undefined && Math.abs(since - value) < 60_000;
            return (
              <Chip
                key={d.key}
                label={t(`feed.range.${d.key}`)}
                active={active}
                onPress={() => setSince(active ? undefined : value)}
              />
            );
          })}
        </View>

        <Field
          label={t("feed.filterRegion")}
          placeholder={t("feed.regionPlaceholder")}
          value={region}
          onChangeText={setRegion}
          autoCapitalize="none"
          maxLength={4}
        />

        {activeFilters > 0 || search ? (
          <Pressable onPress={clearFilters}>
            <Text style={styles.link}>{t("feed.clearFilters")}</Text>
          </Pressable>
        ) : null}
      </Card>

      {loading ? (
        <LoadingBlock label={t("common.loading")} />
      ) : visible.length === 0 ? (
        <EmptyState title={t("feed.empty")} />
      ) : (
        <>
          <SectionHeader title={t("feed.resultCount", { count: visible.length })} />
          {visible.map((r) => (
            <Pressable key={r.onChainReportId} onPress={() => router.push(`/feed/${r.onChainReportId}`)}>
              <Card>
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
                  <Body>{truncate(r.body ?? "", 120)}</Body>
                )}

                <View style={styles.row}>
                  <Text style={styles.meta}>
                    {r.reporterCodename} · {r.coarseGeohash || "—"} ·{" "}
                    {t("feed.corroborations", { count: r.corroborations })}
                  </Text>
                  {r.demo ? <Text style={styles.demoTag}>{t("feed.sample")}</Text> : null}
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}
    </Screen>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  meta: { color: colors.textMuted, fontSize: 12, flex: 1 },
  demoTag: { color: colors.textDim, fontSize: 11, fontStyle: "italic" },
  link: { color: colors.info, fontSize: 14, fontWeight: "600" },
});
