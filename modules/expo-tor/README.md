# expo-tor

Embedded [Arti](https://gitlab.torproject.org/tpo/core/arti) (Tor's Rust
implementation) for Khabardar. Runs Tor **inside the app** and performs HTTP
through it, so the app never contacts a server directly.

```
Arti (Rust, in-process)
  └── loopback SOCKS5 proxy, ephemeral port
        └── OkHttp (Android) / URLSession (iOS)
              └── JS: torRequest() → TorTransport → netFetch()
```

## Why the split is where it is

Native code owns exactly one thing: running Arti and offering a SOCKS5 port.
Everything above that is the platform's own HTTP stack.

We could have written HTTP onto Arti's `DataStream`s in Rust and skipped SOCKS
entirely. That would also have meant owning TLS, certificate validation, HTTP/2,
redirects, and connection pooling — reimplementing the platform's HTTP stack,
badly, in the one place where a mistake silently costs a user their anonymity.
A standard SOCKS5 proxy on loopback gets the same routing with none of that.

The request has to leave JS because React Native's `fetch` cannot be told to use
a proxy for a single request, and a process-wide proxy would drag the app's
*other* traffic — Metro in development, anything a dependency does — through Tor
as well.

## The DNS leak

The classic way to leak while "using Tor" is to resolve the hostname locally and
hand the proxy an IP: the traffic is anonymised and the DNS query that says
exactly where you are going is not. Three things prevent it here:

1. The SOCKS server accepts `ATYP=0x03` (domain name) and passes the name
   straight to Arti, which resolves it at the exit. It never calls a resolver.
2. OkHttp builds an **unresolved** socket address for SOCKS proxies, so the name
   travels to the proxy. CFNetwork does the same on iOS.
3. OkHttp is additionally given a `Dns` that throws. If any code path ever does
   ask it to resolve, it fails loudly instead of quietly looking the name up.

## Circuit isolation

`newCircuit()` mints a fresh Arti isolation token, so subsequent streams take
new circuits. The app calls it before every report submission.

Without it, two reports from one device can share a circuit — one exit relay
sees both, at a known interval, from one source. Each report stays individually
anonymous and the pair does not. The blinded entity tags and aggregate-only
sponsor attribution elsewhere in Khabardar exist to prevent exactly that
inference; letting the transport hand it back would waste the work.

Rotating also drops pooled connections on both platforms. A kept-alive
connection would keep carrying traffic on the old circuit and quietly defeat the
isolation the caller just asked for.

## No silent fallback

Every entry point fails rather than degrading to a direct connection. A
transport that quietly falls back is worse than no transport at all, because the
user has been told they are protected and has made decisions on that basis.

`isTorAvailable()` distinguishes **cannot** from **is not**: false in Expo Go and
on web, which cannot load native code, and false on an Android build assembled
without the Rust step — the module is present, the `.so` is not, and reporting
that as available until it crashed would be the worst of both.

## Building

```bash
npm run tor:test              # Rust protocol tests — no Tor network needed

rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
cargo install cargo-ndk
npm run tor:build:android     # → android/src/main/jniLibs/<abi>/libkhabardar_tor.so

rustup target add aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios
npm run tor:build:ios         # → ios/lib/ (needs macOS + Xcode)
```

Android also builds the Rust automatically via a `preBuild` gradle task, which
skips with a warning when `cargo` is absent. Binaries are gitignored: ~7.5 MB per
ABI, reproducible from source, and a binary blob in the tree of an anonymity tool
is exactly the thing nobody can audit.

SQLite (Arti's directory cache) is compiled from source via `rusqlite`'s
`bundled` feature rather than linked against the platform's. The system SQLite
version varies by OS release, and a directory cache that works on one device and
not another is a miserable class of bug.

## What is tested, and what is not

`npm run tor:test` runs 12 tests. The SOCKS5 server is exercised against a
plain-TCP connector, so the protocol logic — greeting, CONNECT, domain vs IP
address types, rejection codes, loopback-only binding, graceful close — is
covered without touching the Tor network.

**Nothing here tests Arti on the live network.** Bootstrap, circuit building,
and guard selection are covered by Arti's own test suite, not ours. Until a dev
build has run on a device and a report has landed, treat "works" as unproven.

Also not implemented: **bridges and pluggable transports.** Where Tor is
censored, bootstrap simply fails. That is the next thing to build, and it is the
largest remaining gap in this module.

## Privacy of Arti's state directory

Arti persists its **guard set** — the small number of entry relays it
deliberately reuses to resist traffic analysis. A copy of that in cloud storage
is subject to legal process and links every restore of the backup to the same
user. So:

- Android: the config plugin writes backup and data-extraction rules excluding
  `files/tor` and `cache/tor` from Google Drive backup and device transfer.
- iOS: the module sets `isExcludedFromBackup` on both directories.

Both live in private app storage, never shared storage.
