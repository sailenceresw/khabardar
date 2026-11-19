import React, { useEffect, useState } from "react";
import { demoRecipientsEnabled } from "./content/recipients";
import {
  clearOrgRecipientKey,
  DEMO_NEWSROOM_PRIVATE_KEY,
  loadOrgRecipientKey,
  RecipientKeyNotRecognised,
  saveOrgRecipientKey,
  type OrgRecipientKey,
} from "./orgRecipientKey";
import { Body, Button, Caption, Card, Field, Mono, Notice } from "./ui";
import { t } from "./i18n";

/**
 * Lets a signed-in organisation store the recipient key that opens restricted
 * reports sealed to it. The key is pasted, checked against the pinned
 * recipients, and kept on this device only. Nothing here is sent anywhere.
 */
export function RecipientKeyCard() {
  const [current, setCurrent] = useState<OrgRecipientKey | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOrgRecipientKey().then(setCurrent);
  }, []);

  async function save(value: string) {
    setError(null);
    try {
      setCurrent(await saveOrgRecipientKey(value));
      setInput("");
    } catch (e) {
      setError(e instanceof RecipientKeyNotRecognised ? t("orgKey.notRecognised") : t("common.error"));
    }
  }

  async function remove() {
    await clearOrgRecipientKey();
    setCurrent(null);
  }

  return (
    <Card>
      <Body dim>{t("orgKey.title")}</Body>
      <Body dim>{t("orgKey.explainer")}</Body>
      {current ? (
        <>
          <Notice tone="success">{t("orgKey.active", { name: current.recipient.name })}</Notice>
          <Caption>{t("orgKey.fingerprint")}</Caption>
          <Mono>{current.fingerprint}</Mono>
          {current.recipient.demo !== false ? <Notice tone="warn">{t("orgKey.demoWarning")}</Notice> : null}
          <Button label={t("orgKey.remove")} variant="secondary" onPress={remove} />
        </>
      ) : (
        <>
          <Field
            label={t("orgKey.inputLabel")}
            placeholder={t("orgKey.inputPlaceholder")}
            value={input}
            onChangeText={setInput}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            error={error ?? undefined}
          />
          <Button label={t("orgKey.save")} onPress={() => save(input)} disabled={!input.trim()} />
          {demoRecipientsEnabled() ? (
            <Button label={t("orgKey.useDemo")} variant="ghost" onPress={() => save(DEMO_NEWSROOM_PRIVATE_KEY)} />
          ) : null}
        </>
      )}
    </Card>
  );
}
