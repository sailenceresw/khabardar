/*
 * Find metadata blocks in image bytes, so the app can confirm a re-encoded
 * photo really is clean before it stores it.
 *
 * This reads the container structure only (JPEG segments, PNG chunks). It
 * never decodes pixels and never needs a native module, so it runs the same on
 * a phone, on the web preview and in tests.
 *
 * When the bytes cannot be parsed, the answer is "cannot tell" (`clean: null`),
 * never "clean". A truncated or unfamiliar file is exactly where a stripping
 * step might have gone wrong.
 */

export type ImageMetadataKind =
  /**
   * Exif fields that can identify a device or a moment: camera make and model,
   * capture dates, owner or artist, serial numbers, maker notes. An Exif block
   * holding only technical fields (orientation, colour space, pixel size) is
   * not reported: some platform encoders write one on every image.
   */
  | "exif"
  /** The Exif block contains a GPS section: where the photo was taken. */
  | "gps"
  /** Adobe XMP: can hold author names, edit history and location. */
  | "xmp"
  /** IPTC (Photoshop resources): captions, bylines, copyright names. */
  | "iptc"
  /** A free-text comment block. */
  | "comment";

export interface ImageMetadataReport {
  format: "jpeg" | "png" | "unknown";
  /** Every metadata block found, in file order. */
  found: Array<{ kind: ImageMetadataKind; offset: number }>;
  /** `true` when parsed fully with nothing found, `false` when something was found, `null` when it cannot be told. */
  clean: boolean | null;
}

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

const startsWith = (bytes: Uint8Array, at: number, text: string) =>
  at + text.length <= bytes.length && ascii(bytes, at, text.length) === text;

/** IFD0 tag that points at the GPS section. */
const GPS_IFD_TAG = 0x8825;
/** IFD0 tag that points at the Exif sub-IFD, where capture dates and serials live. */
const EXIF_IFD_TAG = 0x8769;

/** Tags that can identify a device, a person or a moment. Everything else is technical. */
const IDENTIFYING_TAGS = new Set([
  0x010f, // Make
  0x0110, // Model
  0x0131, // Software (often names the device's OS build)
  0x0132, // DateTime
  0x013b, // Artist
  0x8298, // Copyright
  0x9c9d, // XPAuthor
  0x9003, // DateTimeOriginal
  0x9004, // DateTimeDigitized
  0x927c, // MakerNote
  0x9286, // UserComment
  0xa420, // ImageUniqueID
  0xa430, // CameraOwnerName
  0xa431, // BodySerialNumber
  0xa435, // LensSerialNumber
]);

/**
 * Read an Exif payload (starting at the TIFF header) and say whether it holds
 * GPS or identifying fields. A payload that cannot be read fully counts as
 * identifying, so a malformed block is refused rather than waved through.
 */
function readExif(tiff: Uint8Array): { gps: boolean; identifying: boolean } {
  const unreadable = { gps: false, identifying: true };
  if (tiff.length < 8) return unreadable;
  const order = ascii(tiff, 0, 2);
  if (order !== "II" && order !== "MM") return unreadable;
  const little = order === "II";
  const u16 = (at: number) => (little ? tiff[at] | (tiff[at + 1] << 8) : (tiff[at] << 8) | tiff[at + 1]);
  const u32 = (at: number) =>
    little
      ? (tiff[at] | (tiff[at + 1] << 8) | (tiff[at + 2] << 16) | (tiff[at + 3] << 24)) >>> 0
      : ((tiff[at] << 24) | (tiff[at + 1] << 16) | (tiff[at + 2] << 8) | tiff[at + 3]) >>> 0;

  /** The tags of one IFD and the value field of each, or null if it runs off the end. */
  const readIfd = (offset: number): Map<number, number> | null => {
    if (offset + 2 > tiff.length) return null;
    const tags = new Map<number, number>();
    const count = u16(offset);
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) return null;
      tags.set(u16(entry), u32(entry + 8));
    }
    return tags;
  };

  const ifd0 = readIfd(u32(4));
  if (!ifd0) return unreadable;
  const gps = ifd0.has(GPS_IFD_TAG);
  let identifying = [...ifd0.keys()].some((t) => IDENTIFYING_TAGS.has(t));

  const exifOffset = ifd0.get(EXIF_IFD_TAG);
  if (exifOffset !== undefined) {
    const sub = readIfd(exifOffset);
    if (!sub) return { gps, identifying: true };
    identifying ||= [...sub.keys()].some((t) => IDENTIFYING_TAGS.has(t));
  }
  return { gps, identifying };
}

function scanJpeg(bytes: Uint8Array): ImageMetadataReport {
  const found: ImageMetadataReport["found"] = [];
  let at = 2; // after SOI (FF D8)

  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return { format: "jpeg", found, clean: null };
    const marker = bytes[at + 1];
    // Fill bytes and markers with no length field.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // Start of scan: entropy-coded image data follows, and metadata segments
    // only ever come before it.
    if (marker === 0xda || marker === 0xd9) {
      return { format: "jpeg", found, clean: found.length === 0 };
    }

    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const payload = at + 4;
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return { format: "jpeg", found, clean: null };

    if (marker === 0xe1 && startsWith(bytes, payload, "Exif\0\0")) {
      const exif = readExif(bytes.subarray(payload + 6, end));
      if (exif.identifying) found.push({ kind: "exif", offset: at });
      if (exif.gps) found.push({ kind: "gps", offset: at });
    } else if (marker === 0xe1 && startsWith(bytes, payload, "http://ns.adobe.com/xap/1.0/")) {
      found.push({ kind: "xmp", offset: at });
    } else if (marker === 0xed && startsWith(bytes, payload, "Photoshop 3.0")) {
      found.push({ kind: "iptc", offset: at });
    } else if (marker === 0xfe) {
      found.push({ kind: "comment", offset: at });
    }
    at = end;
  }
  // Ran out of bytes before the image data: truncated.
  return { format: "jpeg", found, clean: null };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function scanPng(bytes: Uint8Array): ImageMetadataReport {
  const found: ImageMetadataReport["found"] = [];
  let at = PNG_SIGNATURE.length;

  while (at + 8 <= bytes.length) {
    const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
    const type = ascii(bytes, at + 4, 4);
    const data = at + 8;
    const next = data + length + 4; // + CRC
    if (next > bytes.length) return { format: "png", found, clean: null };

    if (type === "eXIf") {
      const exif = readExif(bytes.subarray(data, data + length));
      if (exif.identifying) found.push({ kind: "exif", offset: at });
      if (exif.gps) found.push({ kind: "gps", offset: at });
    }
    else if (type === "iTXt" && startsWith(bytes, data, "XML:com.adobe.xmp")) found.push({ kind: "xmp", offset: at });
    else if (type === "tEXt" || type === "zTXt" || type === "iTXt") found.push({ kind: "comment", offset: at });
    else if (type === "IEND") return { format: "png", found, clean: found.length === 0 };
    at = next;
  }
  return { format: "png", found, clean: null };
}

export function findImageMetadata(bytes: Uint8Array): ImageMetadataReport {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return scanJpeg(bytes);
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return scanPng(bytes);
  return { format: "unknown", found: [], clean: null };
}
