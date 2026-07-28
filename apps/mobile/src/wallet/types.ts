export interface WalletSession {
  /** WalletConnect session topic, used to route requests. */
  topic: string;
  /** Checksummed EVM address the wallet authorised. */
  address: string;
  chainId: number;
  /** Wallet's self-reported name, for display only — never trusted. */
  peerName?: string;
  connectedAt: number;
}

export interface ConnectHandle {
  /** WalletConnect pairing URI — render as a QR code or deep link. */
  uri: string;
  /** Resolves once the wallet approves (or rejects) the session. */
  approval: () => Promise<WalletSession>;
}
