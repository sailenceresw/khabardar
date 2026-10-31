//! On-device Groth16 proving, so a phone can generate Semaphore proofs.
//!
//! ## Why this exists
//!
//! The registry's zero-knowledge personhood gate verifies proofs on-chain, and
//! that half works. The other half — producing a proof — is the part a phone
//! could not do: `snarkjs` needs a WebAssembly runtime to run circom's witness
//! calculator, and Hermes has none. Without this module the zk gate is a
//! contract nobody can satisfy from the app.
//!
//! ## The division of labour with JS
//!
//! JS builds the Merkle proof and marshals the circuit inputs, because that is
//! cheap and the Semaphore libraries already do it well. Native does only the
//! part that is genuinely expensive: witness generation and the Groth16 proof.
//! Keeping the split there means the anonymity-critical logic — which identity,
//! which group, which scope — stays in readable TypeScript rather than being
//! buried behind an FFI boundary.
//!
//! ## What this does not do
//!
//! It does not make the *transaction* private. The proof hides which member
//! signalled; it does nothing about the address that submits it, which is why
//! this has to be paired with a fresh sponsored smart account per action. Two
//! halves, neither sufficient alone.

pub mod prover;
pub mod semaphore;

pub use prover::{prove, validate_zkey, Proof, ProveError};

// ---------------------------------------------------------------------------
// Android — JNI
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::jstring;
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_zkprove_ZkNative_initLogging(_env: JNIEnv, _class: JClass) {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(android_logger::FilterBuilder::new().build().filter())
                .with_tag("KhabardarZk"),
        );
    }

    /// Generate a proof. Blocks for seconds; Kotlin dispatches it off the main
    /// thread. Returns JSON: `{"points":[...],"publicSignals":[...]}` or
    /// `{"error":"..."}`.
    ///
    /// Errors come back as data rather than as a Java exception because a
    /// failed proof is an ordinary outcome here — a truncated artifact, a stale
    /// Merkle root — and the caller needs the message to tell the user which.
    #[no_mangle]
    pub extern "C" fn Java_expo_modules_zkprove_ZkNative_nativeProve(
        mut env: JNIEnv,
        _class: JClass,
        wasm_path: JString,
        zkey_path: JString,
        inputs_json: JString,
    ) -> jstring {
        let result = (|| -> Result<String, String> {
            let wasm: String = env
                .get_string(&wasm_path)
                .map_err(|_| "bad wasm path")?
                .into();
            let zkey: String = env
                .get_string(&zkey_path)
                .map_err(|_| "bad zkey path")?
                .into();
            let json: String = env
                .get_string(&inputs_json)
                .map_err(|_| "bad inputs")?
                .into();

            let inputs = semaphore::inputs_from_json(&json).map_err(|e| e.to_string())?;
            let proof = prove(&wasm, &zkey, inputs).map_err(|e| e.to_string())?;
            Ok(semaphore::proof_to_json(&proof))
        })();

        let payload = match result {
            Ok(json) => json,
            Err(message) => semaphore::error_to_json(&message),
        };

        match env.new_string(payload) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    }

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_zkprove_ZkNative_nativeValidateZkey(
        mut env: JNIEnv,
        _class: JClass,
        zkey_path: JString,
    ) -> jni::sys::jboolean {
        let path: String = match env.get_string(&zkey_path) {
            Ok(v) => v.into(),
            Err(_) => return 0,
        };
        u8::from(validate_zkey(&path).is_ok())
    }
}

// ---------------------------------------------------------------------------
// iOS — C ABI
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
mod c_abi {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;

    unsafe fn read(p: *const c_char) -> Option<String> {
        if p.is_null() {
            return None;
        }
        CStr::from_ptr(p).to_str().ok().map(str::to_owned)
    }

    /// Generate a proof. Blocks for seconds; Swift calls it off the main queue.
    ///
    /// Returns a NUL-terminated JSON string the caller owns and must free with
    /// {khabardar_zk_string_free}.
    ///
    /// # Safety
    /// All three arguments must be valid NUL-terminated UTF-8.
    #[no_mangle]
    pub unsafe extern "C" fn khabardar_zk_prove(
        wasm_path: *const c_char,
        zkey_path: *const c_char,
        inputs_json: *const c_char,
    ) -> *mut c_char {
        let result = (|| -> Result<String, String> {
            let wasm = read(wasm_path).ok_or("bad wasm path")?;
            let zkey = read(zkey_path).ok_or("bad zkey path")?;
            let json = read(inputs_json).ok_or("bad inputs")?;

            let inputs = semaphore::inputs_from_json(&json).map_err(|e| e.to_string())?;
            let proof = prove(&wasm, &zkey, inputs).map_err(|e| e.to_string())?;
            Ok(semaphore::proof_to_json(&proof))
        })();

        let payload = match result {
            Ok(json) => json,
            Err(message) => semaphore::error_to_json(&message),
        };

        CString::new(payload)
            .map(CString::into_raw)
            .unwrap_or(std::ptr::null_mut())
    }

    /// # Safety
    /// `path` must be valid NUL-terminated UTF-8.
    #[no_mangle]
    pub unsafe extern "C" fn khabardar_zk_validate_zkey(path: *const c_char) -> i32 {
        match read(path) {
            Some(p) => i32::from(validate_zkey(&p).is_ok()),
            None => 0,
        }
    }

    /// # Safety
    /// `ptr` must have come from {khabardar_zk_prove}.
    #[no_mangle]
    pub unsafe extern "C" fn khabardar_zk_string_free(ptr: *mut c_char) {
        if !ptr.is_null() {
            drop(CString::from_raw(ptr));
        }
    }
}
