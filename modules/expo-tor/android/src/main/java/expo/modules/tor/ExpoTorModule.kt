package expo.modules.tor

import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import okhttp3.Dns
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

class TorNotRunningException :
  CodedException("ERR_TOR_NOT_RUNNING", "Tor is not running", null)

class TorStartFailedException(reason: String) :
  CodedException("ERR_TOR_START_FAILED", reason, null)

/**
 * Embedded Tor for Android.
 *
 * Arti runs in-process and offers a SOCKS5 proxy on loopback; this module
 * points an OkHttp client at that port and performs HTTP on JS's behalf. React
 * Native's global `fetch` cannot be told to use a proxy per request, which is
 * the whole reason requests come through here rather than staying in JS.
 */
class ExpoTorModule : Module() {

  /**
   * Built fresh whenever the SOCKS port changes, and deliberately not shared
   * with the app's ordinary networking. A pooled connection created before Tor
   * started would otherwise be reused afterwards, sending an allegedly
   * anonymised request down a direct socket.
   */
  private var client: OkHttpClient? = null
  private var clientPort: Int = -1

  override fun definition() = ModuleDefinition {
    Name("ExpoTor")

    /**
     * Whether this build can run Tor at all.
     *
     * False when the native library did not load — see [TorNative.available].
     * The JS side gates everything on this, so a build assembled without the
     * Rust step reports "cannot protect you" instead of crashing on first use.
     */
    Function("isSupported") { TorNative.available }

    AsyncFunction("start") { ->
      if (!TorNative.available) throw TorStartFailedException(MISSING_LIBRARY)
      // Private app storage. Arti keeps consensus data and — more sensitively —
      // its guard selection here; on shared storage another app could read it,
      // and a guard set is linkable across sessions.
      val context = appContext.reactContext
        ?: throw TorStartFailedException("no Android context")

      val cacheDir = context.cacheDir.resolve("tor").apply { mkdirs() }
      val stateDir = context.filesDir.resolve("tor").apply { mkdirs() }

      val port = TorNative.nativeStart(cacheDir.absolutePath, stateDir.absolutePath)
      if (port <= 0) {
        throw TorStartFailedException(TorNative.nativeLastError().ifEmpty { "bootstrap failed" })
      }

      invalidateClient()
      port
    }

    AsyncFunction("stop") { ->
      if (TorNative.available) TorNative.nativeStop()
      invalidateClient()
    }

    /**
     * Move subsequent requests onto fresh circuits.
     *
     * The pooled connections have to go too. A rotated isolation token only
     * affects *new* streams, so a kept-alive connection would keep carrying
     * traffic on the old circuit and quietly defeat the isolation the caller
     * just asked for.
     */
    AsyncFunction("newCircuit") { ->
      if (!TorNative.available) return@AsyncFunction false
      val rotated = TorNative.nativeNewCircuit() == 1
      if (rotated) invalidateClient()
      rotated
    }

    Function("getStatus") {
      if (!TorNative.available) {
        return@Function mapOf(
          "state" to "failed",
          "socksPort" to 0,
          "lastError" to MISSING_LIBRARY
        )
      }
      mapOf(
        "state" to stateName(TorNative.nativeState()),
        "socksPort" to TorNative.nativeSocksPort(),
        "lastError" to TorNative.nativeLastError().ifEmpty { null }
      )
    }

    /**
     * Perform an HTTP request over Tor.
     *
     * Fails rather than falling back when Tor is not running. A transport that
     * silently degrades to a direct connection is worse than one that does not
     * exist, because the user has been told they are protected.
     */
    AsyncFunction("request") { url: String,
                               method: String,
                               headers: Map<String, String>,
                               body: String? ->
      if (!TorNative.available) throw TorNotRunningException()

      val port = TorNative.nativeSocksPort()
      if (TorNative.nativeState() != STATE_RUNNING || port <= 0) {
        throw TorNotRunningException()
      }

      val http = clientFor(port)
      val requestBody = body?.let {
        val contentType = headers.entries
          .firstOrNull { e -> e.key.equals("content-type", ignoreCase = true) }
          ?.value
        it.toByteArray(Charsets.UTF_8).toRequestBody(contentType?.toMediaTypeOrNull())
      }

      val builder = Request.Builder().url(url).method(method.uppercase(), requestBody)
      headers.forEach { (name, value) -> builder.header(name, value) }

      http.newCall(builder.build()).execute().use { response ->
        val bytes = response.body?.bytes() ?: ByteArray(0)
        mapOf(
          "status" to response.code,
          "headers" to response.headers.toMultimap().mapValues { it.value.joinToString(", ") },
          // Base64 so binary responses survive the JS bridge intact.
          "bodyBase64" to Base64.encodeToString(bytes, Base64.NO_WRAP)
        )
      }
    }
  }

  private fun clientFor(port: Int): OkHttpClient {
    val existing = client
    if (existing != null && clientPort == port) return existing

    val built = OkHttpClient.Builder()
      // SOCKS5 on loopback. OkHttp builds an *unresolved* socket address for
      // SOCKS proxies, so the hostname travels to the proxy and Arti resolves
      // it inside the network. That is the difference between using Tor and
      // leaking a DNS query that says exactly where you are going.
      .proxy(Proxy(Proxy.Type.SOCKS, InetSocketAddress.createUnresolved("127.0.0.1", port)))
      // Belt and braces: if any code path ever does ask OkHttp to resolve a
      // name, refuse instead of quietly performing the lookup.
      .dns(NoLocalDns)
      // Tor is slow. Default timeouts turn a working circuit into a failure.
      .connectTimeout(60, TimeUnit.SECONDS)
      .readTimeout(90, TimeUnit.SECONDS)
      .writeTimeout(60, TimeUnit.SECONDS)
      // Circuits are expensive to build; reuse within a session is worth it.
      .retryOnConnectionFailure(true)
      .build()

    client = built
    clientPort = port
    return built
  }

  private fun invalidateClient() {
    client?.connectionPool?.evictAll()
    client = null
    clientPort = -1
  }

  private object NoLocalDns : Dns {
    override fun lookup(hostname: String): List<InetAddress> =
      throw java.net.UnknownHostException(
        "Refusing to resolve $hostname locally: names must be resolved by the Tor exit"
      )
  }

  private companion object {
    const val STATE_RUNNING = 2

    const val MISSING_LIBRARY =
      "This build was assembled without the native Tor library. Run `npm run tor:build:android` and rebuild."

    fun stateName(state: Int) = when (state) {
      1 -> "starting"
      2 -> "running"
      3 -> "failed"
      else -> "stopped"
    }
  }
}
