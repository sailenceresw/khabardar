import { I18n } from "i18n-js";
import * as Localization from "expo-localization";
import en from "./en.json";
import hi from "./hi.json";
import ne from "./ne.json";

export type Locale = "en" | "hi" | "ne";
export const LOCALES: readonly Locale[] = ["en", "hi", "ne"];

// Nepali is partial for now: the privacy check is fully translated and every
// other key falls back to English through `enableFallback`. scripts/check-i18n.mjs
// enforces which sections Nepali must cover.
export const i18n = new I18n({ en, hi, ne });

i18n.enableFallback = true;
i18n.defaultLocale = "en";

const deviceLang = Localization.getLocales()[0]?.languageCode;
i18n.locale = LOCALES.includes(deviceLang as Locale) ? (deviceLang as Locale) : "en";

export function setLocale(locale: Locale) {
  i18n.locale = locale;
}

export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}
