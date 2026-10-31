import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { panicDelete } from "./panic";
import {
  attemptUnlock,
  DisguiseMode,
  getStealthConfig,
  isLockConfigured,
  type StealthConfig,
} from "./stealth";
import { colors, radius, spacing } from "./theme";
import { t } from "./i18n";

/**
 * Gate that stands between app launch and the real UI when a PIN is set.
 *
 * The interesting case is not the correct PIN — it is the duress PIN. On duress
 * this wipes everything and then renders the app as if nothing happened, with
 * no error, no confirmation, and no visible difference from a genuine first
 * launch. Anything that acknowledged the wipe would tell the person holding the
 * phone that a wipe is what just occurred, which is the one thing that must not
 * happen.
 *
 * A wrong PIN is deliberately indistinguishable from a duress PIN from the
 * outside: both clear the entry and say nothing useful.
 */
export function LockGate({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<StealthConfig | null>(null);
  const [locked, setLocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const [cfg, configured] = await Promise.all([getStealthConfig(), isLockConfigured()]);
        if (!active) return;
        setConfig(cfg);
        setLocked(cfg.lockEnabled && configured);
        setFailure(null);
      } catch (e) {
        // Deliberately not falling through to the app.
        //
        // If the PIN store cannot be read we do not know whether a lock is set,
        // and guessing "unlocked" would walk straight past a security control
        // the user switched on. But hanging on the blank placeholder below is
        // just as wrong — that is a bricked app with nothing on screen. So say
        // what happened and offer a retry.
        if (!active) return;
        setFailure(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) setReady(true);
      }
    })();

    return () => {
      active = false;
    };
  }, [attempt]);

  const unlock = useCallback(async (pin: string): Promise<boolean> => {
    const outcome = await attemptUnlock(pin);

    if (outcome === "duress") {
      await panicDelete();
      // Fall through to the unlocked app exactly as a correct PIN would. The
      // app is now genuinely empty, which is the point: it is not a decoy, it
      // is the real app with nothing left in it.
      setLocked(false);
      return true;
    }

    if (outcome === "unlocked") {
      setLocked(false);
      return true;
    }
    return false;
  }, []);

  // Render nothing until the config is known, so the real UI never flashes
  // on screen before the lock has a chance to cover it.
  if (!ready) return <View style={styles.blank} />;

  if (failure) {
    return (
      <View style={styles.lock}>
        <Text style={styles.lockTitle}>{t("common.error")}</Text>
        <Text style={styles.failureBody}>{t("stealth.lockUnreadable")}</Text>
        <Text style={styles.failureDetail}>{failure}</Text>
        <Pressable style={styles.retry} onPress={() => setAttempt((n) => n + 1)}>
          <Text style={styles.retryLabel}>{t("common.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  if (!locked || !config) return <>{children}</>;

  return config.disguise === DisguiseMode.Calculator ? (
    <CalculatorDisguise onSubmit={unlock} />
  ) : (
    <PlainLock onSubmit={unlock} branded={config.disguise === DisguiseMode.None} />
  );
}

/** Undisguised keypad. Honest about what the app is — and therefore identifying. */
function PlainLock({
  onSubmit,
  branded,
}: {
  onSubmit: (pin: string) => Promise<boolean>;
  branded: boolean;
}) {
  const [pin, setPin] = useState("");

  async function submit() {
    if (!(await onSubmit(pin))) setPin("");
  }

  return (
    <View style={styles.lock}>
      <Text style={styles.lockTitle}>{branded ? t("appName") : t("stealth.notesTitle")}</Text>
      <Text style={styles.dots}>{"•".repeat(pin.length)}</Text>
      <Keypad
        onDigit={(d) => setPin((p) => p + d)}
        onClear={() => setPin("")}
        onEnter={submit}
        enterLabel={t("stealth.unlock")}
      />
    </View>
  );
}

/**
 * A calculator that actually calculates.
 *
 * It has to genuinely work: a "calculator" that does not add up is a tell, and
 * a tell in this position is worse than no disguise at all — it marks the phone
 * as having something to hide and the user as having tried to hide it. Pressing
 * `=` on an expression that is really the PIN unlocks instead of evaluating.
 */
function CalculatorDisguise({ onSubmit }: { onSubmit: (pin: string) => Promise<boolean> }) {
  const [display, setDisplay] = useState("0");
  const [pending, setPending] = useState<{ left: number; op: string } | null>(null);

  function digit(d: string) {
    setDisplay((cur) => (cur === "0" ? d : cur + d));
  }

  function operator(op: string) {
    setPending({ left: Number(display) || 0, op });
    setDisplay("0");
  }

  async function equals() {
    // The PIN check comes first, and only for a plain digit entry — otherwise
    // an arithmetic result could coincidentally unlock the app.
    if (!pending && /^\d+$/.test(display)) {
      if (await onSubmit(display)) return;
    }

    if (!pending) return;
    const right = Number(display) || 0;
    const { left, op } = pending;
    const result =
      op === "+" ? left + right
      : op === "−" ? left - right
      : op === "×" ? left * right
      : right === 0 ? NaN
      : left / right;

    setDisplay(Number.isFinite(result) ? String(result) : "Error");
    setPending(null);
  }

  return (
    <View style={styles.calc}>
      <Text style={styles.calcDisplay} numberOfLines={1} adjustsFontSizeToFit>
        {display}
      </Text>
      <Keypad
        onDigit={digit}
        onClear={() => {
          setDisplay("0");
          setPending(null);
        }}
        onEnter={equals}
        enterLabel="="
        operators={["+", "−", "×", "÷"]}
        onOperator={operator}
      />
    </View>
  );
}

function Keypad({
  onDigit,
  onClear,
  onEnter,
  enterLabel,
  operators,
  onOperator,
}: {
  onDigit: (d: string) => void;
  onClear: () => void;
  onEnter: () => void;
  enterLabel: string;
  operators?: string[];
  onOperator?: (op: string) => void;
}) {
  return (
    <View style={styles.keypad}>
      {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((d) => (
        <Key key={d} label={d} onPress={() => onDigit(d)} />
      ))}
      <Key label="C" onPress={onClear} tone="dim" />
      <Key label="0" onPress={() => onDigit("0")} />
      <Key label={enterLabel} onPress={onEnter} tone="accent" />

      {operators?.length ? (
        <View style={styles.operators}>
          {operators.map((op) => (
            <Key key={op} label={op} onPress={() => onOperator?.(op)} tone="dim" />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Key({
  label,
  onPress,
  tone = "normal",
}: {
  label: string;
  onPress: () => void;
  tone?: "normal" | "dim" | "accent";
}) {
  const bg = tone === "accent" ? colors.accent : colors.surfaceAlt;
  const fg = tone === "accent" ? colors.accentText : tone === "dim" ? colors.textDim : colors.text;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.key, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={[styles.keyLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: colors.bg },
  failureBody: { color: colors.text, fontSize: 15, textAlign: "center", marginTop: spacing.md },
  failureDetail: {
    color: colors.textDim,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  retry: {
    marginTop: spacing.lg,
    alignSelf: "center",
    backgroundColor: colors.accent,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
  },
  retryLabel: { color: colors.accentText, fontSize: 16, fontWeight: "600" },
  lock: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: spacing.lg },
  lockTitle: { color: colors.text, fontSize: 24, fontWeight: "700", textAlign: "center" },
  dots: {
    color: colors.text,
    fontSize: 28,
    letterSpacing: 6,
    textAlign: "center",
    minHeight: 40,
    marginVertical: spacing.lg,
  },
  calc: { flex: 1, backgroundColor: colors.bg, justifyContent: "flex-end", padding: spacing.lg },
  calcDisplay: {
    color: colors.text,
    fontSize: 56,
    fontWeight: "300",
    textAlign: "right",
    marginBottom: spacing.lg,
  },
  keypad: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "center" },
  operators: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  key: {
    width: 76,
    height: 60,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  keyLabel: { fontSize: 22, fontWeight: "600" },
});
