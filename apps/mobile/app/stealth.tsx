import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import * as ScreenCapture from "expo-screen-capture";
import {
  applyLauncherDisguise,
  DisguiseMode,
  getStealthConfig,
  MIN_PIN_LENGTH,
  saveStealthConfig,
  setDuressPin,
  setUnlockPin,
  StealthPinRejected,
  type StealthConfig,
} from "../src/stealth";
import { Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

const DISGUISES: Array<{ mode: DisguiseMode; key: string }> = [
  { mode: DisguiseMode.None, key: "stealth.disguiseNone" },
  { mode: DisguiseMode.Calculator, key: "stealth.disguiseCalculator" },
  { mode: DisguiseMode.Notes, key: "stealth.disguiseNotes" },
];

export default function StealthScreen() {
  const router = useRouter();
  const [config, setConfig] = useState<StealthConfig | null>(null);
  const [pin, setPin] = useState("");
  const [duress, setDuress] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => setConfig(await getStealthConfig()), []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  function report(e: unknown) {
    setNote(null);
    setError(
      e instanceof StealthPinRejected
        ? t(
            e.code === "too-short"
              ? "stealth.pinTooShort"
              : e.code === "too-simple"
                ? "stealth.pinTooSimple"
                : "stealth.pinDuressMatchesReal"
          )
        : t("common.error")
    );
  }

  async function savePin() {
    try {
      await setUnlockPin(pin);
      setPin("");
      setError(null);
      setNote(t("stealth.saved"));
      await load();
    } catch (e) {
      report(e);
    }
  }

  async function saveDuress() {
    try {
      await setDuressPin(duress);
      setDuress("");
      setError(null);
      setNote(t("stealth.saved"));
      await load();
    } catch (e) {
      report(e);
    }
  }

  async function chooseDisguise(mode: DisguiseMode) {
    const previous = config?.disguise ?? DisguiseMode.None;
    const applied = await applyLauncherDisguise(mode);
    setConfig(await saveStealthConfig({ disguise: mode }));
    setError(null);
    // `applied` only reports the home-screen icon, which is Android-only; the
    // in-app disguise is saved either way. Keying the note off it alone told
    // anyone who picked None on iOS or web — where it is always false — that
    // "the lock-screen disguise is on", moments after they turned it off.
    if (applied) setNote(t("stealth.saved"));
    else if (mode !== DisguiseMode.None) setNote(t("stealth.launcherUnchanged"));
    else if (previous !== DisguiseMode.None) setNote(t("stealth.launcherResetFailed"));
    else setNote(t("stealth.saved"));
  }

  async function toggleCapture() {
    if (!config) return;
    const next = !config.blockScreenCapture;
    setConfig(await saveStealthConfig({ blockScreenCapture: next }));
    try {
      if (next) await ScreenCapture.preventScreenCaptureAsync();
      else await ScreenCapture.allowScreenCaptureAsync();
    } catch {
      // Unsupported on this platform; the preference is still recorded.
    }
  }

  if (!config) {
    return (
      <Screen scroll={false}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
          <Body dim>{t("common.loading")}</Body>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>{t("stealth.title")}</Title>

      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("stealth.intro")}</Body>
        <Body dim>{t("stealth.launcherLimit")}</Body>
      </Card>

      {error ? (
        <Card style={{ borderColor: colors.danger }}>
          <Body>{error}</Body>
        </Card>
      ) : null}
      {note ? <Card><Body dim>{note}</Body></Card> : null}

      <Card>
        <Body dim>{t("stealth.lockTitle")}</Body>
        <Body dim>{t("stealth.lockExplainer")}</Body>
        <TextInput
          style={styles.input}
          placeholder={t("stealth.pinPlaceholder")}
          placeholderTextColor={colors.textDim}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={12}
          value={pin}
          onChangeText={setPin}
        />
        <Button
          label={t("stealth.setPin")}
          onPress={savePin}
          disabled={pin.length < MIN_PIN_LENGTH}
          variant="secondary"
        />
      </Card>

      <Card style={{ borderColor: colors.danger }}>
        <Body dim>{t("stealth.duressTitle")}</Body>
        <Body>{t("stealth.duressExplainer")}</Body>
        <TextInput
          style={styles.input}
          placeholder={t("stealth.pinPlaceholder")}
          placeholderTextColor={colors.textDim}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={12}
          value={duress}
          onChangeText={setDuress}
        />
        <Button
          label={t("stealth.setDuress")}
          onPress={saveDuress}
          disabled={duress.length < MIN_PIN_LENGTH}
          variant="danger"
        />
        {config.duressConfigured ? <Body dim>{t("stealth.duressSet")}</Body> : null}
      </Card>

      <Card>
        <Body dim>{t("stealth.disguiseTitle")}</Body>
        <Body dim>{t("stealth.disguiseExplainer")}</Body>
        <View style={styles.chips}>
          {DISGUISES.map((d) => (
            <Pressable key={d.mode} onPress={() => chooseDisguise(d.mode)}>
              <View style={[styles.chip, config.disguise === d.mode && styles.chipActive]}>
                <Text
                  style={[styles.chipText, config.disguise === d.mode && styles.chipTextActive]}
                >
                  {t(d.key)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card>
        <Body dim>{t("stealth.captureTitle")}</Body>
        <Body dim>{t("stealth.captureExplainer")}</Body>
        <Button
          label={config.blockScreenCapture ? "✅ " + t("stealth.captureTitle") : t("stealth.captureTitle")}
          onPress={toggleCapture}
          variant="secondary"
        />
      </Card>

      <Button label={t("common.back")} onPress={() => router.back()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
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
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: 18,
    letterSpacing: 4,
  },
});
