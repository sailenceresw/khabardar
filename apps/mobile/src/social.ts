import AsyncStorage from "@react-native-async-storage/async-storage";
import { codenameFromAddress } from "./identity";
import { safeJsonParse } from "./safeJson";

/**
 * The social layer: profiles, follows, comments, and reactions.
 *
 * ## What this is, and the risk it carries
 *
 * This turns a reporting tool into a place people gather. That is a real
 * product decision with real upside — reports that nobody reads change nothing,
 * and a following feed is how a story reaches the journalist who can act on it.
 *
 * It also introduces the one thing the rest of this codebase spends its entire
 * design avoiding: **structure that links a reporter's activity together**. A
 * profile page collects someone's reports into one list. A follow edge connects
 * two accounts. A comment thread is a place for strangers to speculate out loud
 * about who filed. None of that is hypothetical; it is how sources have been
 * identified on other platforms.
 *
 * So every feature here ships with the smallest mitigation that does not gut
 * it, and each one is documented where it lives rather than in a policy nobody
 * reads:
 *
 *  - **Codenames are derived, never chosen.** A handle someone picks is a
 *    fingerprint they carry between platforms; `mumbai_accountant` identifies a
 *    person far better than `silent-heron-42` does. See {@link profileFor}.
 *  - **Reports can be unlisted per report.** A profile is opt-out per item, so
 *    the one sensitive report does not have to sit next to the nine safe ones
 *    that establish a pattern. See {@link setReportListed}.
 *  - **Follow lists are private by default.** Counts are public, the edges are
 *    not, because the edges are the graph. See {@link setFollowListVisible}.
 *  - **Reactions are not corroboration.** They live in a separate store, render
 *    separately, and can never move a verification tier. See {@link react}.
 *  - **Comments can be reported for identity speculation** specifically, and
 *    that reason hides the comment immediately rather than queueing it. See
 *    {@link reportComment}.
 *
 * What none of this fixes: a determined observer reading a public profile and
 * correlating writing style, timing, and coarse region across several reports.
 * That is inherent to letting reports be grouped by author at all. The per-report
 * unlist switch is the honest mitigation, and it only works if people use it.
 */

const PROFILE_KEY = "khabardar.social.profile.v1";
const FOLLOWS_KEY = "khabardar.social.follows.v1";
const COMMENTS_KEY = "khabardar.social.comments.v1";
const REACTIONS_KEY = "khabardar.social.reactions.v1";
const UNLISTED_KEY = "khabardar.social.unlisted.v1";

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export interface SocialProfile {
  /** Pseudonymous address. Never shown in UI — the codename is. */
  address: string;
  /** Derived from the address. Deliberately not user-chosen. */
  codename: string;
  bio?: string;
  joinedAt: number;
  /** Whether this profile can be found by search and suggestion. */
  listed: boolean;
  /** Whether the accounts this profile follows are publicly visible. */
  followListVisible: boolean;
}

/**
 * A profile for an address.
 *
 * The codename is always derived from the address and cannot be set. A chosen
 * handle would be the single most damaging thing to allow here: people reuse
 * handles across platforms, and one reused handle collapses the entire
 * anonymity model into a search query. Deriving it also means two people cannot
 * impersonate each other by picking the same name.
 */
export function profileFor(address: string, stored?: Partial<SocialProfile>): SocialProfile {
  return {
    address,
    codename: codenameFromAddress(address),
    bio: stored?.bio,
    joinedAt: stored?.joinedAt ?? Date.now(),
    listed: stored?.listed ?? true,
    followListVisible: stored?.followListVisible ?? false,
  };
}

export async function getMyProfile(address: string): Promise<SocialProfile> {
  const stored = safeJsonParse<Partial<SocialProfile>>(await AsyncStorage.getItem(PROFILE_KEY));
  return profileFor(address, stored ?? undefined);
}

export async function saveMyProfile(
  address: string,
  patch: Partial<Pick<SocialProfile, "bio" | "listed" | "followListVisible">>
): Promise<SocialProfile> {
  const next = { ...(await getMyProfile(address)), ...patch };
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  return next;
}

/** Longest bio accepted. Short on purpose — see {@link BIO_WARNING_TERMS}. */
export const MAX_BIO_LENGTH = 140;

/**
 * Words that make a bio identifying.
 *
 * A free-text bio is where people volunteer the thing no attacker could
 * otherwise get: their job, their department, their town. This does not block
 * anything — it warns, because a reporter who genuinely wants to say "engineer,
 * PWD" may have decided that trade-off knowingly, and silently forbidding it
 * would be both patronising and easy to route around.
 */
export const BIO_WARNING_TERMS = [
  "engineer",
  "clerk",
  "officer",
  "accountant",
  "teacher",
  "doctor",
  "inspector",
  "department",
  "ministry",
  "office of",
  "works at",
  "employed",
  "years at",
];

export function bioLooksIdentifying(bio: string): boolean {
  const lower = bio.toLowerCase();
  return BIO_WARNING_TERMS.some((term) => lower.includes(term));
}

// ---------------------------------------------------------------------------
// Per-report listing
// ---------------------------------------------------------------------------

async function readUnlisted(): Promise<number[]> {
  return safeJsonParse<number[]>(await AsyncStorage.getItem(UNLISTED_KEY)) ?? [];
}

/**
 * Whether a report appears on its author's profile.
 *
 * Opt-out per report rather than a single account-wide switch, because the
 * risk is not uniform: it is usually one report that would identify someone,
 * sitting next to nine that would not. An all-or-nothing setting forces a
 * choice between hiding everything and exposing the one that matters.
 */
export async function isReportListed(reportId: number): Promise<boolean> {
  return !(await readUnlisted()).includes(reportId);
}

export async function setReportListed(reportId: number, listed: boolean): Promise<void> {
  const unlisted = new Set(await readUnlisted());
  if (listed) unlisted.delete(reportId);
  else unlisted.add(reportId);
  await AsyncStorage.setItem(UNLISTED_KEY, JSON.stringify([...unlisted]));
}

export async function listedReportIds(reportIds: number[]): Promise<number[]> {
  const unlisted = new Set(await readUnlisted());
  return reportIds.filter((id) => !unlisted.has(id));
}

// ---------------------------------------------------------------------------
// Follows
// ---------------------------------------------------------------------------

export enum FollowKind {
  /** Another reporter. The edge that carries the most risk. */
  Reporter = "reporter",
  /** A blinded entity tag — an accused office. Carries no reporter identity. */
  Entity = "entity",
  /** A coarse geohash prefix. */
  Region = "region",
  Category = "category",
}

export interface Follow {
  kind: FollowKind;
  /** Address, entity tag, geohash prefix, or category id as a string. */
  target: string;
  /** Display label; for reporters this is the derived codename. */
  label: string;
  at: number;
}

export async function following(): Promise<Follow[]> {
  return safeJsonParse<Follow[]>(await AsyncStorage.getItem(FOLLOWS_KEY)) ?? [];
}

export async function isFollowing(kind: FollowKind, target: string): Promise<boolean> {
  const lower = target.toLowerCase();
  return (await following()).some(
    (f) => f.kind === kind && f.target.toLowerCase() === lower
  );
}

export async function follow(kind: FollowKind, target: string, label?: string): Promise<void> {
  if (await isFollowing(kind, target)) return;
  const entry: Follow = {
    kind,
    target,
    label: label ?? (kind === FollowKind.Reporter ? codenameFromAddress(target) : target),
    at: Date.now(),
  };
  await AsyncStorage.setItem(FOLLOWS_KEY, JSON.stringify([entry, ...(await following())]));
}

export async function unfollow(kind: FollowKind, target: string): Promise<void> {
  const lower = target.toLowerCase();
  const next = (await following()).filter(
    (f) => !(f.kind === kind && f.target.toLowerCase() === lower)
  );
  await AsyncStorage.setItem(FOLLOWS_KEY, JSON.stringify(next));
}

/**
 * Whether this device publishes who it follows.
 *
 * Off by default. Follower *counts* are harmless; the *edges* are the social
 * graph, and a graph over a whistleblower platform is a map of who trusts
 * whom. Someone who wants a public following list can have one — but it has to
 * be a decision, not a default they never saw.
 */
export async function setFollowListVisible(address: string, visible: boolean): Promise<void> {
  await saveMyProfile(address, { followListVisible: visible });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export interface Comment {
  id: string;
  reportId: number;
  author: string;
  body: string;
  at: number;
  /** Set when the comment replies to another. */
  parentId?: string;
  hidden?: boolean;
  hiddenReason?: CommentReportReason;
}

export enum CommentReportReason {
  /**
   * Hides on sight rather than queueing.
   *
   * Every other kind of bad comment is unpleasant; this one is dangerous, and
   * the damage is done the moment it is read. Leaving "I reckon this is the
   * woman from accounts" visible while a moderator gets to it is not a
   * trade-off worth making.
   */
  IdentitySpeculation = "identity-speculation",
  Harassment = "harassment",
  Defamation = "defamation",
  Spam = "spam",
}

export const COMMENT_REPORT_REASON_KEYS: Record<CommentReportReason, string> = {
  [CommentReportReason.IdentitySpeculation]: "social.reportReason.identity",
  [CommentReportReason.Harassment]: "social.reportReason.harassment",
  [CommentReportReason.Defamation]: "social.reportReason.defamation",
  [CommentReportReason.Spam]: "social.reportReason.spam",
};

export const MAX_COMMENT_LENGTH = 500;

async function readComments(): Promise<Comment[]> {
  return safeJsonParse<Comment[]>(await AsyncStorage.getItem(COMMENTS_KEY)) ?? [];
}

async function writeComments(comments: Comment[]): Promise<void> {
  await AsyncStorage.setItem(COMMENTS_KEY, JSON.stringify(comments));
}

/** Visible comments on a report, oldest first so threads read naturally. */
export async function commentsFor(reportId: number): Promise<Comment[]> {
  return (await readComments())
    .filter((c) => c.reportId === reportId && !c.hidden)
    .sort((a, b) => a.at - b.at);
}

export async function commentCount(reportId: number): Promise<number> {
  return (await commentsFor(reportId)).length;
}

export async function addComment(input: {
  reportId: number;
  author: string;
  body: string;
  parentId?: string;
}): Promise<Comment | null> {
  const body = input.body.trim().slice(0, MAX_COMMENT_LENGTH);
  if (!body) return null;

  const comment: Comment = {
    id: `c_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
    reportId: input.reportId,
    author: input.author,
    body,
    at: Date.now(),
    ...(input.parentId ? { parentId: input.parentId } : {}),
  };

  await writeComments([...(await readComments()), comment]);
  return comment;
}

/**
 * Report a comment.
 *
 * Identity speculation hides immediately; everything else marks it for review.
 * On a real deployment the rest would queue to the jury — the point of the
 * split is that one category cannot afford to wait.
 */
export async function reportComment(
  commentId: string,
  reason: CommentReportReason
): Promise<void> {
  const comments = await readComments();
  const index = comments.findIndex((c) => c.id === commentId);
  if (index === -1) return;

  const hideNow = reason === CommentReportReason.IdentitySpeculation;
  comments[index] = {
    ...comments[index],
    hidden: hideNow || comments[index].hidden,
    hiddenReason: reason,
  };
  await writeComments(comments);
}

export async function deleteComment(commentId: string, author: string): Promise<void> {
  const comments = await readComments();
  await writeComments(
    comments.filter(
      (c) => !(c.id === commentId && c.author.toLowerCase() === author.toLowerCase())
    )
  );
}

// ---------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------

/**
 * Reactions are engagement, NOT evidence.
 *
 * Deliberately not called "like", deliberately stored apart from corroboration,
 * and deliberately incapable of moving a verification tier. Corroboration means
 * "I independently witnessed this" — an evidentiary claim, gated by the
 * personhood check. A reaction means "this matters to me", which is a feeling.
 *
 * Conflating them would be the most damaging thing this whole file could do:
 * a report accusing a popular figure attracts *fewer* reactions and would read
 * as less credible, which inverts the signal exactly where it matters most.
 */
export enum ReactionKind {
  /** "This matters." Visibility, not veracity. */
  Important = "important",
  /** "I'm with you." Solidarity for the reporter. */
  Support = "support",
}

export interface Reaction {
  reportId: number;
  actor: string;
  kind: ReactionKind;
  at: number;
}

async function readReactions(): Promise<Reaction[]> {
  return safeJsonParse<Reaction[]>(await AsyncStorage.getItem(REACTIONS_KEY)) ?? [];
}

export async function reactionsFor(reportId: number): Promise<Record<ReactionKind, number>> {
  const all = (await readReactions()).filter((r) => r.reportId === reportId);
  return {
    [ReactionKind.Important]: all.filter((r) => r.kind === ReactionKind.Important).length,
    [ReactionKind.Support]: all.filter((r) => r.kind === ReactionKind.Support).length,
  };
}

export async function myReaction(
  reportId: number,
  actor: string
): Promise<ReactionKind | null> {
  const lower = actor.toLowerCase();
  return (
    (await readReactions()).find(
      (r) => r.reportId === reportId && r.actor.toLowerCase() === lower
    )?.kind ?? null
  );
}

/** Set or clear this device's reaction. One per report, replaceable. */
export async function react(
  reportId: number,
  actor: string,
  kind: ReactionKind | null
): Promise<void> {
  const lower = actor.toLowerCase();
  const rest = (await readReactions()).filter(
    (r) => !(r.reportId === reportId && r.actor.toLowerCase() === lower)
  );
  const next = kind ? [...rest, { reportId, actor, kind, at: Date.now() }] : rest;
  await AsyncStorage.setItem(REACTIONS_KEY, JSON.stringify(next));
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/** Wiped by panic delete along with everything else. */
export async function clearSocial(): Promise<void> {
  await AsyncStorage.multiRemove([
    PROFILE_KEY,
    FOLLOWS_KEY,
    COMMENTS_KEY,
    REACTIONS_KEY,
    UNLISTED_KEY,
  ]);
}
