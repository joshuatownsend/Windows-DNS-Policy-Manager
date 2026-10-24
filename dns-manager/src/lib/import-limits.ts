/** Largest file any import dialog will read into memory. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/** Most entries (records, policies, domains) one import will process. */
export const MAX_IMPORT_ENTRIES = 10_000;

/** Returns an error message when a picked file is too large to import, else null. */
export function checkImportFile(file: { size: number; name: string }): string | null {
  if (file.size > MAX_IMPORT_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `${file.name} is ${mb} MB; imports are limited to ${MAX_IMPORT_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}
