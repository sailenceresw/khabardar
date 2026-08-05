import ExpoModulesCore
import Foundation

/// Embedded Tor for iOS.
///
/// Arti runs in-process and offers a SOCKS5 proxy on loopback; this module
/// points a `URLSession` at that port and performs HTTP on JS's behalf. React
/// Native's global `fetch` cannot be told to use a proxy per request, which is
/// why requests come through here rather than staying in JS.
public class ExpoTorModule: Module {

  /// Rebuilt whenever the SOCKS port changes, and never shared with the app's
  /// ordinary networking. A connection pooled before Tor started would
  /// otherwise be reused afterwards, sending an allegedly anonymised request
  /// down a direct socket.
  private var session: URLSession?
  private var sessionPort: Int = -1

  public func definition() -> ModuleDefinition {
    Name("ExpoTor")

    /// Whether this build can run Tor at all.
    ///
    /// Always true on iOS: the Arti core is a static library, so a build
    /// missing it fails to link rather than shipping. Android has the weaker
    /// guarantee — a `.so` can be absent at runtime — so the JS contract
    /// carries this method for both.
    Function("isSupported") { true }

    AsyncFunction("start") { () -> Int in
      // Application Support and Caches are inside the app sandbox and excluded
      // from iCloud backup below. Arti keeps consensus data and — more
      // sensitively — its guard selection here; a backed-up guard set is
      // linkable across devices and restores.
      let cacheDir = try Self.directory(.cachesDirectory, name: "tor")
      let stateDir = try Self.directory(.applicationSupportDirectory, name: "tor")

      let port: Int32 = cacheDir.path.withCString { cachePtr in
        stateDir.path.withCString { statePtr in
          khabardar_tor_start(cachePtr, statePtr)
        }
      }

      guard port > 0 else {
        throw TorStartFailedException(Self.lastError() ?? "bootstrap failed")
      }

      self.invalidateSession()
      return Int(port)
    }

    AsyncFunction("stop") { () -> Void in
      khabardar_tor_stop()
      self.invalidateSession()
    }

    /// Move subsequent requests onto fresh circuits.
    ///
    /// The session goes too. A rotated isolation token only affects *new*
    /// streams, so a kept-alive connection would keep carrying traffic on the
    /// old circuit and quietly defeat the isolation the caller just asked for.
    AsyncFunction("newCircuit") { () -> Bool in
      let rotated = khabardar_tor_new_circuit() == 1
      if rotated { self.invalidateSession() }
      return rotated
    }

    Function("getStatus") { () -> [String: Any?] in
      [
        "state": Self.stateName(khabardar_tor_state()),
        "socksPort": Int(khabardar_tor_socks_port()),
        "lastError": Self.lastError()
      ]
    }

    /// Perform an HTTP request over Tor.
    ///
    /// Fails rather than falling back when Tor is not running. A transport that
    /// silently degrades to a direct connection is worse than one that does not
    /// exist, because the user has been told they are protected.
    AsyncFunction("request") { (
      url: String,
      method: String,
      headers: [String: String],
      body: String?
    ) -> [String: Any] in
      let port = Int(khabardar_tor_socks_port())
      guard khabardar_tor_state() == Self.stateRunning, port > 0 else {
        throw TorNotRunningException()
      }
      guard let requestURL = URL(string: url) else {
        throw TorRequestFailedException("invalid URL")
      }

      var request = URLRequest(url: requestURL)
      request.httpMethod = method.uppercased()
      request.httpBody = body?.data(using: .utf8)
      for (name, value) in headers {
        request.setValue(value, forHTTPHeaderField: name)
      }

      let (data, response) = try await self.sessionFor(port: port).data(for: request)
      guard let http = response as? HTTPURLResponse else {
        throw TorRequestFailedException("non-HTTP response")
      }

      var responseHeaders: [String: String] = [:]
      for (key, value) in http.allHeaderFields {
        if let k = key as? String, let v = value as? String { responseHeaders[k] = v }
      }

      return [
        "status": http.statusCode,
        "headers": responseHeaders,
        // Base64 so binary responses survive the JS bridge intact.
        "bodyBase64": data.base64EncodedString()
      ]
    }
  }

  private func sessionFor(port: Int) -> URLSession {
    if let existing = session, sessionPort == port { return existing }

    let config = URLSessionConfiguration.ephemeral

    // SOCKS5 on loopback.
    //
    // CFNetwork hands the *hostname* to a SOCKS proxy rather than resolving it
    // first, so the name is resolved by the Tor exit and no DNS query leaves
    // the device. That distinction is the difference between using Tor and
    // leaking a lookup that says exactly where you are going.
    config.connectionProxyDictionary = [
      kCFStreamPropertySOCKSProxyHost as String: "127.0.0.1",
      kCFStreamPropertySOCKSProxyPort as String: port,
      kCFStreamPropertySOCKSVersion as String: kCFStreamSocketSOCKSVersion5 as String,
      kCFProxyTypeKey as String: kCFProxyTypeSOCKS as String
    ]

    // Never let a response touch the shared URL cache or the cookie store —
    // both outlive the session and are readable in a device backup.
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false

    // Tor is slow. Default timeouts turn a working circuit into a failure.
    config.timeoutIntervalForRequest = 90
    config.timeoutIntervalForResource = 180

    let built = URLSession(configuration: config)
    session = built
    sessionPort = port
    return built
  }

  private func invalidateSession() {
    session?.invalidateAndCancel()
    session = nil
    sessionPort = -1
  }

  private static let stateRunning: Int32 = 2

  private static func stateName(_ state: Int32) -> String {
    switch state {
    case 1: return "starting"
    case 2: return "running"
    case 3: return "failed"
    default: return "stopped"
    }
  }

  private static func lastError() -> String? {
    guard let raw = khabardar_tor_last_error() else { return nil }
    defer { khabardar_tor_string_free(raw) }
    let message = String(cString: raw)
    return message.isEmpty ? nil : message
  }

  private static func directory(
    _ searchPath: FileManager.SearchPathDirectory,
    name: String
  ) throws -> URL {
    let fm = FileManager.default
    let base = try fm.url(for: searchPath, in: .userDomainMask, appropriateFor: nil, create: true)
    var dir = base.appendingPathComponent(name, isDirectory: true)
    try fm.createDirectory(at: dir, withIntermediateDirectories: true)

    // Keep Tor state out of iCloud and iTunes backups. A restored guard set
    // links a new device to the old one.
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? dir.setResourceValues(values)

    return dir
  }
}

internal final class TorNotRunningException: Exception {
  override var reason: String { "Tor is not running" }
}

internal final class TorStartFailedException: GenericException<String> {
  override var reason: String { "Tor failed to start: \(param)" }
}

internal final class TorRequestFailedException: GenericException<String> {
  override var reason: String { "Tor request failed: \(param)" }
}
