import React, { useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Title } from "./ui";
import { colors, spacing } from "./theme";
import { t } from "./i18n";

/**
 * Interstitial shown on the web build only, before anything else.
 *
 * ## Why this is a gate and not a banner
 *
 * The web build looks identical to the real app and is not the real app. Three
 * of its guarantees are simply absent:
 *
 *  - **Keys live in `localStorage`.** The identity private key, the at-rest
 *    encryption keys, and the stealth PINs all fall back to `localStorage`
 *    because there is no Keychain or Keystore in a browser. Any XSS, any
 *    browser extension with host permissions, and anyone with access to the
 *    browser profile can read them. On a phone these sit in hardware-backed
 *    storage; here they are plain strings in a directory on disk.
 *  - **There is no Tor.** A browser cannot load the native module, so every
 *    request goes out from the visitor's real IP.
 *  - **Panic delete cannot reach what it promises to.** It clears
 *    `localStorage`, but there is no keystore to purge and no guarantee the
 *    browser has not already written those values into a profile backup or a
 *    synced session.
 *
 * A dismissible banner is the wrong shape for that. Someone who lands on a
 * public URL for "anonymous corruption reporting" and starts typing has already
 * made the decision the banner was meant to inform; the cost of them being
 * wrong is the exact harm this project exists to prevent. So the web build
 * stops and requires one deliberate acknowledgement, the same pattern the
 * WalletConnect screen uses for the same reason.
 *
 * Rendered on native as a no-op — nothing here applies to a real build.
 */
export function WebDemoGate({ children }: { children: React.ReactNode }) {
  // Evaluated once at module scope on native, so the gate compiles out to a
  // passthrough rather than holding state the platform will never use.
  const [acknowledged, setAcknowledged] = useState(Platform.OS !== "web");

  if (acknowledged) return <>{children}</>;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card style={{ borderColor: colors.danger }}>
        <Title>{t("webDemo.title")}</Title>
        <Body>{t("webDemo.intro")}</Body>
      </Card>

      <Card>
        <Body dim>{t("webDemo.missingTitle")}</Body>
        <View style={styles.bullets}>
          <Body>• {t("webDemo.missingKeys")}</Body>
          <Body>• {t("webDemo.missingTor")}</Body>
          <Body>• {t("webDemo.missingWipe")}</Body>
        </View>
      </Card>

      <Card style={{ borderColor: colors.danger }}>
        <Body>{t("webDemo.doNotUse")}</Body>
      </Card>

      <Card>
        <Body dim>{t("webDemo.whereReal")}</Body>
      </Card>

      <Button label={t("webDemo.acknowledge")} onPress={() => setAcknowledged(true)} />

      <Text style={styles.footnote}>{t("webDemo.footnote")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl * 2, maxWidth: 680, alignSelf: "center", width: "100%" },
  bullets: { gap: spacing.sm, marginTop: spacing.xs },
  footnote: { color: colors.textDim, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
});
