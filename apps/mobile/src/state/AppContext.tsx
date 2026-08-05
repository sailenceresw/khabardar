import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState as RNAppState, type AppStateStatus } from "react-native";
import type { AnonymousReport, ReporterIdentity } from "@khabardar/shared";
import { getIdentity } from "../identity";
import { loadAllReports, saveReport, deleteReport } from "../drafts";
import { flushQueue, readQueue, type QueuedSubmission } from "../submissionQueue";
import { i18n, setLocale } from "../i18n";

interface AppState {
  identity: ReporterIdentity | null;
  identityLoaded: boolean;
  reports: AnonymousReport[];
  /** Submissions waiting to be anchored, e.g. after a dropped connection. */
  queue: QueuedSubmission[];
  flushing: boolean;
  locale: "en" | "hi";
  refreshIdentity: () => Promise<void>;
  refreshReports: () => Promise<void>;
  retryQueued: () => Promise<void>;
  upsertReport: (report: AnonymousReport) => Promise<void>;
  removeReport: (id: string) => Promise<void>;
  switchLocale: (locale: "en" | "hi") => void;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<ReporterIdentity | null>(null);
  const [identityLoaded, setIdentityLoaded] = useState(false);
  const [reports, setReports] = useState<AnonymousReport[]>([]);
  const [queue, setQueue] = useState<QueuedSubmission[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [locale, setLocaleState] = useState<"en" | "hi">(i18n.locale === "hi" ? "hi" : "en");

  const refreshIdentity = useCallback(async () => {
    setIdentity(await getIdentity());
    setIdentityLoaded(true);
  }, []);

  const refreshReports = useCallback(async () => {
    setReports(await loadAllReports());
    setQueue(await readQueue());
  }, []);

  const flushingRef = useRef(false);

  /**
   * Drain the retry queue. Guarded by a ref rather than the `flushing` state so
   * a resume event that lands mid-flush cannot start a second pass and submit
   * the same report twice.
   */
  const retryQueued = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setFlushing(true);
    try {
      await flushQueue();
      await refreshReports();
    } finally {
      flushingRef.current = false;
      setFlushing(false);
    }
  }, [refreshReports]);

  /**
   * Retry on foreground only — never on a background timer.
   *
   * A queue that fires whenever the OS wakes the app would submit from a
   * network and a place the reporter did not choose. When their IP touches the
   * relayer is their decision, so retries happen while they are looking at it.
   */
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active") retryQueued();
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [retryQueued]);

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
      queue,
      flushing,
      locale,
      refreshIdentity,
      refreshReports,
      retryQueued,
      upsertReport,
      removeReport,
      switchLocale,
    }),
    [
      identity,
      identityLoaded,
      reports,
      queue,
      flushing,
      locale,
      refreshIdentity,
      refreshReports,
      retryQueued,
      upsertReport,
      removeReport,
      switchLocale,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp outside AppProvider");
  return ctx;
}
