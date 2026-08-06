// C ABI of the Groth16 prover core (rust/src/lib.rs), bridged into Swift.

#ifndef KHABARDAR_ZKPROVE_H
#define KHABARDAR_ZKPROVE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/// Generate a Groth16 proof.
///
/// BLOCKS for seconds. Must not be called on the main queue.
///
/// @return NUL-terminated JSON, either
///   {"points":[...],"publicSignals":[...]} or {"error":"..."}.
/// Caller owns the result; free with khabardar_zk_string_free.
char *khabardar_zk_prove(const char *wasm_path,
                         const char *zkey_path,
                         const char *inputs_json);

/// 1 when the proving key parses, 0 otherwise. Lets a truncated download fail
/// at cache time rather than deep inside proving.
int32_t khabardar_zk_validate_zkey(const char *zkey_path);

void khabardar_zk_string_free(char *ptr);

#ifdef __cplusplus
}
#endif

#endif /* KHABARDAR_ZKPROVE_H */
