import React from "react";
import { Body, Card, Screen } from "../src/ui";
import { t } from "../src/i18n";

export default function ModerationScreen() {
  return (
    <Screen>
      <Card>
        <Body>{t("moderation.stub")}</Body>
      </Card>
    </Screen>
  );
}
