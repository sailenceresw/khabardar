import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { ReportCategory, REPORT_CATEGORY_KEYS, type AnonymousReport, type EvidenceItem } from "@khabardar/shared";
import { useApp } from "../../src/state/AppContext";
import { pickAndSecurePhoto, deleteEvidence } from "../../src/evidence";
import { isValidCoarseGeohash, truncateGeohash } from "../../src/geo";
import { Body, Button, Card, Screen } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

const CATEGORIES = Object.values(ReportCategory).filter(
  (v): v is ReportCategory => typeof v === "number"
);

export default function ComposeScreen() {
  const router = useRouter();
  const { upsertReport } = useApp();

  const [category, setCategory] = useState<ReportCategory>(ReportCategory.Bribery);
  const [body, setBody] = useState("");
  const [geohash, setGeohash] = useState("");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function addPhoto() {
    setBusy(true);
    try {
      const item = await pickAndSecurePhoto();
      if (item) setEvidence((prev) => [...prev, item]);
    } catch (e) {
      const msg = t("common.error");
      Platform.OS === "web" ? window.alert(msg) : Alert.alert(msg);
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(item: EvidenceItem) {
    await deleteEvidence(item);
    setEvidence((prev) => prev.filter((e) => e.id !== item.id));
  }

  function buildReport(): AnonymousReport {
    return {
      id: `rep_${Date.now()}`,
      status: "draft",
      category,
      body: body.trim(),
      coarseGeohash: truncateGeohash(geohash.trim()),
      evidence,
      createdAt: Date.now(),
    };
  }

  const valid = body.trim().length >= 20 && (geohash.trim() === "" || isValidCoarseGeohash(geohash.trim()));

  async function saveDraft() {
    await upsertReport(buildReport());
    router.back();
  }

  async function goReview() {
    const report = buildReport();
    await upsertReport(report);
    router.push({ pathname: "/compose/review", params: { id: report.id } });
  }

  return (
    <Screen>
      <Card>
        <Body dim>{t("compose.categoryLabel")}</Body>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} onPress={() => setCategory(c)}>
              <View style={[styles.chip, category === c && styles.chipActive]}>
                <Text style={[styles.chipText, category === c && styles.chipTextActive]}>
                  {t(REPORT_CATEGORY_KEYS[c])}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Body dim>{t("compose.bodyLabel")}</Body>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={6}
          placeholder={t("compose.bodyPlaceholder")}
          placeholderTextColor={colors.textDim}
          value={body}
          onChangeText={setBody}
        />
      </Card>

      <Card>
        <Body dim>{t("compose.locationLabel")}</Body>
        <TextInput
          style={styles.input}
          placeholder={t("compose.locationPlaceholder")}
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          value={geohash}
          onChangeText={setGeohash}
          maxLength={4}
        />
        <Body dim>{t("compose.locationHelp")}</Body>
      </Card>

      <Card>
        <Body dim>{t("compose.evidenceLabel")}</Body>
        {evidence.map((item) => (
          <View key={item.id} style={styles.evidenceRow}>
            <Body>
              📷 {(item.sizeBytes / 1024).toFixed(0)} KB — {item.sha256.slice(0, 12)}…
            </Body>
            <Pressable onPress={() => removePhoto(item)}>
              <Text style={{ color: colors.danger }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Button label={t("compose.addPhoto")} onPress={addPhoto} variant="secondary" loading={busy} />
        <Body dim>{t("compose.evidenceNote")}</Body>
      </Card>

      <Button label={t("compose.saveDraft")} onPress={saveDraft} variant="secondary" disabled={!valid} />
      <Button label={t("compose.review")} onPress={goReview} disabled={!valid} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 14 },
  chipTextActive: { color: colors.accentText, fontWeight: "600" },
  textArea: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 15,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
  },
  evidenceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
