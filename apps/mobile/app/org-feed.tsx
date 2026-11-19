import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  REPORT_CATEGORY_KEYS,
  ReportCategory,
  TIER_SLUGS,
  VerificationTier,
  Visibility,
  type FeedReport,
  type Organization,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReports, type FeedQuery } from "../src/feed";
import { getOrg } from "../src/org";
import { loadOrgRecipientKey } from "../src/orgRecipientKey";
import { getRuntimeConfig } from "../src/runtimeConfig";
import {
  Body,
  Button,
  Card,
  Caption,
  Chip,
  EmptyState,
  Field,
  LoadingBlock,
  Notice,
  Screen,
  SectionHeader,
  TierBadge,
} from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

const CATEGORIES = Object.values(ReportCategory).filter((v): v is ReportCategory => typeof v === "number");

const TIER_FILTERS = [
  VerificationTier.Verified,
  VerificationTier.CommunityCorroborated,
  VerificationTier.UnderReview,
  VerificationTier.Unverified,
];

/** Corroboration floors offered as one tap each. */
const CORROBORATION_FLOORS = [1, 3, 5];

/**
 * The organisation view of the report corpus.
 *
 * Same data as the public feed, from whichever source the mode switch picked
 * (mock, the registry on Linea Sepolia, or an indexer), with the filters an
 * investigator needs: category, district, verification tier and how many
 * people corroborated a report. Signed-in organisations only; it reads public
 * data and grants no extra access on its own.
 */
export default function OrgFeedScreen() {
  const router = useRouter();
  const [org, setOrg] = useState<Organization | null | undefined>(undefined);
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [keyName, setKeyName] = useState<string | null>(null);

  const [category, setCategory] = useState<ReportCategory | undefined>();
  const [tier, setTier] = useState<VerificationTier | undefined>();
  const [region, setRegion] = useState("");
  const [minCorroborations, setMinCorroborations] = useState<number | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const current = await getOrg();
      setOrg(current);
      if (!current) return;
      const recipientKey = await loadOrgRecipientKey();
      setKeyName(recipientKey?.recipient.name ?? null);
      const query: FeedQuery = { category, tier, region: region.trim() || undefined, minCorroborations };
      const rows = await getNetworkIndex().list(query);
      // The key is used here, on this device, and nowhere else.
      const resolved = await resolveFeedReports(rows, recipientKey?.privKeyHex);
      // Most corroborated first: that is the order an investigator triages in.
      setReports(resolved.sort((a, b) => b.corroborations - a.corroborations || b.timestamp - a.timestamp));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [category, tier, region, minCorroborations]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  if (org === undefined) return <Screen><LoadingBlock label={t("common.loading")} /></Screen>;

  if (org === null) {
    return (
      <Screen>
        <EmptyState
          title={t("orgFeed.signInTitle")}
          body={t("orgFeed.signInBody")}
          action={{ label: t("orgFeed.openOrg"), onPress: () => router.push("/org") }}
        />
      </Screen>
    );
  }

  const source = getNetworkIndex().name;
  const live = getRuntimeConfig().mode === "live" && source !== "mock";

  return (
    <Screen>
      <Card>
        <Caption>{org.name}</Caption>
        <Body dim>{t("orgFeed.intro")}</Body>
        <Notice tone={live ? "success" : "info"}>
          {live ? t("orgFeed.sourceLive", { source }) : t("orgFeed.sourceMock")}
        </Notice>
        <Caption>{keyName ? t("orgFeed.keyActive", { name: keyName }) : t("orgFeed.keyNone")}</Caption>
      </Card>

      <Card>
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

        <Body dim>{t("orgFeed.filterCorroborations")}</Body>
        <View style={styles.chips}>
          <Chip
            label={t("feed.all")}
            active={minCorroborations === undefined}
            onPress={() => setMinCorroborations(undefined)}
          />
          {CORROBORATION_FLOORS.map((n) => (
            <Chip
              key={n}
              label={t("orgFeed.atLeast", { count: n })}
              active={minCorroborations === n}
              onPress={() => setMinCorroborations(minCorroborations === n ? undefined : n)}
            />
          ))}
        </View>

        <Field
          label={t("orgFeed.filterDistrict")}
          placeholder={t("feed.regionPlaceholder")}
          value={region}
          onChangeText={setRegion}
          autoCapitalize="none"
          maxLength={4}
        />
      </Card>

      {loading ? (
        <LoadingBlock label={t("common.loading")} />
      ) : error ? (
        <Notice tone="danger">{t("orgFeed.loadFailed")}</Notice>
      ) : reports.length === 0 ? (
        <EmptyState title={t("feed.empty")} />
      ) : (
        <>
          <SectionHeader title={t("feed.resultCount", { count: reports.length })} />
          {reports.map((r) => (
            <Pressable key={r.onChainReportId} onPress={() => router.push(`/feed/${r.onChainReportId}`)}>
              <Card>
                <View style={styles.row}>
                  <Body>{t(REPORT_CATEGORY_KEYS[r.category])}</Body>
                  <TierBadge tier={r.tier} />
                </View>
                {r.locked ? (
                  <Body dim>
                    {r.visibility === Visibility.JournalistsOnly ? `🔒 ${t("feed.restricted")}` : `🔒 ${t("feed.unavailable")}`}
                  </Body>
                ) : (
                  <Body>{truncate(r.body ?? "", 160)}</Body>
                )}
                {r.decryptedLocally ? <Text style={styles.decrypted}>🔓 {t("orgFeed.decryptedHere")}</Text> : null}
                <Text style={styles.meta}>
                  #{r.onChainReportId} · {r.coarseGeohash || "—"} · {new Date(r.timestamp).toISOString().slice(0, 10)} ·{" "}
                  {t("feed.corroborations", { count: r.corroborations })}
                </Text>
                <Text style={styles.meta}>
                  {r.integrityVerified ? t("orgFeed.integrityOk") : t("orgFeed.integrityUnchecked")}
                  {r.demo ? ` · ${t("feed.sample")}` : ""}
                </Text>
              </Card>
            </Pressable>
          ))}
        </>
      )}

      <Button label={t("orgFeed.backToOrg")} variant="ghost" onPress={() => router.push("/org")} />
    </Screen>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  meta: { color: colors.textMuted, fontSize: 12 },
  decrypted: { color: colors.success, fontSize: 13 },
});
