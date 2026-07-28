import React, { useState } from "react";
import { useRouter } from "expo-router";
import { useApp } from "../src/state/AppContext";
import { createIdentity } from "../src/identity";
import { Body, Button, Card, Screen, Title } from "../src/ui";
import { t } from "../src/i18n";

export default function OnboardingScreen() {
  const router = useRouter();
  const { identity, refreshIdentity } = useApp();
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createIdentity();
      await refreshIdentity();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Screen>
      <Title>{t("onboarding.title")}</Title>
      <Card>
        <Body>{t("onboarding.explainer")}</Body>
      </Card>

      {identity ? (
        <Card>
          <Body dim>{t("onboarding.yourCodename")}</Body>
          <Title>{identity.codename}</Title>
          <Button label={t("onboarding.continue")} onPress={() => router.replace("/")} />
        </Card>
      ) : (
        <Button
          label={creating ? t("onboarding.creating") : t("onboarding.createIdentity")}
          onPress={handleCreate}
          loading={creating}
        />
      )}
    </Screen>
  );
}
