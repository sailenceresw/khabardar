import React, { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
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
import {
  Body,
  Button,
  Card,
  Caption,
  Chip,
  Field,
  Notice,
  Screen,
  SectionHeader,
  Title,
} from "../src/ui";
import { colors, spacing } from "../src/theme";
import { t } from "../src/i18n";

const KINDS = Object.values(OrgKind);
const PLANS = Object.values(OrgPlan);

export default function OrgScreen() {
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
      setNote(e instanceof ExportNotEntitledError ? t("org.exportNotEntitled") : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const entitlements = entitlementsFor(org);

  return (
    <Screen>
      <Title>{t("org.title")}</Title>
      <Notice tone="info">{t("org.separationWarning")}</Notice>

      {!org ? (
        <Card>
          <Caption>{t("org.registerTitle")}</Caption>
          <Field
            placeholder={t("org.namePlaceholder")}
            value={name}
            onChangeText={setName}
          />
          <Field
            placeholder={t("org.emailPlaceholder")}
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
          />

          <Caption>{t("org.kindLabel")}</Caption>
          <View style={styles.chips}>
            {KINDS.map((k) => (
              <Chip key={k} label={t(ORG_KIND_KEYS[k])} active={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>

          <Caption>{t("org.planLabel")}</Caption>
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
          <Card style={{ borderColor: org.accredited ? colors.success : colors.border }}>
            <Caption>{t("org.signedInAs")}</Caption>
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
            <SectionHeader title={t("org.entitlements")} />
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
            <Caption>{t("org.exportTitle")}</Caption>
            <Body dim>{t("org.exportNote")}</Body>
            {note ? <Notice tone={note.includes("Exported") || note.includes("निर्यात") ? "success" : "warn"}>{note}</Notice> : null}
            <Button label={t("org.export")} onPress={doExport} loading={busy} variant="secondary" />
          </Card>

          <Notice tone="info">{t("org.devAccreditNote")}</Notice>
          <Button
            label={org.accredited ? t("org.devUnaccredit") : t("org.devAccredit")}
            variant="secondary"
            onPress={async () => {
              await devSetAccredited(!org.accredited);
              await load();
            }}
          />

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

      <SectionHeader title={t("org.poolsTitle")} />
      <Card>
        {pools.map((p) => (
          <View key={p.id} style={styles.poolRow}>
            <Body>{p.displayName}</Body>
            <Caption>
              {t("org.poolScope", { region: p.regionPrefix || t("org.nationwide") })} ·{" "}
              {t("org.poolFunded", { count: p.fundedCount })}
            </Caption>
            <Caption>
              ${p.spentUsd.toFixed(2)} / ${p.budgetUsd.toFixed(2)} ·{" "}
              {t("org.poolRemaining", { count: estimatedRemainingReports(p) })}
            </Caption>
          </View>
        ))}
        <Body dim>{t("org.poolsAttributionNote")}</Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  poolRow: { gap: 2, marginBottom: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
});
