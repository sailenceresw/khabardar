import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { AnonymousReport, LeakFinding, LeakSeverity } from "@khabardar/shared";
import { useApp } from "../../src/state/AppContext";
import { loadReport } from "../../src/drafts";
import { imageCheckCapabilities } from "../../src/imageChecks";
import { findingKey, openFindings, reasonKey, redactFinding, replaceFinding, segmentBody } from "../../src/privacyCheck";
import { Body, Button, Card, Caption, Field, Notice, Screen, StepIndicator } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

/**
 * Privacy check: the step between composing and review.
 *
 * Runs the on-device leak detectors over the report body and shows each
 * finding in place. The reporter can fix, redact or keep each one, and can
 * always continue: this screen advises and never blocks. Nothing on it makes a
 * network request.
 */
export default function PrivacyCheckScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { upsertReport } = useApp();

  const [report, setReport] = useState<AnonymousReport | null>(null);
  const [body, setBody] = useState("");
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<{ finding: LeakFinding; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadReport(id).then((r) => {
      setReport(r);
      if (r) setBody(r.body);
    });
  }, [id]);

  const findings = useMemo(() => openFindings(body, kept), [body, kept]);
  const segments = useMemo(() => segmentBody(body, findings), [body, findings]);
  const images = useMemo(() => imageCheckCapabilities(), []);

  if (!report) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Body dim>{t("common.loading")}</Body>
        </View>
      </Screen>
    );
  }

  const hasPhotos = report.evidence.some((e) => e.kind === "photo");
  const hasFiles = report.evidence.some((e) => e.kind !== "photo");

  function keep(f: LeakFinding) {
    setKept((prev) => new Set([...prev, findingKey(f)]));
  }

  function redact(f: LeakFinding) {
    setBody((b) => redactFinding(b, f, t("privacy.redactedPlaceholder")));
  }

  function saveFix() {
    if (!editing) return;
    setBody((b) => replaceFinding(b, editing.finding, editing.text));
    setEditing(null);
  }

  async function next() {
    if (!report) return;
    setSaving(true);
    // Save edits before moving on, so review and submit use the corrected text.
    if (body !== report.body) await upsertReport({ ...report, body });
    setSaving(false);
    router.push({ pathname: "/compose/review", params: { id: report.id } });
  }

  return (
    <Screen
      footer={
        <Button
          label={
            findings.length === 0
              ? t("privacy.continue")
              : t("privacy.continueWithWarnings", { count: findings.length })
          }
          onPress={next}
          loading={saving}
        />
      }
    >
      <StepIndicator current={1} />

      {/* The stack header already shows the title, so the card carries only the explanation. */}
      <Card>
        <Body dim>{t("privacy.intro")}</Body>
      </Card>

      {findings.length === 0 ? (
        <Notice tone="success">{t("privacy.noneFound")}</Notice>
      ) : (
        <Notice tone="warn">{t("privacy.foundCount", { count: findings.length })}</Notice>
      )}
      {kept.size > 0 ? <Caption>{t("privacy.keptCount", { count: kept.size })}</Caption> : null}

      <Card>
        <Caption>{t("privacy.yourReport")}</Caption>
        <Text style={styles.bodyText}>
          {segments.map((s, i) =>
            s.finding ? (
              <Text key={i} style={[styles.highlight, highlightStyle(s.finding.severity)]}>
                {s.text}
              </Text>
            ) : (
              <Text key={i}>{s.text}</Text>
            )
          )}
        </Text>
      </Card>

      {findings.map((f) => (
        <Card key={`${findingKey(f)}@${f.start}`} style={{ borderColor: severityColor(f.severity) }}>
          <Caption>
            {t(`privacy.severity.${f.severity}`)} · {t(`privacy.type.${f.type}`)}
          </Caption>
          <Text style={[styles.quote, highlightStyle(f.severity)]}>{f.text}</Text>
          <Body dim>{t(reasonKey(f))}</Body>

          {editing && findingKey(editing.finding) === findingKey(f) && editing.finding.start === f.start ? (
            <>
              <Field
                label={t("privacy.replaceWith")}
                value={editing.text}
                onChangeText={(text) => setEditing({ finding: f, text })}
                autoFocus
              />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <Button label={t("common.save")} onPress={saveFix} />
                </View>
                <View style={styles.flex}>
                  <Button label={t("privacy.cancel")} variant="ghost" onPress={() => setEditing(null)} />
                </View>
              </View>
            </>
          ) : (
            <View style={styles.row}>
              <View style={styles.flex}>
                <Button label={t("privacy.fix")} variant="secondary" onPress={() => setEditing({ finding: f, text: f.text })} />
              </View>
              <View style={styles.flex}>
                <Button label={t("privacy.redact")} variant="secondary" onPress={() => redact(f)} />
              </View>
              <View style={styles.flex}>
                <Button label={t("privacy.keep")} variant="ghost" onPress={() => keep(f)} />
              </View>
            </View>
          )}
        </Card>
      ))}

      {hasPhotos || hasFiles ? (
        <Card>
          <Caption>{t("privacy.photosTitle")}</Caption>
          {hasPhotos ? (
            <>
              <Body dim>{t("privacy.photosMetadataOk")}</Body>
              {!images.faces.available ? (
                <Body dim>
                  {t(images.faces.reason === "web" ? "privacy.facesUnavailableWeb" : "privacy.facesUnavailableNotBuilt")}
                </Body>
              ) : null}
            </>
          ) : null}
          {hasFiles ? <Body dim>{t("compose.documentMetadataWarning")}</Body> : null}
        </Card>
      ) : null}
    </Screen>
  );
}

function severityColor(severity: LeakSeverity): string {
  return severity === "high" ? colors.danger : severity === "medium" ? colors.accent : colors.border;
}

function highlightStyle(severity: LeakSeverity) {
  return {
    backgroundColor: severity === "high" ? colors.dangerMuted : colors.accentMuted,
  };
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  bodyText: { color: colors.text, fontSize: 16, lineHeight: 24 },
  highlight: { color: colors.text, borderRadius: radius.sm },
  quote: { color: colors.text, fontSize: 16, paddingHorizontal: spacing.xs, alignSelf: "flex-start", borderRadius: radius.sm },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 90 },
});
