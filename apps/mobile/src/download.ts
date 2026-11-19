import { Platform } from "react-native";

/**
 * Save text as a file in the web build. Returns false where there is no
 * browser download to use, so the caller can say the export is web-only
 * instead of failing silently.
 *
 * Nothing leaves the device: the file is built in memory and handed to the
 * browser's own download.
 */
export function downloadTextFile(filename: string, mimeType: string, text: string): boolean {
  if (Platform.OS !== "web" || typeof document === "undefined") return false;
  const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
