//! Embedded Tor (Arti) for Khabardar, exposed to Android via JNI and to iOS
//! via a C ABI.
//!
//! The shape is deliberately small. Native code owns exactly one thing —
//! running Arti and offering a loopback SOCKS5 port — and the platform HTTP
//! stacks do everything else. See `socks.rs` for why that split, and for the
//! DNS-leak hazard it is arranged to avoid.

pub mod socks;
pub mod tor;

use once_cell::sync::Lazy;
use std::path::PathBuf;

pub use tor::{TorService, TorState};

/// One embedded Tor per process. Arti keeps a directory cache and a guard set;
/// running two would double the bootstrap cost and, worse, create two
/// independent guard selections for the same user.
static SERVICE: Lazy<TorService> = Lazy::new(TorService::new);

pub fn service() -> &'static TorService {
    &SERVICE
}

// ---------------------------------------------------------------------------
// Android — JNI
// ---------------------------------------------------------------------------

#[cfg(target_os = "android")]
mod android {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::{jint, jstring};
    use jni::JNIEnv;

    /// Route Rust `tracing` output to logcat.
    ///
    /// Debug level on purpose: Arti logs circuit and guard details, and those
    /// belong in a developer's logcat, never in a release build where any app
    /// with READ_LOGS on an older device could read them.
    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_initLogging(_env: JNIEnv, _class: JClass) {
        android_logger::init_once(
            android_logger::Config::default()
                .with_max_level(log::LevelFilter::Warn)
                .with_tag("KhabardarTor"),
        );
    }

    /// Bootstrap Tor. Blocks; the Kotlin side calls this on a background thread.
    /// Returns the SOCKS port, or -1 on failure (read `nativeLastError`).
    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_nativeStart(
        mut env: JNIEnv,
        _class: JClass,
        cache_dir: JString,
        state_dir: JString,
        bridges: JString,
    ) -> jint {
        let cache: String = match env.get_string(&cache_dir) {
            Ok(s) => s.into(),
            Err(_) => return -1,
        };
        let state: String = match env.get_string(&state_dir) {
            Ok(s) => s.into(),
            Err(_) => return -1,
        };
        let bridges: String = match env.get_string(&bridges) {
            Ok(s) => s.into(),
            Err(_) => String::new(),
        };

        match service().start(PathBuf::from(cache), PathBuf::from(state), &bridges) {
            Ok(port) => port as jint,
            Err(_) => -1,
        }
    }

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_nativeStop(_env: JNIEnv, _class: JClass) {
        service().stop();
    }

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_nativeNewCircuit(
        _env: JNIEnv,
        _class: JClass,
    ) -> jint {
        if service().new_circuit() { 1 } else { 0 }
    }

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_nativeState(
        _env: JNIEnv,
        _class: JClass,
    ) -> jint {
        service().state() as jint
    }

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_nativeSocksPort(
        _env: JNIEnv,
        _class: JClass,
    ) -> jint {
        service().socks_port() as jint
    }

    #[no_mangle]
    pub extern "C" fn Java_expo_modules_tor_TorNative_nativeLastError(
        env: JNIEnv,
        _class: JClass,
    ) -> jstring {
        let message = service().last_error().unwrap_or_default();
        match env.new_string(message) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    }
}

// ---------------------------------------------------------------------------
// iOS — C ABI
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "android"))]
mod c_abi {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::os::raw::{c_char, c_int};

    /// Bootstrap Tor. Blocks; Swift calls this off the main queue.
    /// Returns the SOCKS port, or -1 on failure.
    ///
    /// # Safety
    /// `cache_dir` and `state_dir` must be valid NUL-terminated UTF-8.
    /// `bridges` may be NULL (treated as no bridges) or a NUL-terminated
    /// UTF-8 paste of vanilla bridge lines.
    #[no_mangle]
    pub unsafe extern "C" fn khabardar_tor_start(
        cache_dir: *const c_char,
        state_dir: *const c_char,
        bridges: *const c_char,
    ) -> c_int {
        if cache_dir.is_null() || state_dir.is_null() {
            return -1;
        }

        let cache = match CStr::from_ptr(cache_dir).to_str() {
            Ok(s) => PathBuf::from(s),
            Err(_) => return -1,
        };
        let state = match CStr::from_ptr(state_dir).to_str() {
            Ok(s) => PathBuf::from(s),
            Err(_) => return -1,
        };
        let bridges = if bridges.is_null() {
            ""
        } else {
            match CStr::from_ptr(bridges).to_str() {
                Ok(s) => s,
                Err(_) => return -1,
            }
        };

        match service().start(cache, state, bridges) {
            Ok(port) => port as c_int,
            Err(_) => -1,
        }
    }

    #[no_mangle]
    pub extern "C" fn khabardar_tor_stop() {
        service().stop();
    }

    /// Move subsequent traffic onto fresh circuits. Returns 1 on success, 0
    /// when Tor is not running.
    #[no_mangle]
    pub extern "C" fn khabardar_tor_new_circuit() -> c_int {
        if service().new_circuit() { 1 } else { 0 }
    }

    #[no_mangle]
    pub extern "C" fn khabardar_tor_state() -> c_int {
        service().state() as c_int
    }

    #[no_mangle]
    pub extern "C" fn khabardar_tor_socks_port() -> c_int {
        service().socks_port() as c_int
    }

    /// Last error, or NULL. Caller owns the result and must pass it to
    /// {@link khabardar_tor_string_free}.
    #[no_mangle]
    pub extern "C" fn khabardar_tor_last_error() -> *mut c_char {
        match service().last_error() {
            Some(message) => CString::new(message)
                .map(CString::into_raw)
                .unwrap_or(std::ptr::null_mut()),
            None => std::ptr::null_mut(),
        }
    }

    /// # Safety
    /// `ptr` must have come from {@link khabardar_tor_last_error}.
    #[no_mangle]
    pub unsafe extern "C" fn khabardar_tor_string_free(ptr: *mut c_char) {
        if !ptr.is_null() {
            drop(CString::from_raw(ptr));
        }
    }
}
