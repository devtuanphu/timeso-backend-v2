import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

const UPLOADS_URL_PREFIX = '/uploads/';
const MAX_FILE_URL_LENGTH = 512;

/** The public uploads directory served at `/uploads` (see `app.module.ts`). */
export const defaultUploadsRoot = () => path.resolve(process.cwd(), 'uploads');

/**
 * Turns a client-supplied `fileUrl` (as returned by the contract-template
 * upload route, `/uploads/<name>.docx`) into an absolute path that is
 * guaranteed to lie inside the uploads directory.
 *
 * - 400 when the body value is not a usable `.docx` upload URL;
 * - 404 when it resolves outside the uploads directory (`../`, absolute
 *   paths, symlinks out) or the file does not exist.
 */
export function resolveUploadedDocxPath(
  fileUrl: unknown,
  uploadsRoot: string = defaultUploadsRoot(),
): string {
  if (
    typeof fileUrl !== 'string' ||
    !fileUrl.trim() ||
    fileUrl.length > MAX_FILE_URL_LENGTH ||
    fileUrl.includes('\0')
  ) {
    throw new BadRequestException('fileUrl is required');
  }

  const relative = fileUrl.startsWith(UPLOADS_URL_PREFIX)
    ? fileUrl.slice(UPLOADS_URL_PREFIX.length)
    : fileUrl;
  if (!relative.toLowerCase().endsWith('.docx')) {
    throw new BadRequestException('fileUrl must point to an uploaded .docx file');
  }

  const notFound = () => new NotFoundException('Không tìm thấy file');
  const root = path.resolve(uploadsRoot);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) throw notFound();
  if (!fs.existsSync(resolved)) throw notFound();

  // Re-check after following symlinks, so a link inside uploads cannot point
  // the parser at a file elsewhere on the server.
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(resolved);
  if (!realFile.startsWith(realRoot + path.sep)) throw notFound();
  if (!fs.statSync(realFile).isFile()) throw notFound();
  return realFile;
}
