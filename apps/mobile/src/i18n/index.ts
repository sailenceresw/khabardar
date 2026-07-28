import { I18n } from "i18n-js";
import * as Localization from "expo-localization";
import en from "./en.json";
import hi from "./hi.json";

export const i18n = new I18n({ en, hi });

i18n.enableFallback = true;
i18n.defaultLocale = "en";

const deviceLang = Localization.getLocales()[0]?.languageCode;
i18n.locale = deviceLang === "hi" ? "hi" : "en";

export function setLocale(locale: "en" | "hi") {
  i18n.locale = locale;
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}
