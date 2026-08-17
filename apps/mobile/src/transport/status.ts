import { getTransport } from "./index";

export interface AnonymityStatus {
  mode: string;
  protected: boolean;
  warning?: string;
}

/**
 * Human-readable status for Settings UI and pre-submit warnings.
 * Never sent off-device.
 */
export function getAnonymityStatus(): AnonymityStatus {
  const t = getTransport();

  if (t.isProtected()) {
    return {
      mode: t.mode,
      protected: true,
    };
  }

  if (t.mode === "tor") {
    return {
      mode: t.mode,
      protected: false,
      warning:
        "Tor mode is selected but Orbot does not appear to be active. " +
        "Enable Orbot VPN mode and include Khabardar for real protection.",
    };
  }

  return {
    mode: t.mode,
    protected: false,
    warning:
      "Traffic is not routed through Tor. On Android install Orbot, " +
      "enable VPN mode, and include Khabardar before submitting sensitive reports.",
  };
}
