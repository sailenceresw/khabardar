import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
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
import { Body, Card, Screen, TierBadge, Title } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
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
      // Structural filters run at the index (and would run server-side against
      // a real indexer); text search runs locally because bodies are only
      // readable after decryption.
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
    // Locked reports can never match a text query — we cannot read them, and
    // guessing from metadata would be misleading.
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
        <TextInput
          style={styles.input}
          placeholder={t("feed.searchPlaceholder")}
          placeholderTextColor={colors.textDim}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />

        <Body dim>{t("feed.filterCategory")}</Body>
        <View style={styles.chips}>
          <FilterChip
            label={t("feed.all")}
            active={category === undefined}
            onPress={() => setCategory(undefined)}
          />
          {CATEGORIES.map((c) => (
            <FilterChip
              key={c}
              label={t(REPORT_CATEGORY_KEYS[c])}
              active={category === c}
              onPress={() => setCategory(category === c ? undefined : c)}
            />
          ))}
        </View>

        <Body dim>{t("feed.filterTier")}</Body>
        <View style={styles.chips}>
          <FilterChip label={t("feed.all")} active={tier === undefined} onPress={() => setTier(undefined)} />
          {TIER_FILTERS.map((tr) => (
            <FilterChip
              key={tr}
              label={t(`tier.${TIER_SLUGS[tr]}`)}
              active={tier === tr}
              onPress={() => setTier(tier === tr ? undefined : tr)}
            />
          ))}
        </View>

        <Body dim>{t("feed.filterDate")}</Body>
        <View style={styles.chips}>
          <FilterChip label={t("feed.anyTime")} active={since === undefined} onPress={() => setSince(undefined)} />
          {DATE_RANGES.map((d) => {
            const value = Date.now() - d.ms;
            const active = since !== undefined && Math.abs(since - value) < 60_000;
            return (
              <FilterChip
                key={d.key}
                label={t(`feed.range.${d.key}`)}
                active={active}
                onPress={() => setSince(active ? undefined : value)}
              />
            );
          })}
        </View>

        <Body dim>{t("feed.filterRegion")}</Body>
        <TextInput
          style={styles.input}
          placeholder={t("feed.regionPlaceholder")}
          placeholderTextColor={colors.textDim}
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
        <Card>
          <ActivityIndicator color={colors.accent} />
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <Body dim>{t("feed.empty")}</Body>
        </Card>
      ) : (
        <>
          <Body dim>{t("feed.resultCount", { count: visible.length })}</Body>
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
                  <Body dim>
                    {r.reporterCodename} · {r.coarseGeohash || "—"} ·{" "}
                    {t("feed.corroborations", { count: r.corroborations })}
                  </Body>
                  {r.demo ? <Text style={styles.demoTag}>{t("feed.sample")}</Text> : null}
                </View>
              </Card>
            </Pressable>
          ))}
        </>
      )}

      <Pressable onPress={() => router.push("/")}>
        <Text style={styles.link}>{t("feed.backHome")}</Text>
      </Pressable>
    </Screen>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <View style={[styles.chip, active && styles.chipActive]}>
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13 },
  chipTextActive: { color: colors.accentText, fontWeight: "600" },
  demoTag: { color: colors.textDim, fontSize: 11, fontStyle: "italic" },
  link: { color: colors.info, fontSize: 15, fontWeight: "600", textAlign: "center" },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
});
