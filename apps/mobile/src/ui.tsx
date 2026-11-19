import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { VerificationTier } from "@khabardar/shared";
import { colors, radius, spacing, typography } from "./theme";
import { t } from "./i18n";

/**
 * State props for a control that is switched on or off, such as a filter chip.
 *
 * react-native-web reads only the aria-* props, not accessibilityState, and
 * React Native maps aria-selected to the native "selected" state. On the web a
 * toggle button is described with aria-pressed, so that is added there.
 */
export function toggleState(on: boolean) {
  return Platform.OS === "web"
    ? ({ "aria-selected": on, "aria-pressed": on } as { "aria-selected": boolean })
    : { "aria-selected": on };
}

export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  /** Pinned below the scrolling content, for a screen's main action. */
  footer?: React.ReactNode;
}) {
  const body = !scroll ? (
    <View style={styles.screen}>{children}</View>
  ) : (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
  if (!footer) return body;
  return (
    <View style={styles.screen}>
      {body}
      <View style={styles.footer}>{footer}</View>
    </View>
  );
}

/**
 * Where the reporter is in the write, privacy check, review sequence. Three
 * screens that used to feel unrelated now read as one flow.
 */
export function StepIndicator({ current }: { current: 0 | 1 | 2 }) {
  const steps = [t("steps.write"), t("steps.privacy"), t("steps.review")];
  return (
    <View
      style={styles.steps}
      accessibilityRole="progressbar"
      accessibilityLabel={t("steps.a11y", { current: current + 1, total: steps.length, label: steps[current] })}
    >
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            {i > 0 ? <View style={[styles.stepLine, i <= current && styles.stepLineDone]} /> : null}
            <View style={styles.step}>
              <View style={[styles.stepDot, (done || active) && styles.stepDotOn]}>
                <Text style={[styles.stepNumber, (done || active) && styles.stepNumberOn]}>{done ? "✓" : i + 1}</Text>
              </View>
              <Text style={[styles.stepLabel, active && styles.stepLabelActive]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Title({ children }: { children: React.ReactNode }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Body({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return <Text style={[styles.body, dim && { color: colors.textDim }]}>{children}</Text>;
}

export function Caption({ children }: { children: React.ReactNode }) {
  return <Text style={styles.caption}>{children}</Text>;
}

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <Text style={styles.mono} numberOfLines={1} ellipsizeMode="middle">
      {children}
    </Text>
  );
}

export function SectionHeader({
  title,
  action,
}: {
  title: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={action.onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel={action.label}>
          <Text style={styles.sectionAction}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <Card style={styles.loadingCard}>
      <ActivityIndicator color={colors.accent} />
      {label ? <Caption>{label}</Caption> : null}
    </Card>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "danger" | "success" | "warn";
}) {
  const border =
    tone === "danger"
      ? colors.danger
      : tone === "success"
        ? colors.success
        : tone === "warn"
          ? colors.accent
          : colors.info;
  const bg =
    tone === "danger"
      ? colors.dangerMuted
      : tone === "success"
        ? colors.successMuted
        : tone === "warn"
          ? colors.accentMuted
          : colors.infoMuted;
  return (
    <Card style={{ borderColor: border, backgroundColor: bg }}>
      <Body dim>{children}</Body>
    </Card>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <Card style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Body dim>{body}</Body> : null}
      {action ? (
        <View style={{ marginTop: spacing.sm, alignSelf: "stretch" }}>
          <Button label={action.label} onPress={action.onPress} />
        </View>
      ) : null}
    </Card>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  // A chip without onPress is a plain label, so it only gets a role when it can be pressed.
  // The hit slop brings the touch target to 44 px without making the chip look bigger.
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      hitSlop={onPress ? { top: 6, bottom: 6, left: 2, right: 2 } : undefined}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
      {...(onPress ? toggleState(!!active) : null)}
    >
      <View style={[styles.chip, active && styles.chipActive]}>
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

export function Field({
  label,
  help,
  error,
  ...inputProps
}: {
  label?: string;
  help?: string;
  error?: string;
} & TextInputProps) {
  return (
    <View style={styles.field}>
      {label ? <Caption>{label}</Caption> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        // The caption above is only visual; screen readers need the label on the input itself.
        accessibilityLabel={inputProps.accessibilityLabel ?? label ?? inputProps.placeholder}
        accessibilityHint={error ?? help}
        style={[styles.input, error ? styles.inputError : null, inputProps.multiline && styles.inputMultiline]}
        {...inputProps}
      />
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {!error && help ? <Caption>{help}</Caption> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  loading?: boolean;
}) {
  const bg =
    variant === "primary"
      ? colors.accent
      : variant === "danger"
        ? colors.danger
        : variant === "ghost"
          ? "transparent"
          : colors.surfaceAlt;
  const fg =
    variant === "primary"
      ? colors.accentText
      : variant === "danger"
        ? "#fff"
        : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      // The label stays readable while the spinner replaces it on screen.
      accessibilityLabel={label}
      aria-disabled={disabled || loading}
      aria-busy={loading}
      style={({ pressed }) => [
        styles.button,
        variant === "ghost" && styles.buttonGhost,
        { backgroundColor: bg, opacity: disabled || loading ? 0.45 : pressed ? 0.82 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonLabel, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function TierBadge({ tier }: { tier: VerificationTier }) {
  const map: Record<VerificationTier, { tone: "dim" | "info" | "success" | "danger"; key: string }> = {
    [VerificationTier.Unverified]: { tone: "dim", key: "tier.unverified" },
    [VerificationTier.UnderReview]: { tone: "info", key: "tier.underReview" },
    [VerificationTier.CommunityCorroborated]: { tone: "info", key: "tier.corroborated" },
    [VerificationTier.Verified]: { tone: "success", key: "tier.verified" },
    [VerificationTier.Disputed]: { tone: "danger", key: "tier.disputed" },
  };
  const { tone, key } = map[tier] ?? map[VerificationTier.Unverified];
  return <Badge label={t(key)} tone={tone} />;
}

export function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "info" | "danger" | "dim";
}) {
  const c =
    tone === "success"
      ? colors.success
      : tone === "info"
        ? colors.info
        : tone === "danger"
          ? colors.danger
          : colors.textDim;
  const bg =
    tone === "success"
      ? colors.successMuted
      : tone === "info"
        ? colors.infoMuted
        : tone === "danger"
          ? colors.dangerMuted
          : colors.surfaceAlt;
  return (
    <View style={[styles.badge, { borderColor: c, backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  footer: {
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  steps: { flexDirection: "row", alignItems: "flex-start", paddingVertical: spacing.xs },
  step: { alignItems: "center", gap: 4, width: 84 },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  stepDotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  stepNumber: { color: colors.textDim, fontSize: 13, fontWeight: "700" },
  stepNumberOn: { color: colors.accentText },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.borderStrong, marginTop: 13 },
  stepLineDone: { backgroundColor: colors.accent },
  stepLabel: { color: colors.textDim, fontSize: 12, textAlign: "center" },
  stepLabelActive: { color: colors.text, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { color: colors.text, ...typography.title },
  subtitle: { color: colors.text, ...typography.subtitle },
  body: { color: colors.text, ...typography.body },
  caption: { color: colors.textDim, ...typography.caption },
  mono: {
    color: colors.textDim,
    fontFamily: "monospace",
    ...typography.mono,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sectionAction: { color: colors.info, fontSize: 14, fontWeight: "600" },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  loadingCard: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.sm },
  emptyCard: { alignItems: "center", paddingVertical: spacing.lg },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    minHeight: 34,
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13 },
  chipTextActive: { color: colors.accentText, fontWeight: "600" },
  field: { gap: spacing.xs },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 120, textAlignVertical: "top" },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: 12 },
  button: {
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  buttonGhost: {
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 12, fontWeight: "600" },
});
