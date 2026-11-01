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
  /** Non-null when device storage could not be read. See refreshIdentity. */
  storageError: string | null;
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
  const [storageError, setStorageError] = useState<string | null>(null);
  const [reports, setReports] = useState<AnonymousReport[]>([]);
  const [queue, setQueue] = useState<QueuedSubmission[]>([]);
  const [flushing, setFlushing] = useState(false);
  const [locale, setLocaleState] = useState<"en" | "hi">(i18n.locale === "hi" ? "hi" : "en");

  /**
   * Load the identity, and always mark the attempt finished.
   *
   * The `finally` is load-bearing. `identityLoaded` is what the home screen
   * waits on before it renders anything, so if a read throws and the flag stays
   * false the user is left looking at an empty screen with no error and no way
   * forward. That is not hypothetical: on web these reads go to `localStorage`,
   * which throws outright in private browsing and wherever the browser has
   * storage blocked.
   */
  const refreshIdentity = useCallback(async () => {
    try {
      setIdentity(await getIdentity());
      setStorageError(null);
    } catch (e) {
      setIdentity(null);
      setStorageError(e instanceof Error ? e.message : String(e));
    } finally {
      setIdentityLoaded(true);
    }
  }, []);

  const refreshReports = useCallback(async () => {
    try {
      setReports(await loadAllReports());
      setQueue(await readQueue());
    } catch {
      // Reports failing to load is recoverable — the user can still compose and
      // reach settings — so leave whatever was already on screen. Do not write
      // this into `storageError`: the home screen treats that as "identity
      // unreadable" and would replace the whole page with a dead end.
    }
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
    } catch {
      // A failed flush leaves items in the queue, which the home screen
      // already shows. This is a network/relayer miss, not unreadable storage.
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
      storageError,
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
      storageError,
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
