import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  CORROBORATION_THRESHOLD,
  REPORT_CATEGORY_KEYS,
  VerificationTier,
  Visibility,
  type FeedReport,
} from "@khabardar/shared";
import { getNetworkIndex, resolveFeedReport } from "../../src/feed";
import {
  hasCorroboratedLocally,
  markCorroboratedLocally,
  updateMirrorRow,
} from "../../src/feed/localChainMirror";
import {
  addComment,
  commentsFor,
  COMMENT_REPORT_REASON_KEYS,
  CommentReportReason,
  follow,
  FollowKind,
  isFollowing,
  MAX_COMMENT_LENGTH,
  myReaction,
  react,
  reactionsFor,
  ReactionKind,
  reportComment,
  unfollow,
  type Comment,
} from "../../src/social";
import { codenameFromAddress } from "../../src/identity";
import { useApp } from "../../src/state/AppContext";
import { Badge, Body, Button, Card, Mono, Screen, TierBadge, Title } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

export default function FeedReportScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { identity } = useApp();

  const [report, setReport] = useState<FeedReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [alreadyCorroborated, setAlreadyCorroborated] = useState(false);

  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [reactions, setReactions] = useState<Record<ReactionKind, number>>({
    [ReactionKind.Important]: 0,
    [ReactionKind.Support]: 0,
  });
  const [mine, setMine] = useState<ReactionKind | null>(null);
  const [followingAuthor, setFollowingAuthor] = useState(false);

  async function load() {
    const reportId = Number(id);
    const row = await getNetworkIndex().get(reportId);
    const resolved = row ? await resolveFeedReport(row) : null;
    setReport(resolved);
    setAlreadyCorroborated(await hasCorroboratedLocally(reportId));

    setComments(await commentsFor(reportId));
    setReactions(await reactionsFor(reportId));
    if (identity) setMine(await myReaction(reportId, identity.address));
    if (resolved) {
      setFollowingAuthor(await isFollowing(FollowKind.Reporter, resolved.reporter));
    }
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!report) {
    return (
      <Screen>
        <Body dim>{t("common.loading")}</Body>
      </Screen>
    );
  }

  const isOwn = identity?.address?.toLowerCase() === report.reporter.toLowerCase();

  /**
   * Corroboration in mock mode updates the local mirror. With a real relayer
   * this becomes a sponsored `corroborate(reportId)` call — the contract
   * enforces one-per-account and blocks self-corroboration.
   */
  async function corroborate() {
    if (!report) return;
    // Mirrors the contract's one-corroboration-per-account rule. Without it the
    // button can be tapped until any report crosses the promotion threshold.
    if (await hasCorroboratedLocally(report.onChainReportId)) {
      setAlreadyCorroborated(true);
      return;
    }
    setBusy(true);
    try {
      const next = report.corroborations + 1;
      const promoted =
        next >= CORROBORATION_THRESHOLD && report.tier === VerificationTier.Unverified
          ? VerificationTier.CommunityCorroborated
          : report.tier;

      await updateMirrorRow(report.onChainReportId, { corroborations: next, tier: promoted });
      await markCorroboratedLocally(report.onChainReportId);
      await load();
      setNote(t("feed.corroborateThanks"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.row}>
        <Title>{t(REPORT_CATEGORY_KEYS[report.category])}</Title>
        <TierBadge tier={report.tier} />
      </View>

      {report.demo ? (
        <Card style={{ borderColor: colors.info }}>
          <Body dim>{t("feed.sampleNotice")}</Body>
        </Card>
      ) : null}

      <Card>
        {report.locked ? (
          <Body dim>
            {report.visibility === Visibility.JournalistsOnly
              ? `🔒 ${t("feed.restrictedLong")}`
              : `🔒 ${t("feed.unavailable")}`}
          </Body>
        ) : (
          <Body>{report.body}</Body>
        )}
      </Card>

      <Card>
        <Body dim>{t("feed.reporter")}</Body>
        <Pressable onPress={() => router.push(`/profile/${report!.reporter}`)}>
          <Text style={styles.link}>{report.reporterCodename}</Text>
        </Pressable>
        {!isOwn ? (
          <Button
            label={followingAuthor ? t("social.unfollow") : t("social.follow")}
            variant="secondary"
            onPress={async () => {
              if (followingAuthor) await unfollow(FollowKind.Reporter, report!.reporter);
              else await follow(FollowKind.Reporter, report!.reporter);
              await load();
            }}
          />
        ) : null}
        <Body dim>{t("feed.area")}</Body>
        <Body>{report.coarseGeohash || "—"}</Body>
        <Body dim>{t("feed.submittedAt")}</Body>
        <Body>{new Date(report.timestamp).toLocaleString()}</Body>
        {report.evidenceCount !== undefined ? (
          <>
            <Body dim>{t("compose.evidenceLabel")}</Body>
            <Body>{report.evidenceCount}</Body>
          </>
        ) : null}
      </Card>

      <Card>
        <Body dim>{t("feed.integrity")}</Body>
        <Body>
          {report.demo
            ? t("feed.integritySample")
            : report.integrityVerified
              ? `✅ ${t("feed.integrityOk")}`
              : `⚠️ ${t("feed.integrityFail")}`}
        </Body>
        <Body dim>{t("status.reportHash")}</Body>
        <Mono>{report.reportHash}</Mono>
        <Body dim>{t("feed.cid")}</Body>
        <Mono>{report.cid}</Mono>
      </Card>

      <Card>
        <Body dim>
          {t("feed.corroborations", { count: report.corroborations })} ·{" "}
          {t("feed.threshold", { n: CORROBORATION_THRESHOLD })}
        </Body>
        <Body dim>{t("feed.corroborateHelp")}</Body>
        {note ? <Body>{note}</Body> : null}
        <Button
          label={t("feed.corroborate")}
          onPress={corroborate}
          loading={busy}
          disabled={isOwn || report.demo || alreadyCorroborated}
          variant="secondary"
        />
        {isOwn ? <Body dim>{t("feed.cannotCorroborateOwn")}</Body> : null}
        {!isOwn && alreadyCorroborated ? <Body dim>{t("feed.alreadyCorroborated")}</Body> : null}
      </Card>

      {/* A separate card from corroboration, on purpose. Corroboration is an
          evidentiary claim; a reaction is a feeling. Rendering them together
          would invite readers to add them up, and a report accusing a popular
          figure attracts fewer reactions — which inverts the signal exactly
          where it matters most. */}
      <Card>
        <Body dim>{t("social.reactionsTitle")}</Body>
        <Body dim>{t("social.reactionsNote")}</Body>
        <View style={styles.reactions}>
          {[ReactionKind.Important, ReactionKind.Support].map((kind) => (
            <Pressable
              key={kind}
              onPress={async () => {
                if (!identity) return;
                await react(Number(id), identity.address, mine === kind ? null : kind);
                await load();
              }}
            >
              <View style={[styles.reaction, mine === kind && styles.reactionActive]}>
                <Text style={[styles.reactionText, mine === kind && styles.reactionTextActive]}>
                  {kind === ReactionKind.Important ? "📌" : "🤝"} {t(`social.reaction.${kind}`)}{" "}
                  {reactions[kind]}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Body dim>{t("social.commentsTitle", { count: comments.length })}</Body>
        <Body dim>{t("social.commentsWarning")}</Body>

        {comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            onReported={load}
            isMine={identity?.address.toLowerCase() === c.author.toLowerCase()}
          />
        ))}

        <TextInput
          style={styles.commentInput}
          multiline
          maxLength={MAX_COMMENT_LENGTH}
          placeholder={t("social.commentPlaceholder")}
          placeholderTextColor={colors.textDim}
          value={draft}
          onChangeText={setDraft}
        />
        <Button
          label={t("social.postComment")}
          variant="secondary"
          disabled={!draft.trim()}
          onPress={async () => {
            if (!identity) return;
            await addComment({
              reportId: Number(id),
              author: identity.address,
              body: draft,
            });
            setDraft("");
            await load();
          }}
        />
      </Card>

      <Button label={t("feed.backToFeed")} onPress={() => router.push("/feed")} variant="secondary" />
    </Screen>
  );
}

/**
 * One comment, with the reporting control always visible.
 *
 * The identity-speculation option is listed first and hides the comment on
 * sight rather than queueing it. Every other kind of bad comment is unpleasant;
 * that one is dangerous the moment it is read, so leaving it up while a
 * moderator gets to it is not a trade-off worth making.
 */
function CommentRow({
  comment,
  isMine,
  onReported,
}: {
  comment: Comment;
  isMine: boolean;
  onReported: () => Promise<void>;
}) {
  const [reporting, setReporting] = useState(false);

  return (
    <View style={styles.comment}>
      <View style={styles.row}>
        <Body dim>{codenameFromAddress(comment.author)}</Body>
        <Body dim>{new Date(comment.at).toLocaleDateString()}</Body>
      </View>
      <Body>{comment.body}</Body>

      {reporting ? (
        <View style={styles.reportReasons}>
          {[
            CommentReportReason.IdentitySpeculation,
            CommentReportReason.Harassment,
            CommentReportReason.Defamation,
            CommentReportReason.Spam,
          ].map((reason) => (
            <Pressable
              key={reason}
              onPress={async () => {
                await reportComment(comment.id, reason);
                setReporting(false);
                await onReported();
              }}
            >
              <Badge
                label={t(COMMENT_REPORT_REASON_KEYS[reason])}
                tone={reason === CommentReportReason.IdentitySpeculation ? "danger" : "dim"}
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <Pressable onPress={() => setReporting(true)}>
          <Text style={styles.reportLink}>
            {isMine ? t("social.reportOwn") : t("social.reportComment")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  link: { color: colors.info, fontSize: 15, fontWeight: "600" },
  reactions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  reaction: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  reactionActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  reactionText: { color: colors.textDim, fontSize: 14 },
  reactionTextActive: { color: colors.accentText, fontWeight: "600" },
  comment: {
    gap: 2,
    paddingLeft: spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    marginBottom: spacing.sm,
  },
  reportReasons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: 4 },
  reportLink: { color: colors.textDim, fontSize: 12 },
  commentInput: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
    minHeight: 60,
    textAlignVertical: "top",
    marginTop: spacing.sm,
  },
});
