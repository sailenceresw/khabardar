import React from "react";
import { Body, Card, Screen } from "../src/ui";
import { t } from "../src/i18n";

export default function TipsScreen() {
  return (
    <Screen>
      <Card>
        <Body>{t("tips.stub")}</Body>
      </Card>
    </Screen>
  );
}
