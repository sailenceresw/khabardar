import { describe, expect, it } from "vitest";
import { findImageMetadata } from "@khabardar/shared";
import { assertPhotoMetadataRemoved, PhotoMetadataNotRemoved } from "../src/photoMetadata";
import { imageCheckCapabilities } from "../src/imageChecks";

/*
 * Images are built byte by byte so each test controls exactly which blocks are
 * present. The parser only reads container structure, so the pixel data can be
 * a few placeholder bytes.
 */

const bytes = (...parts: Array<number[] | string>) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

/** A JPEG segment: FF, marker, two-byte big-endian length (which counts itself), payload. */
function segment(marker: number, ...payload: Array<number[] | string>): number[] {
  const body = [...bytes(...payload)];
  const length = body.length + 2;
  return [0xff, marker, length >> 8, length & 0xff, ...body];
}

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
/** Start of scan with a minimal header, then a few bytes standing in for image data. */
const SCAN = [...segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), 0x12, 0x34, 0x56];
const JFIF = segment(0xe0, "JFIF\0", [0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);

const EXIF_POINTER = 0x8769;

/**
 * A TIFF header plus IFD0 holding the given tags, in either byte order. With
 * `subTags`, IFD0 also gets an Exif pointer to a sub-IFD holding those tags.
 */
function tiff(order: "II" | "MM", tags: number[], subTags?: number[]): number[] {
  const u16 = (n: number) => (order === "II" ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const u32 = (n: number) =>
    order === "II" ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  const ifd0Tags = subTags ? [...tags, EXIF_POINTER] : tags;
  const subOffset = 8 + 2 + ifd0Tags.length * 12 + 4;
  const entry = (tag: number) => [...u16(tag), ...u16(4), ...u32(1), ...u32(tag === EXIF_POINTER ? subOffset : 0)];
  const ifd = (list: number[]) => [...u16(list.length), ...list.flatMap(entry), ...u32(0)];
  return [...bytes(order), ...u16(42), ...u32(8), ...ifd(ifd0Tags), ...(subTags ? ifd(subTags) : [])];
}

const jpeg = (...segments: number[][]) => bytes(SOI, ...segments, SCAN, EOI);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function chunk(type: string, data: Array<number[] | string> = []): number[] {
  const body = [...bytes(...data)];
  const n = body.length;
  return [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, ...bytes(type), ...body, 0, 0, 0, 0];
}
const IHDR = chunk("IHDR", [[0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]]);
const png = (...chunks: number[][]) => bytes(PNG_SIG, IHDR, ...chunks, chunk("IDAT", [[0x78, 0x9c]]), chunk("IEND"));

describe("findImageMetadata on JPEG", () => {
  it("reports a plain re-encoded JPEG as clean", () => {
    expect(findImageMetadata(jpeg(JFIF))).toEqual({ format: "jpeg", found: [], clean: true });
  });

  it("finds camera make and model in Exif", () => {
    const report = findImageMetadata(jpeg(JFIF, segment(0xe1, "Exif\0\0", tiff("II", [0x010f, 0x0110]))));
    expect(report.found.map((f) => f.kind)).toEqual(["exif"]);
    expect(report.clean).toBe(false);
  });

  it.each(["II", "MM"] as const)("finds GPS and identifying fields in %s byte order", (order) => {
    const report = findImageMetadata(jpeg(segment(0xe1, "Exif\0\0", tiff(order, [0x010f, 0x8825]))));
    expect(report.found.map((f) => f.kind)).toEqual(["exif", "gps"]);
  });

  it("finds GPS on its own", () => {
    const report = findImageMetadata(jpeg(segment(0xe1, "Exif\0\0", tiff("MM", [0x0112, 0x8825]))));
    expect(report.found.map((f) => f.kind)).toEqual(["gps"]);
  });

  it("finds a capture date in the Exif sub-IFD", () => {
    const report = findImageMetadata(jpeg(segment(0xe1, "Exif\0\0", tiff("II", [0x0112], [0xa001, 0x9003]))));
    expect(report.found.map((f) => f.kind)).toEqual(["exif"]);
  });

  it.each(["II", "MM"] as const)("allows an Exif block with only technical fields (%s)", (order) => {
    // Orientation and resolution in IFD0; colour space and pixel size in the sub-IFD.
    const technical = segment(0xe1, "Exif\0\0", tiff(order, [0x0112, 0x011a, 0x011b, 0x0128], [0xa001, 0xa002, 0xa003]));
    expect(findImageMetadata(jpeg(JFIF, technical))).toEqual({ format: "jpeg", found: [], clean: true });
  });

  it("treats an Exif block it cannot read as identifying", () => {
    const report = findImageMetadata(jpeg(segment(0xe1, "Exif\0\0", [1, 2, 3])));
    expect(report.found.map((f) => f.kind)).toEqual(["exif"]);
  });

  it("treats an Exif pointer past the end as identifying", () => {
    const broken = tiff("II", [0x0112], [0xa001]).slice(0, -10);
    expect(findImageMetadata(jpeg(segment(0xe1, "Exif\0\0", broken))).found.map((f) => f.kind)).toEqual(["exif"]);
  });

  it("finds XMP, IPTC and a comment, in file order", () => {
    const report = findImageMetadata(
      jpeg(
        segment(0xe1, "http://ns.adobe.com/xap/1.0/\0", "<x:xmpmeta/>"),
        segment(0xed, "Photoshop 3.0\0", "8BIM"),
        segment(0xfe, "taken by Sunita")
      )
    );
    expect(report.found.map((f) => f.kind)).toEqual(["xmp", "iptc", "comment"]);
  });

  it("ignores metadata-free segments such as an ICC profile", () => {
    expect(findImageMetadata(jpeg(JFIF, segment(0xe2, "ICC_PROFILE\0", [1, 1]))).clean).toBe(true);
  });

  it("cannot tell when a segment runs past the end of the file", () => {
    const truncated = bytes(SOI, [0xff, 0xe1, 0x40, 0x00], "Exif");
    expect(findImageMetadata(truncated).clean).toBeNull();
  });

  it("cannot tell when the file stops before the image data", () => {
    expect(findImageMetadata(bytes(SOI, JFIF)).clean).toBeNull();
  });

  it("cannot tell when a marker is missing its FF prefix", () => {
    expect(findImageMetadata(bytes(SOI, [0x00, 0xe0, 0x00, 0x04, 0, 0], SCAN)).clean).toBeNull();
  });
});

describe("findImageMetadata on PNG", () => {
  it("reports a plain PNG as clean", () => {
    expect(findImageMetadata(png())).toEqual({ format: "png", found: [], clean: true });
  });

  it("finds eXIf, XMP and text chunks", () => {
    const report = findImageMetadata(
      png(chunk("eXIf", [tiff("MM", [0x8825])]), chunk("iTXt", ["XML:com.adobe.xmp\0"]), chunk("tEXt", ["Author\0Ram"]))
    );
    expect(report.found.map((f) => f.kind)).toEqual(["gps", "xmp", "comment"]);
  });

  it("finds identifying Exif in an eXIf chunk", () => {
    expect(findImageMetadata(png(chunk("eXIf", [tiff("II", [0x0110])]))).found.map((f) => f.kind)).toEqual(["exif"]);
  });

  it("cannot tell when IEND never arrives", () => {
    expect(findImageMetadata(bytes(PNG_SIG, IHDR)).clean).toBeNull();
  });
});

describe("findImageMetadata on other bytes", () => {
  it.each([
    ["empty", new Uint8Array()],
    ["text", bytes("not an image")],
    ["a GIF", bytes("GIF89a")],
  ])("cannot tell for %s", (_label, input) => {
    expect(findImageMetadata(input)).toEqual({ format: "unknown", found: [], clean: null });
  });
});

describe("assertPhotoMetadataRemoved", () => {
  it("accepts a clean photo", () => {
    expect(() => assertPhotoMetadataRemoved(jpeg(JFIF))).not.toThrow();
  });

  it("refuses a photo that still has GPS and names what it found", () => {
    const withGps = jpeg(segment(0xe1, "Exif\0\0", tiff("II", [0x0110, 0x8825])));
    expect(() => assertPhotoMetadataRemoved(withGps)).toThrow(PhotoMetadataNotRemoved);
    expect(() => assertPhotoMetadataRemoved(withGps)).toThrow(/exif, gps/);
  });

  it("accepts a photo whose encoder wrote only technical Exif", () => {
    expect(() => assertPhotoMetadataRemoved(jpeg(segment(0xe1, "Exif\0\0", tiff("MM", [0x0112], [0xa001]))))).not.toThrow();
  });

  it("refuses a photo it cannot read, rather than assuming it is clean", () => {
    expect(() => assertPhotoMetadataRemoved(bytes("garbage"))).toThrow(PhotoMetadataNotRemoved);
  });
});

describe("imageCheckCapabilities", () => {
  it("always checks metadata", () => {
    expect(imageCheckCapabilities("ios").metadata.available).toBe(true);
    expect(imageCheckCapabilities("web").metadata.available).toBe(true);
  });

  it("reports face and text checks as unavailable on web, with the reason", () => {
    const caps = imageCheckCapabilities("web");
    expect(caps.faces).toEqual({ available: false, reason: "web" });
    expect(caps.text).toEqual({ available: false, reason: "web" });
  });

  it("reports them as not built yet on a phone, rather than pretending to check", () => {
    expect(imageCheckCapabilities("android").faces).toEqual({ available: false, reason: "not-built" });
  });
});
