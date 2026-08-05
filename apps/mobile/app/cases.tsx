import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  addNote,
  CASE_OUTCOME_KEYS,
  CASE_STATUS_KEYS,
  CaseOutcome,
  CaseStatus,
  CasesNotEntitledError,
  createCase,
  deleteCase,
  listCases,
  outcomeSummary,
  updateCase,
  type InvestigationCase,
  type OutcomeSummary,
} from "../src/cases";
import { Badge, Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

const STATUSES = Object.values(CaseStatus);
const OUTCOMES = Object.values(CaseOutcome);

export default function CasesScreen() {
  const router = useRouter();
  const [cases, setCases] = useState<InvestigationCase[]>([]);
  const [summary, setSummary] = useState<OutcomeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [closeReasons, setCloseReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      setCases(await listCases());
      setSummary(await outcomeSummary());
    } catch (e) {
      setCases([]);
      setError(e instanceof CasesNotEntitledError ? t("cases.notEntitled") : t("common.error"));
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function add() {
    if (!title.trim()) return;
    try {
      await createCase({ title });
      setTitle("");
      await load();
    } catch {
      setError(t("common.error"));
    }
  }

  async function setStatus(c: InvestigationCase, status: CaseStatus) {
    try {
      // Closing requires a reason — the model rejects it otherwise, so ask
      // rather than letting the write fail with a raw error.
      const reason = closeReasons[c.id]?.trim();
      if (status === CaseStatus.Closed && !reason) {
        setError(t("cases.closeReasonRequired"));
        return;
      }
      await updateCase(c.id, { status, ...(reason ? { closedReason: reason } : {}) });
      await load();
    } catch {
      setError(t("common.error"));
    }
  }

  async function setOutcome(c: InvestigationCase, outcome: CaseOutcome) {
    await updateCase(c.id, { outcome });
    await load();
  }

  async function note(c: InvestigationCase) {
    const body = notes[c.id]?.trim();
    if (!body) return;
    await addNote(c.id, body);
    setNotes((p) => ({ ...p, [c.id]: "" }));
    await load();
  }

  return (
    <Screen>
      <Title>{t("cases.title")}</Title>

      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("cases.intro")}</Body>
        <Body dim>{t("cases.noIdentifiersWarning")}</Body>
      </Card>

      {error ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{error}</Body>
        </Card>
      ) : null}

      {summary && summary.total > 0 ? (
        <Card>
          <Body dim>{t("cases.outcomesTitle")}</Body>
          <Title>{(summary.actionRate * 100).toFixed(0)}%</Title>
          <Body dim>{t("cases.actionRate")}</Body>
          <View style={styles.chips}>
            {summary.byOutcome
              .filter((o) => o.outcome !== CaseOutcome.None)
              .map((o) => (
                <Badge
                  key={o.outcome}
                  label={`${t(CASE_OUTCOME_KEYS[o.outcome])}: ${o.count}`}
                  tone="info"
                />
              ))}
          </View>
        </Card>
      ) : null}

      {!error ? (
        <Card>
          <Body dim>{t("cases.newCase")}</Body>
          <TextInput
            style={styles.input}
            placeholder={t("cases.titlePlaceholder")}
            placeholderTextColor={colors.textDim}
            value={title}
            onChangeText={setTitle}
          />
          <Button label={t("cases.create")} onPress={add} disabled={!title.trim()} />
        </Card>
      ) : null}

      {cases.length === 0 && !error ? (
        <Card>
          <Body dim>{t("cases.empty")}</Body>
        </Card>
      ) : null}

      {cases.map((c) => (
        <Card key={c.id}>
          <View style={styles.row}>
            <Body>{c.title}</Body>
            <Badge label={t(CASE_STATUS_KEYS[c.status])} tone="info" />
          </View>

          <Body dim>{t("cases.reportCount", { count: c.reportIds.length })}</Body>

          <Body dim>{t("cases.statusLabel")}</Body>
          <View style={styles.chips}>
            {STATUSES.map((s) => (
              <Chip
                key={s}
                label={t(CASE_STATUS_KEYS[s])}
                active={c.status === s}
                onPress={() => setStatus(c, s)}
              />
            ))}
          </View>

          {c.status === CaseStatus.Closed || closeReasons[c.id] !== undefined ? (
            <TextInput
              style={styles.input}
              placeholder={t("cases.closeReasonPlaceholder")}
              placeholderTextColor={colors.textDim}
              value={closeReasons[c.id] ?? c.closedReason ?? ""}
              onChangeText={(v) => setCloseReasons((p) => ({ ...p, [c.id]: v }))}
            />
          ) : null}

          <Body dim>{t("cases.outcomeLabel")}</Body>
          <View style={styles.chips}>
            {OUTCOMES.map((o) => (
              <Chip
                key={o}
                label={t(CASE_OUTCOME_KEYS[o])}
                active={c.outcome === o}
                onPress={() => setOutcome(c, o)}
              />
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder={t("cases.notePlaceholder")}
            placeholderTextColor={colors.textDim}
            multiline
            value={notes[c.id] ?? ""}
            onChangeText={(v) => setNotes((p) => ({ ...p, [c.id]: v }))}
          />
          <Button label={t("cases.addNote")} onPress={() => note(c)} variant="secondary" />

          {c.notes.slice(0, 5).map((n) => (
            <Body key={n.id} dim>
              {new Date(n.at).toLocaleDateString()} — {n.body}
            </Body>
          ))}

          <Button
            label={t("cases.delete")}
            variant="danger"
            onPress={async () => {
              await deleteCase(c.id);
              await load();
            }}
          />
        </Card>
      ))}

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={[styles.chip, active && styles.chipActive]}>
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
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
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 15,
  },
});
