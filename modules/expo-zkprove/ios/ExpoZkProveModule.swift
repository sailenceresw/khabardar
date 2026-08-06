import ExpoModulesCore
import Foundation

/// On-device Groth16 proving for iOS.
///
/// JS marshals the circuit inputs — which identity, which group, which scope —
/// and native does only witness generation and the proof, so the
/// anonymity-critical decisions stay in readable TypeScript rather than behind
/// an FFI boundary.
public class ExpoZkProveModule: Module {

  /// Serial and background-priority on purpose. Proving is CPU-bound; running
  /// several at once would starve the app of cores for the duration, and there
  /// is never a good reason to prove two things simultaneously.
  private let queue = DispatchQueue(label: "app.khabardar.zkprove", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("ExpoZkProve")

    /// Always true on iOS: the core is a static library, so a build missing it
    /// fails to link rather than shipping. Android has the weaker guarantee —
    /// a .so can be absent at runtime — so the JS contract carries this for both.
    Function("isSupported") { true }

    AsyncFunction("prove") { (wasmPath: String, zkeyPath: String, inputsJson: String) -> [String: Any] in
      let raw: String = try await withCheckedThrowingContinuation { continuation in
        self.queue.async {
          guard let result = wasmPath.withCString({ w in
            zkeyPath.withCString { z in
              inputsJson.withCString { i in
                khabardar_zk_prove(w, z, i)
              }
            }
          }) else {
            continuation.resume(throwing: ProvingFailedException("the prover returned nothing"))
            return
          }
          defer { khabardar_zk_string_free(result) }
          continuation.resume(returning: String(cString: result))
        }
      }

      guard
        let data = raw.data(using: .utf8),
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else {
        throw ProvingFailedException("the prover returned malformed JSON")
      }

      if let error = json["error"] as? String {
        throw ProvingFailedException(error)
      }

      // Field elements stay strings across the bridge: 254 bits do not survive
      // a JS number, and a rounded identity secret proves membership for
      // someone who does not exist.
      return [
        "points": json["points"] as? [String] ?? [],
        "publicSignals": json["publicSignals"] as? [String] ?? []
      ]
    }

    AsyncFunction("validateZkey") { (zkeyPath: String) -> Bool in
      await withCheckedContinuation { continuation in
        self.queue.async {
          let ok = zkeyPath.withCString { khabardar_zk_validate_zkey($0) } == 1
          continuation.resume(returning: ok)
        }
      }
    }
  }
}

internal final class ProvingFailedException: GenericException<String> {
  override var reason: String { "Proving failed: \(param)" }
}
