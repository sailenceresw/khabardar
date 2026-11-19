import { findImageMetadata, type ImageMetadataReport } from "@khabardar/shared";

/** A re-encoded photo still carried metadata, or could not be checked, so it was not stored. */
export class PhotoMetadataNotRemoved extends Error {
  constructor(readonly report: ImageMetadataReport) {
    super(
      report.clean === null
        ? "Could not confirm the photo is free of metadata, so it was not attached."
        : `The photo still carried ${report.found.map((f) => f.kind).join(", ")} after re-encoding, so it was not attached.`
    );
    this.name = "PhotoMetadataNotRemoved";
  }
}

/**
 * Check the re-encoded bytes rather than trusting the re-encoder. A platform
 * or library change that started copying Exif across would otherwise go
 * unnoticed until someone read a GPS position out of a report. This fails
 * closed: a photo that cannot be confirmed clean is not stored.
 *
 * Kept apart from evidence.ts so it can be tested without the picker and
 * audio native modules.
 */
export function assertPhotoMetadataRemoved(bytes: Uint8Array): void {
  const report = findImageMetadata(bytes);
  if (report.clean !== true) throw new PhotoMetadataNotRemoved(report);
}
