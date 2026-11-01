// C ABI of the embedded Arti core (rust/src/lib.rs). Bridged into Swift via
// the module's bridging header so ExpoTorModule.swift can call it directly.

#ifndef KHABARDAR_TOR_H
#define KHABARDAR_TOR_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Bootstrap Tor and start the loopback SOCKS5 proxy.
///
/// BLOCKS for the whole bootstrap — routinely 10–60 seconds on a mobile
/// network. Must not be called on the main queue.
///
/// @param cache_dir NUL-terminated UTF-8 path inside the app sandbox.
/// @param state_dir NUL-terminated UTF-8 path inside the app sandbox.
/// @param bridges NUL-terminated vanilla bridge paste, or NULL for none.
/// @return the SOCKS port, or -1 on failure (see khabardar_tor_last_error).
int32_t khabardar_tor_start(const char *cache_dir, const char *state_dir, const char *bridges);

/// Stop Tor and drop every circuit. In-flight requests fail rather than
/// completing over a direct connection.
void khabardar_tor_stop(void);

/// Move subsequent traffic onto fresh circuits. Call between actions that must
/// not be linkable — two streams on one circuit share an exit relay.
/// @return 1 on success, 0 when Tor is not running.
int32_t khabardar_tor_new_circuit(void);

/// 0 stopped, 1 starting, 2 running, 3 failed. Mirrors Rust `TorState`.
int32_t khabardar_tor_state(void);

/// Loopback SOCKS port, or 0 when not running.
int32_t khabardar_tor_socks_port(void);

/// Last error, or NULL. Caller owns the result; free with
/// khabardar_tor_string_free.
char *khabardar_tor_last_error(void);

void khabardar_tor_string_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* KHABARDAR_TOR_H */
