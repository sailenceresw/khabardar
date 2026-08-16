import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import {
  ReportCategory,
  REPORT_CATEGORY_KEYS,
  VISIBILITY_KEYS,
  Visibility,
  type AnonymousReport,
  type EvidenceItem,
} from "@khabardar/shared";
import { useApp } from "../../src/state/AppContext";
import { pickAndSecurePhoto, deleteEvidence } from "../../src/evidence";
import { isValidCoarseGeohash, truncateGeohash } from "../../src/geo";
import { Body, Button, Card, Chip, Screen } from "../../src/ui";
import { colors, radius, spacing } from "../../src/theme";
import { t } from "../../src/i18n";

const CATEGORIES = Object.values(ReportCategory).filter(
  (v): v is ReportCategory => typeof v === "number"
);

const MIN_BODY = 20;

export default function ComposeScreen() {
  const router = useRouter();
  const { upsertReport } = useApp();

  const [category, setCategory] = useState<ReportCategory>(ReportCategory.Bribery);
  const [visibility, setVisibility] = useState<Visibility>(Visibility.Public);
  const [body, setBody] = useState("");
  const [entityName, setEntityName] = useState("");
  const [geohash, setGeohash] = useState("");
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [busy, setBusy] = useState(false);

  async function addPhoto() {
    setBusy(true);
    try {
      const item = await pickAndSecurePhoto();
      if (item) setEvidence((prev) => [...prev, item]);
    } catch {
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
      visibility,
      entityName: entityName.trim() || undefined,
    };
  }

  const bodyLen = body.trim().length;
  const bodyOk = bodyLen >= MIN_BODY;
  const geoOk = geohash.trim() === "" || isValidCoarseGeohash(geohash.trim());
  const valid = bodyOk && geoOk;

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
            <Chip
              key={c}
              label={t(REPORT_CATEGORY_KEYS[c])}
              active={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>
      </Card>

      <Card>
        <Body dim>{t("compose.visibilityLabel")}</Body>
        <View style={styles.chips}>
          {[Visibility.Public, Visibility.JournalistsOnly].map((v) => (
            <Chip
              key={v}
              label={t(VISIBILITY_KEYS[v])}
              active={visibility === v}
              onPress={() => setVisibility(v)}
            />
          ))}
        </View>
        <Body dim>
          {visibility === Visibility.Public
            ? t("compose.visibilityPublicHelp")
            : t("compose.visibilityJournalistsHelp")}
        </Body>
      </Card>

      <Card>
        <View style={styles.labelRow}>
          <Body dim>{t("compose.bodyLabel")}</Body>
          <Text style={[styles.counter, bodyOk ? styles.counterOk : styles.counterWarn]}>
            {bodyLen}/{MIN_BODY}
          </Text>
        </View>
        <TextInput
          style={styles.textArea}
          multiline
          numberOfLines={6}
          placeholder={t("compose.bodyPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={body}
          onChangeText={setBody}
        />
        {!bodyOk && bodyLen > 0 ? (
          <Text style={styles.hint}>{t("compose.bodyMin", { min: MIN_BODY })}</Text>
        ) : null}
      </Card>

      <Card>
        <Body dim>{t("compose.entityLabel")}</Body>
        <TextInput
          style={styles.input}
          placeholder={t("compose.entityPlaceholder")}
          placeholderTextColor={colors.textMuted}
          value={entityName}
          onChangeText={setEntityName}
        />
        <Body dim>{t("compose.entityHelp")}</Body>
      </Card>

      <Card>
        <Body dim>{t("compose.locationLabel")}</Body>
        <TextInput
          style={styles.input}
          placeholder={t("compose.locationPlaceholder")}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          value={geohash}
          onChangeText={setGeohash}
          maxLength={4}
        />
        <Body dim>{t("compose.locationHelp")}</Body>
        {!geoOk ? <Text style={styles.hint}>{t("compose.locationInvalid")}</Text> : null}
      </Card>

      <Card>
        <Body dim>
          {t("compose.evidenceLabel")}
          {evidence.length > 0 ? ` · ${evidence.length}` : ""}
        </Body>
        {evidence.map((item) => (
          <View key={item.id} style={styles.evidenceRow}>
            <Body>
              📷 {(item.sizeBytes / 1024).toFixed(0)} KB — {item.sha256.slice(0, 12)}…
            </Body>
            <Pressable onPress={() => removePhoto(item)} hitSlop={8}>
              <Text style={{ color: colors.danger, fontWeight: "700" }}>✕</Text>
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
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  counter: { fontSize: 12, fontWeight: "600" },
  counterOk: { color: colors.success },
  counterWarn: { color: colors.textDim },
  hint: { color: colors.danger, fontSize: 12 },
  textArea: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 120,
    textAlignVertical: "top",
    fontSize: 15,
  },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    fontSize: 15,
  },
  evidenceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
