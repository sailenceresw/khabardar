package expo.modules.zkprove

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class ProverUnavailableException :
  CodedException("ERR_PROVER_UNAVAILABLE", MISSING_LIBRARY, null)

class ProvingFailedException(reason: String) :
  CodedException("ERR_PROVING_FAILED", reason, null)

private const val MISSING_LIBRARY =
  "This build was assembled without the native prover. Run `npm run zk:build:android` and rebuild."

/**
 * On-device Groth16 proving for Android.
 *
 * The whole module is one expensive call. JS marshals the circuit inputs —
 * which identity, which group, which scope — and native does only witness
 * generation and the proof, so the anonymity-critical decisions stay in
 * readable TypeScript rather than behind an FFI boundary.
 */
class ExpoZkProveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoZkProve")

    Function("isSupported") { ZkNative.available }

    /**
     * Generate a proof.
     *
     * Runs on `Dispatchers.Default` rather than `IO`: this is CPU-bound, not
     * blocked on a device, and putting it on the IO pool would let several
     * proofs run at once and starve the whole app of cores for the duration.
     *
     * Errors come back as a rejected promise carrying the reason, because a
     * failed proof is an ordinary outcome — a truncated artifact, a stale
     * Merkle root — and the user needs to be told which.
     */
    // `Coroutine` rather than a plain AsyncFunction: the body of a plain one is
    // not a suspend context, so `withContext` will not compile there.
    AsyncFunction("prove") Coroutine { wasmPath: String, zkeyPath: String, inputsJson: String ->
      if (!ZkNative.available) throw ProverUnavailableException()

      val raw = withContext(Dispatchers.Default) {
        ZkNative.nativeProve(wasmPath, zkeyPath, inputsJson)
      }

      val json = JSONObject(raw)
      if (json.has("error")) throw ProvingFailedException(json.getString("error"))

      mapOf(
        "points" to json.getJSONArray("points").toStringList(),
        "publicSignals" to json.getJSONArray("publicSignals").toStringList()
      )
    }

    AsyncFunction("validateZkey") Coroutine { zkeyPath: String ->
      if (!ZkNative.available) return@Coroutine false
      withContext(Dispatchers.Default) { ZkNative.nativeValidateZkey(zkeyPath) }
    }
  }

  /**
   * Field elements stay strings all the way across the bridge.
   *
   * They run to 254 bits and a JS number carries 53, so converting here would
   * round an identity secret into a different one — producing a proof for a
   * member who does not exist, which fails verification with nothing to
   * explain why.
   */
  private fun org.json.JSONArray.toStringList(): List<String> =
    (0 until length()).map { getString(it) }
}
