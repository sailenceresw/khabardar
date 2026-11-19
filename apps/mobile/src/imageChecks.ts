import { Platform } from "react-native";

/**
 * Which on-device image checks this build can run.
 *
 * Metadata removal is always checked: it parses bytes and needs nothing native
 * (see `assertPhotoMetadataRemoved` in evidence.ts). Face and text detection
 * need ML Kit native modules, which only load in a native build and never in
 * the web preview or Expo Go. Until those are added and tested on a phone,
 * both report as unavailable, and the privacy check says so instead of
 * implying the photo was looked at.
 */

export type UnavailableReason =
  /** The web preview cannot load native modules at all. */
  | "web"
  /** A native build, but no on-device detector is bundled yet. */
  | "not-built";

export type CheckCapability = { available: true } | { available: false; reason: UnavailableReason };

export interface ImageCheckCapabilities {
  metadata: { available: true };
  faces: CheckCapability;
  text: CheckCapability;
}

export function imageCheckCapabilities(os: typeof Platform.OS = Platform.OS): ImageCheckCapabilities {
  const reason: UnavailableReason = os === "web" ? "web" : "not-built";
  return {
    metadata: { available: true },
    faces: { available: false, reason },
    text: { available: false, reason },
  };
}
