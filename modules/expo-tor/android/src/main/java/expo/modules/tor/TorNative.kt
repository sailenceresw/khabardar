package expo.modules.tor

import android.util.Log

/**
 * JNI surface of the embedded Arti client.
 *
 * Every method here blocks. `start` in particular blocks for the whole Tor
 * bootstrap, which on a mobile network is routinely 10–60 seconds, so it must
 * never be called from the main thread — [ExpoTorModule] dispatches it.
 */
internal object TorNative {

  /**
   * Whether the native library actually loaded.
   *
   * A build assembled without the Rust step — `cargo` missing on the build
   * machine, a CI job that skipped it — produces an APK where this class exists
   * and the `.so` does not. Letting `UnsatisfiedLinkError` escape would then
   * crash the app the first time anyone opened the network screen.
   *
   * Worse than the crash: the JS side would have reported Tor as *available*
   * right up until the moment it died. A build that cannot run Tor must say so
   * calmly and let the user decide, so the error is caught here and every entry
   * point below is guarded.
   */
  val available: Boolean = try {
    System.loadLibrary("khabardar_tor")
    initLogging()
    true
  } catch (e: UnsatisfiedLinkError) {
    Log.e(
      "KhabardarTor",
      "libkhabardar_tor.so is missing from this build — Tor is unavailable. " +
        "Run `npm run tor:build:android` before assembling.",
      e
    )
    false
  }

  external fun initLogging()

  /** @return the loopback SOCKS port, or -1 on failure. */
  external fun nativeStart(cacheDir: String, stateDir: String): Int

  external fun nativeStop()

  /** Move subsequent traffic onto fresh circuits. 1 on success, 0 if not running. */
  external fun nativeNewCircuit(): Int

  /** 0 stopped, 1 starting, 2 running, 3 failed. Mirrors `tor::TorState`. */
  external fun nativeState(): Int

  external fun nativeSocksPort(): Int

  external fun nativeLastError(): String
}
