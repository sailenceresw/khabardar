import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AnonymousReport, ReporterIdentity } from "@khabardar/shared";
import { getIdentity } from "../identity";
import { loadAllReports, saveReport, deleteReport } from "../drafts";
import { i18n, setLocale } from "../i18n";

interface AppState {
  identity: ReporterIdentity | null;
  identityLoaded: boolean;
  reports: AnonymousReport[];
  locale: "en" | "hi";
  refreshIdentity: () => Promise<void>;
  refreshReports: () => Promise<void>;
  upsertReport: (report: AnonymousReport) => Promise<void>;
  removeReport: (id: string) => Promise<void>;
  switchLocale: (locale: "en" | "hi") => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<ReporterIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [reports, setReports] = useState<AnonymousReport[]>([]);
  const [locale, setLocaleState] = useState<"en" | "hi">(i18n.locale === "hi" ? "hi" : "en");

  const refreshIdentity = useCallback(async () => {
    setIdentity(await getIdentity());
    setIdentityLoaded(true);
  }, []);

  const refreshReports = useCallback(async () => {
    setReports(await loadAllReports());
  }, []);

  const upsertReport = useCallback(
    async (report: AnonymousReport) => {
      await saveReport(report);
      await refreshReports();
    },
    [refreshReports]
  );

  const removeReport = useCallback(
    async (id: string) => {
      await deleteReport(id);
      await refreshReports();
    },
    [refreshReports]
  );

  const switchLocale = useCallback((next: "en" | "hi") => {
    setLocale(next);
    setLocaleState(next);
  }, []);

  useEffect(() => {
    refreshIdentity();
    refreshReports();
  }, [refreshIdentity, refreshReports]);

  const value = useMemo(
    () => ({
      identity,
      identityLoaded,
      reports,
      locale,
      refreshIdentity,
      refreshReports,
      upsertReport,
      removeReport,
      switchLocale,
    }),
    [identity, identityLoaded, reports, locale, refreshIdentity, refreshReports, upsertReport, removeReport, switchLocale]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
