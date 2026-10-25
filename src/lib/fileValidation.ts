/** Allowed MIME types — MUST match the homework-files bucket allowlist
 * (migration 20260601090100). 17 entries. */
export const HOMEWORK_FILE_ALLOWED_MIMES: readonly string[] = [
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "application/rtf", "text/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
];

/** `accept` attribute for the file input. */
export const HOMEWORK_FILE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.rtf,.odt,.ods,.odp";

export const HOMEWORK_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — matches bucket
export const HOMEWORK_MAX_FILES = 10;

/** Extensions explicitly blocked even if a browser reports an empty/mismatched MIME. */
const BLOCKED_EXT = /\.(mp4|mov|avi|mkv|webm|mp3|wav|m4a|aac|ogg|flac|zip|rar|7z|tar|gz|exe|msi|dmg|app|sh|bat)$/i;

export interface FileValidationConfig {
  allowedMimes: readonly string[];
  maxBytes: number;
}

/** Returns null if valid, else a human-friendly error message. */
export function validateFileUpload(file: File, cfg: FileValidationConfig): string | null {
  if (BLOCKED_EXT.test(file.name)) {
    return `"${file.name}" is a blocked type (video, audio, archive, or executable).`;
  }
  if (file.type && !cfg.allowedMimes.includes(file.type)) {
    return `"${file.name}" isn't an allowed type. Use images, PDF, Word, PowerPoint, Excel, or text files.`;
  }
  if (file.size > cfg.maxBytes) {
    return `"${file.name}" is larger than ${Math.round(cfg.maxBytes / (1024 * 1024))} MB.`;
  }
  return null;
}
