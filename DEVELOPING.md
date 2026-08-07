# Developing without a test device

Building this on one Windows laptop, with no phone to deploy to. That is a real
constraint and it decides what can and cannot be verified — so here is the honest
picture per target, and what to do about it.

## Summary

| Target | Can you build it here? | Can you *run* it here? |
|---|---|---|
| **Web** | Yes | Yes — `npm run web:export` + `web:static`, or deploy to Vercel |
| **Android** | Yes | **Yes, on the emulator** — see below |
| **iOS** | No | No — needs macOS and Xcode |

The middle row is the one worth acting on: an Android emulator is a real Android
device as far as the app is concerned. It runs the same code, loads the same
native libraries, and exercises the same permission and keystore paths. It is not
a substitute for testing on cheap real hardware — which matters here, because a
lot of the intended audience has exactly that — but it is much closer than
nothing.

## Android on the emulator

### The ABI trap, which will otherwise cost you an afternoon

**Emulators are usually `x86_64`. Phones are `arm64-v8a`.** The Rust modules
(Tor, and the zero-knowledge prover) are compiled per ABI. If you build only for
`arm64-v8a` and then run on an `x86_64` emulator, `System.loadLibrary` throws
`UnsatisfiedLinkError`, both modules correctly report themselves unavailable, and
the app looks broken when it is doing exactly what it should.

Check your AVD before building:

```bash
grep abi.type ~/.android/avd/<YourAvd>.avd/config.ini
```

Then build the matching ABI:

```bash
rustup target add x86_64-linux-android      # emulator
rustup target add aarch64-linux-android     # real phones

npm run tor:build:android
npm run zk:build:android
```

Both scripts build every ABI listed in the module's `build.gradle`. Building all
of them takes a while — each ABI is a full compile of Arti or of the prover and
its wasm runtime.

### Building one ABI while you iterate

Pass `-PkhabardarAbis` to build only what you are about to run. On a laptop this
is the difference between a coffee break and most of an hour:

```bash
./gradlew :app:assembleDebug -PkhabardarAbis=x86_64      # emulator only
npx expo run:android -- -PkhabardarAbis=x86_64
```

It sets both `abiFilters` and the `cargo ndk` target list, so the two cannot
drift apart. The build also fails up front, with the exact `rustup target add`
command, if a target for an enabled ABI is missing — rather than dying with an
opaque cargo error some minutes in.

**Never pass this for a release build.** A Play Store artifact needs every ABI;
one built with this flag would silently exclude real devices.

### Running it

```bash
# 1. Start the emulator
%LOCALAPPDATA%\Android\Sdk\emulator\emulator -avd <YourAvd>

# 2. Native modules mean Expo Go will not do — you need a dev build
npx expo run:android
```

Expo Go cannot load native code. Tor, the prover, and screenshot blocking are all
native, so in Expo Go they report as unavailable — which is honest, and not the
same as testing them.

### What the emulator will not tell you

- **Proving time.** A desktop CPU generates a Groth16 proof in a few seconds. A
  budget Android phone takes considerably longer, and that difference is a UX
  problem, not a rounding error. Treat emulator timings as a lower bound.
- **Tor bootstrap on a real mobile network.** The emulator has your laptop's
  connection. Bootstrap over a congested or filtered mobile network is the case
  that matters and the emulator cannot show it.
- **Hardware-backed keystore behaviour.** The emulator emulates it. Real
  Keystore/StrongBox behaviour — particularly around biometric invalidation —
  differs.

## iOS

There is no path to building iOS on Windows. Apple's toolchain is macOS-only and
this is not a licensing technicality that can be worked around; the compiler, the
simulator, and the signing tooling all require it.

Options, in rough order of cost:

1. **EAS Build** (`eas build --platform ios`) — Expo's hosted macOS builders.
   Compiles and signs in the cloud from this laptop. Still needs an Apple
   Developer account for a signed build, and you cannot run a simulator locally.
2. **A borrowed or rented Mac** — a few hours on a cloud Mac is enough to confirm
   the iOS module compiles and links.
3. **Ship Android and web first.** Perfectly reasonable. The iOS Swift module is
   written and the podspec wired, but *none of it has ever been compiled*, and
   unverified Swift should be assumed broken until a compiler has seen it.

The iOS code in this repo carries exactly that status: written, reviewed, never
built.

## Web

The one target with no caveats. `npm run web:export` builds it and
`npm run web:static` serves it on **8085** (not 8080 — VS Code's default debug
template gets this wrong, which is why `.vscode/launch.json` is committed).

Web has no Tor and no on-device proving: a browser cannot load native modules.
The app says so through `WebDemoGate` rather than letting anyone assume
otherwise.

## Repo-wide typecheck

```bash
npm run typecheck        # tsc -b across every workspace
```

Run this rather than trusting a single workspace. Before the root `tsconfig.json`
existed, the shared package and both native modules had no tsconfig at all — the
editor fell back to bare defaults and reported problems that CI never saw.
Editor and CI disagreeing is worse than either being wrong alone, because it
teaches you to ignore the editor.
