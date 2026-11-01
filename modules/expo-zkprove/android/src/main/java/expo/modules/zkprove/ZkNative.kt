package expo.modules.zkprove

/**
 * JNI surface of the Groth16 prover.
 *
 * Every method blocks. `nativeProve` blocks for seconds — longer on the cheap
 * hardware much of the intended audience carries — so it must never be called
 * from the main thread. [ExpoZkProveModule] dispatches it.
 */
internal object ZkNative {
  /**
   * False when the library did not load.
   *
   * A build assembled without the Rust step produces exactly that, and the JS
   * side gates on it so such a build reports "cannot do this" instead of
   * crashing the first time someone tries to prove.
   */
  val available: Boolean = try {
    System.loadLibrary("khabardar_zkprove")
    initLogging()
    true
  } catch (e: UnsatisfiedLinkError) {
    false
  }

  external fun initLogging()

  /** Returns JSON: `{"points":[...],"publicSignals":[...]}` or `{"error":"..."}`. */
  external fun nativeProve(wasmPath: String, zkeyPath: String, inputsJson: String): String

  external fun nativeValidateZkey(zkeyPath: String): Boolean
}
