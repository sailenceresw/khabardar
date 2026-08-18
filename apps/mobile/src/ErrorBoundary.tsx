import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "./theme";
import { t } from "./i18n";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence against a blank screen.
 *
 * React unmounts the whole tree when a render throws, and with nothing to
 * catch it the user is left staring at an empty background. For most apps that
 * is an annoyance. Here it is worse than that: someone using this is often
 * doing so under time pressure and may reasonably read a dead screen as the app
 * having been tampered with, when the truth is usually a bad state read.
 *
 * The error text is shown rather than hidden behind a generic apology, because
 * the person most likely to be looking at it is the one who has to decide
 * whether the app is safe to keep using.
 *
 * Deliberately not reported anywhere. There is no crash telemetry in this app
 * and there will not be — a stack trace tied to a device and a timestamp is
 * exactly the kind of record this project exists to avoid creating.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.title}>{t("common.error")}</Text>
          <Text style={styles.body}>{t("error.boundaryBody")}</Text>
          <Text style={styles.detail} selectable>
            {error.message || String(error)}
          </Text>
          <Pressable style={styles.retry} onPress={this.reset}>
            <Text style={styles.retryLabel}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.md,
    justifyContent: "center",
    flexGrow: 1,
    maxWidth: 680,
    alignSelf: "center",
    width: "100%",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  body: { color: colors.text, fontSize: 15 },
  detail: { color: colors.textDim, fontSize: 12 },
  retry: {
    marginTop: spacing.sm,
    alignSelf: "flex-start",
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  retryLabel: { color: colors.accentText, fontSize: 16, fontWeight: "600" },
});
