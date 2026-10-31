import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { REPORT_CATEGORY_KEYS, type FeedReport } from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReports } from "../../src/feed";
import {
  bioLooksIdentifying,
  follow,
  FollowKind,
  getMyProfile,
  isFollowing,
  isReportListed,
  listedReportIds,
  MAX_BIO_LENGTH,
  profileFor,
  saveMyProfile,
  setReportListed,
  unfollow,
  type SocialProfile,
} from "../../src/social";
import { useApp } from "../../src/state/AppContext";
import { Badge, Body, Button, Card, Screen, TierBadge, Title } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

export default function ProfileScreen() {
  const router = useRouter();
  const { address } = useLocalSearchParams<{ address: string }>();
  const { identity } = useApp();

  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [reports, setReports] = useState<FeedReport[]>([]);
  const [followed, setFollowed] = useState(false);
  const [bio, setBio] = useState("");
  const [busy, setBusy] = useState(false);

  const isMe = !!identity && identity.address.toLowerCase() === (address ?? "").toLowerCase();

  const load = useCallback(async () => {
    if (!address) return;

    const p = isMe ? await getMyProfile(address) : profileFor(address);
    setProfile(p);
    setBio(p.bio ?? "");
    setFollowed(await isFollowing(FollowKind.Reporter, address));

    const rows = await getNetworkIndex().list();
    const resolved = await resolveFeedReports(rows);
    const mine = resolved.filter(
      (r) => r.reporter.toLowerCase() === address.toLowerCase() && !r.demo
    );

    // Unlisted reports are hidden from everyone else, and shown to their author
    // with the switch that hid them — otherwise they could never be un-hidden.
    if (isMe) {
      setReports(mine);
    } else {
      const listed = await listedReportIds(mine.map((r) => r.onChainReportId));
      setReports(mine.filter((r) => listed.includes(r.onChainReportId)));
    }
  }, [address, isMe]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function toggleFollow() {
    if (!address) return;
    setBusy(true);
    try {
      if (followed) await unfollow(FollowKind.Reporter, address);
      else await follow(FollowKind.Reporter, address);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <Screen>
        <Body dim>{t("common.loading")}</Body>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Title>{profile.codename}</Title>
        <Body dim>{t("social.joined", { date: new Date(profile.joinedAt).toLocaleDateString() })}</Body>
        <Body dim>{t("social.reportCount", { count: reports.length })}</Body>
        {profile.bio ? <Body>{profile.bio}</Body> : null}

        {!isMe ? (
          <Button
            label={followed ? t("social.unfollow") : t("social.follow")}
            onPress={toggleFollow}
            loading={busy}
            variant={followed ? "secondary" : "primary"}
          />
        ) : null}
      </Card>

      {/* Shown on every profile, not tucked into settings. The person most
          likely to underestimate this risk is the one whose profile it is. */}
      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("social.profileRiskNote")}</Body>
      </Card>

      {isMe ? (
        <>
          <Card>
            <Body dim>{t("social.bioLabel")}</Body>
            <TextInput
              style={styles.input}
              multiline
              maxLength={MAX_BIO_LENGTH}
              placeholder={t("social.bioPlaceholder")}
              placeholderTextColor={colors.textDim}
              value={bio}
              onChangeText={setBio}
            />
            {bioLooksIdentifying(bio) ? (
              <Body>{t("social.bioIdentifyingWarning")}</Body>
            ) : null}
            <Button
              label={t("common.save")}
              variant="secondary"
              onPress={async () => {
                await saveMyProfile(profile.address, { bio: bio.trim() || undefined });
                await load();
              }}
            />
          </Card>

          <Card>
            <Body dim>{t("social.visibilityTitle")}</Body>
            <Body dim>{t("social.listedExplainer")}</Body>
            <Button
              label={profile.listed ? `✅ ${t("social.listed")}` : t("social.listed")}
              variant="secondary"
              onPress={async () => {
                await saveMyProfile(profile.address, { listed: !profile.listed });
                await load();
              }}
            />
            <Body dim>{t("social.followListExplainer")}</Body>
            <Button
              label={
                profile.followListVisible
                  ? `✅ ${t("social.followListVisible")}`
                  : t("social.followListVisible")
              }
              variant="secondary"
              onPress={async () => {
                await saveMyProfile(profile.address, {
                  followListVisible: !profile.followListVisible,
                });
                await load();
              }}
            />
          </Card>
        </>
      ) : null}

      <Card>
        <Body dim>{t("social.reportsTitle")}</Body>
        {reports.length === 0 ? (
          <Body dim>{t("social.noReports")}</Body>
        ) : (
          reports.map((r) => (
            <ProfileReportRow
              key={r.onChainReportId}
              report={r}
              isMe={isMe}
              onOpen={() => router.push(`/feed/${r.onChainReportId}`)}
              onChanged={load}
            />
          ))
        )}
      </Card>

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

/**
 * One report on a profile.
 *
 * The author sees an unlist control on every row. The risk is rarely uniform
 * across someone's reports — it is usually one of them that would identify
 * them, sitting next to others that establish the pattern making it legible.
 */
function ProfileReportRow({
  report,
  isMe,
  onOpen,
  onChanged,
}: {
  report: FeedReport;
  isMe: boolean;
  onOpen: () => void;
  onChanged: () => Promise<void>;
}) {
  const [listed, setListed] = useState(true);

  React.useEffect(() => {
    let active = true;
    isReportListed(report.onChainReportId).then((value) => {
      if (active) setListed(value);
    });
    return () => {
      active = false;
    };
  }, [report.onChainReportId]);

  return (
    <View style={styles.reportRow}>
      <Pressable onPress={onOpen}>
        <View style={styles.row}>
          <Body>{t(REPORT_CATEGORY_KEYS[report.category])}</Body>
          <TierBadge tier={report.tier} />
        </View>
        <Body dim>{report.body ? truncate(report.body, 90) : t("feed.restricted")}</Body>
      </Pressable>

      {isMe ? (
        <View style={styles.row}>
          {!listed ? <Badge label={t("social.unlisted")} tone="dim" /> : <View />}
          <Pressable
            onPress={async () => {
              await setReportListed(report.onChainReportId, !listed);
              setListed(!listed);
              await onChanged();
            }}
          >
            <Text style={styles.link}>
              {listed ? t("social.hideFromProfile") : t("social.showOnProfile")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reportRow: {
    gap: 4,
    paddingBottom: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  link: { color: colors.info, fontSize: 13, fontWeight: "600" },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 70,
    textAlignVertical: "top",
  },
});
