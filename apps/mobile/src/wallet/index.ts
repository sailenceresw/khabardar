import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Hex } from "viem";
import { ACTIVE_CHAIN } from "@khabardar/shared";
import type { ConnectHandle, WalletSession } from "./types";
import { safeJsonParse } from "../safeJson";

export type { ConnectHandle, WalletSession } from "./types";

const SESSION_KEY = "khabardar.wallet.session.v1";

/**
 * Optional WalletConnect v2 identity.
 *
 * This is deliberately NOT the default path — see signer.ts for why. The
 * module is lazy: the WalletConnect client is only imported when someone
 * actually tries to connect, so the (large) dependency never loads for the
 * overwhelming majority of users who stay on the anonymous device key.
 *
 * What a real setup needs (see README "WalletConnect"):
 *  - EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID from dashboard.reown.com
 *  - A dev build (not Expo Go) on native, since deep-linking to wallet apps
 *    requires the URL scheme to be registered.
 *
 * Production note: for a polished connect sheet with wallet discovery, swap
 * this for @reown/appkit-wagmi-react-native. Raw sign-client is used here so
 * the protocol surface stays visible and the dependency stays optional.
 */

export function isWalletConnectConfigured(): boolean {
  return !!process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
}

let clientPromise: Promise<any> | null = null;

async function getClient(): Promise<any> {
  const projectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
  if (!projectId) throw new Error("WalletConnect is not configured on this build");

  if (!clientPromise) {
    clientPromise = (async () => {
      // Lazy import keeps this out of the default bundle path.
      const { default: SignClient } = await import("@walletconnect/sign-client");
      return SignClient.init({
        projectId,
        metadata: {
          name: "Khabardar",
          description: "Anonymous corruption reporting",
          url: "https://khabardar.app",
          icons: [],
        },
      });
    })();
  }
  return clientPromise;
}

/**
 * Begin a connection. Returns the pairing URI to display, plus an `approval`
 * promise that settles when the wallet responds.
 */
export async function beginConnect(): Promise<ConnectHandle> {
  const client = await getClient();
  const chain = `eip155:${ACTIVE_CHAIN.chainId}`;

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      eip155: {
        methods: ["personal_sign", "eth_sendTransaction"],
        chains: [chain],
        events: ["accountsChanged", "chainChanged"],
      },
    },
  });

  if (!uri) throw new Error("WalletConnect did not return a pairing URI");

  return {
    uri,
    approval: async () => {
      const session = await approval();
      const account = session.namespaces?.eip155?.accounts?.[0];
      if (!account) throw new Error("Wallet approved no account");

      // Format is "eip155:<chainId>:<address>".
      const [, chainIdStr, address] = account.split(":");

      const stored: WalletSession = {
        topic: session.topic,
        address,
        chainId: Number(chainIdStr),
        peerName: session.peer?.metadata?.name,
        connectedAt: Date.now(),
      };

      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(stored));
      return stored;
    },
  };
}

export async function getWalletSession(): Promise<WalletSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  return safeJsonParse<WalletSession>(raw);
}

export async function signWithWallet(session: WalletSession, message: Hex): Promise<Hex> {
  const client = await getClient();
  return client.request({
    topic: session.topic,
    chainId: `eip155:${session.chainId}`,
    request: { method: "personal_sign", params: [message, session.address] },
  }) as Promise<Hex>;
}

/**
 * Drop the wallet and fall back to the anonymous device key. Also attempts a
 * protocol-level disconnect so the wallet stops showing a live session, but a
 * failure there must not block the local state from clearing.
 */
export async function disconnectWallet(): Promise<void> {
  const session = await getWalletSession();
  await AsyncStorage.removeItem(SESSION_KEY);

  if (!session) return;
  try {
    const client = await getClient();
    await client.disconnect({
      topic: session.topic,
      reason: { code: 6000, message: "User disconnected" },
    });
  } catch {
    // Already expired or never established — local state is what matters.
  }
}
