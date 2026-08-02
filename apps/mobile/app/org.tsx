import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ORG_KIND_KEYS,
  ORG_PLAN_KEYS,
  OrgKind,
  OrgPlan,
  PLAN_PRICE_USD_MONTH,
  entitlementsFor,
  estimatedRemainingReports,
  type Organization,
  type SponsorPool,
} from "@khabardar/shared";
import { devSetAccredited, getOrg, registerOrg, signOutOrg } from "../src/org";
import { listPools } from "../src/sponsorPools";
import { getNetworkIndex, resolveFeedReports } from "../src/feed";
import { exportCsv, ExportNotEntitledError } from "../src/export";
import { Body, Button, Card, Screen, Title } from "../src/ui";
import { colors, radius, spacing } from "../src/theme";
import { t } from "../src/i18n";

const KINDS = Object.values(OrgKind);
const PLANS = Object.values(OrgPlan);

export default function OrgScreen() {
  const router = useRouter();
  const [org, setOrg] = useState<Organization | null>(null);
  const [pools, setPools] = useState<SponsorPool[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState<OrgKind>(OrgKind.Newsroom);
  const [plan, setPlan] = useState<OrgPlan>(OrgPlan.Community);

  const load = useCallback(async () => {
    const [o, p] = await Promise.all([getOrg(), listPools()]);
    setOrg(o);
    setPools(p);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  async function register() {
    if (!name.trim() || !email.trim()) return;
    setBusy(true);
    try {
      await registerOrg({ name, kind, plan, contactEmail: email });
      setName("");
      setEmail("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    setBusy(true);
    setNote(null);
    try {
      const rows = await getNetworkIndex().list();
      const csv = await exportCsv(await resolveFeedReports(rows));
      const lines = csv.split("\n").length - 1;
      setNote(t("org.exportDone", { count: lines }));
    } catch (e) {
      setNote(
        e instanceof ExportNotEntitledError ? t("org.exportNotEntitled") : t("common.error")
      );
    } finally {
      setBusy(false);
    }
  }

  const entitlements = entitlementsFor(org);

  return (
    <Screen>
      <Title>{t("org.title")}</Title>

      <Card style={{ borderColor: colors.info }}>
        <Body dim>{t("org.separationWarning")}</Body>
      </Card>

      {!org ? (
        <Card>
          <Body dim>{t("org.registerTitle")}</Body>
          <TextInput
            style={styles.input}
            placeholder={t("org.namePlaceholder")}
            placeholderTextColor={colors.textDim}
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder={t("org.emailPlaceholder")}
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Body dim>{t("org.kindLabel")}</Body>
          <View style={styles.chips}>
            {KINDS.map((k) => (
              <Chip key={k} label={t(ORG_KIND_KEYS[k])} active={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>

          <Body dim>{t("org.planLabel")}</Body>
          <View style={styles.chips}>
            {PLANS.map((p) => (
              <Chip
                key={p}
                label={`${t(ORG_PLAN_KEYS[p])} — ${
                  PLAN_PRICE_USD_MONTH[p] === 0 ? t("org.free") : `$${PLAN_PRICE_USD_MONTH[p]}/mo`
                }`}
                active={plan === p}
                onPress={() => setPlan(p)}
              />
            ))}
          </View>

          <Button label={t("org.register")} onPress={register} loading={busy} />
        </Card>
      ) : (
        <>
          <Card>
            <Body dim>{t("org.signedInAs")}</Body>
            <Title>{org.name}</Title>
            <Body dim>
              {t(ORG_KIND_KEYS[org.kind])} · {t(ORG_PLAN_KEYS[org.plan])}
            </Body>
            <Body dim>
              {org.accredited ? `✅ ${t("org.accredited")}` : `⏳ ${t("org.pendingAccreditation")}`}
            </Body>
            {!org.accredited ? <Body dim>{t("org.accreditationNote")}</Body> : null}
          </Card>

          <Card>
            <Body dim>{t("org.entitlements")}</Body>
            <Body>
              {t("org.seats")}: {entitlements.seats}
            </Body>
            <Body>
              {t("org.apiCalls")}: {entitlements.api ? entitlements.apiCallsPerDay : "—"}
            </Body>
            <Body>
              {t("org.exportFeature")}: {entitlements.export ? "✅" : "—"}
            </Body>
            <Body>
              {t("org.analyticsFeature")}: {entitlements.analytics ? "✅" : "—"}
            </Body>
            <Body>
              {t("org.caseFeature")}: {entitlements.caseManagement ? "✅" : "—"}
            </Body>
          </Card>

          <Card>
            <Body dim>{t("org.exportTitle")}</Body>
            <Body dim>{t("org.exportNote")}</Body>
            {note ? <Body>{note}</Body> : null}
            <Button label={t("org.export")} onPress={doExport} loading={busy} variant="secondary" />
          </Card>

          <Card style={{ borderColor: colors.info }}>
            <Body dim>{t("org.devAccreditNote")}</Body>
            <Button
              label={org.accredited ? t("org.devUnaccredit") : t("org.devAccredit")}
              variant="secondary"
              onPress={async () => {
                await devSetAccredited(!org.accredited);
                await load();
              }}
            />
          </Card>

          <Button
            label={t("org.signOut")}
            variant="danger"
            onPress={async () => {
              await signOutOrg();
              await load();
            }}
          />
        </>
      )}

      <Card>
        <Body dim>{t("org.poolsTitle")}</Body>
        {pools.map((p) => (
          <View key={p.id} style={styles.poolRow}>
            <Body>{p.displayName}</Body>
            <Body dim>
              {t("org.poolScope", { region: p.regionPrefix || t("org.nationwide") })} ·{" "}
              {t("org.poolFunded", { count: p.fundedCount })}
            </Body>
            <Body dim>
              ${p.spentUsd.toFixed(2)} / ${p.budgetUsd.toFixed(2)} ·{" "}
              {t("org.poolRemaining", { count: estimatedRemainingReports(p) })}
            </Body>
          </View>
        ))}
        <Body dim>{t("org.poolsAttributionNote")}</Body>
      </Card>

      <Pressable onPress={() => router.push("/")}>
        <Text style={styles.link}>{t("feed.backHome")}</Text>
      </Pressable>
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
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
    marginBottom: spacing.sm,
  },
  poolRow: { gap: 2, marginBottom: spacing.sm },
  link: { color: colors.info, fontSize: 15, fontWeight: "600", textAlign: "center" },
});
