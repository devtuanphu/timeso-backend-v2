import { extname } from 'path';

/**
 * Signed employment contracts hold salary and personal data, so, like identity
 * scans, they stay out of the public `./uploads` and are read back through
 * the owner-only `GET stores/employees/contracts/:contractId/file`.
 *
 * Kept apart from multer-config (which pulls in `uuid`) so the service can
 * import it without loading the upload machinery.
 */
export const CONTRACT_UPLOAD_DIR = './uploads-private/contracts';

/** Accepted extensions and the MIME types each may carry. */
export const CONTRACT_FILE_TYPES: Record<string, readonly string[]> = {
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
};

/** Content-Type to serve a stored contract file with, by its extension. */
export const contractFileContentType = (filename: string): string =>
  CONTRACT_FILE_TYPES[extname(filename).toLowerCase()]?.[0] ??
  'application/octet-stream';
