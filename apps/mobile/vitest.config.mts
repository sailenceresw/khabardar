import { defineConfig } from "vitest/config";
import path from "node:path";

const here = import.meta.dirname;

const stub = (name: string) => path.resolve(here, "test/stubs", name);

/**
 * Unit tests for the app's logic, run on Node.
 *
 * The native modules are replaced by aliases rather than by patching
 * `Module._load` the way `scripts/verifySlice.ts` does: an alias is resolved
 * once by the bundler, applies to transitive imports, and does not depend on
 * require order. The stubs live in one place so a test and the slice cannot
 * drift into disagreeing about what a native module does.
 *
 * This does not replace `verify:slice`. That proves the end-to-end submission
 * path still works; these prove the individual pieces behave at their edges,
 * which is where every defect found in review actually lived.
 */
export default defineConfig({
  resolve: {
    alias: {
      "expo-crypto": stub("expo-crypto.ts"),
      "expo-secure-store": stub("expo-secure-store.ts"),
      "@react-native-async-storage/async-storage": stub("async-storage.ts"),
      "react-native": stub("react-native.ts"),
      "expo-tor": stub("expo-tor.ts"),
      "expo-file-system": stub("expo-file-system.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    restoreMocks: true,
  },
});
