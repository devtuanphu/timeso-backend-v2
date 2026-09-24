import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdirSync, promises as fsp } from 'fs';
import { diskStorage } from 'multer';
import { join, resolve as resolvePath, sep } from 'path';
import { Observable, catchError, from, mergeMap, throwError } from 'rxjs';

/**
 * Applicant selfies attached to a job application.
 *
 * A face photo is sensitive personal data, so it never lands in `./uploads`,
 * which `ServeStaticModule` publishes at `/uploads` without authentication. It
 * goes to a sibling directory under `./uploads-private/` (git-ignored, not
 * served statically) and is read back only through
 * `GET /stores/:storeId/job-applications/:applicationId/selfie`, which checks
 * that the caller is the store owner or the applicant.
 *
 * Only the bare filename is persisted (`store_job_applications.selfie_path`),
 * never a path, so the directory can move without a data migration and a
 * stored value can never point outside it.
 */
export const JOB_APPLICATION_SELFIE_DIR = './uploads-private/job-application-selfies';

/** Multipart file field carrying the selfie. */
export const JOB_APPLICATION_SELFIE_FIELD = 'selfie';

export const JOB_APPLICATION_SELFIE_MAX_BYTES = 5 * 1024 * 1024;

type SelfieMime = 'image/jpeg' | 'image/png';

const EXTENSION_BY_MIME: Record<SelfieMime, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/** `<uuid>.jpg` / `<uuid>.png` — exactly what the multer config below writes. */
const SAFE_SELFIE_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

export const isSafeSelfieFilename = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_SELFIE_FILENAME.test(value);

export const selfieContentType = (filename: string): SelfieMime =>
  filename.endsWith('.png') ? 'image/png' : 'image/jpeg';

/** Public route of the authenticated selfie reader (behind the `/api` prefix). */
export const jobApplicationSelfieUrl = (
  storeId: string,
  applicationId: string,
): string => `/api/stores/${storeId}/job-applications/${applicationId}/selfie`;

export const selfieInvalid = () =>
  new BadRequestException({
    code: 'JOB_APPLICATION_SELFIE_INVALID',
    message: 'Ảnh chân dung phải là ảnh JPEG hoặc PNG, tối đa 5 MB.',
  });

/**
 * Dedicated multer config for the selfie. The mimetype check here is only the
 * first gate — the client controls that header — so the content is verified
 * again by magic bytes in `JobApplicationSelfieStorage.verify` once written.
 *
 * The filename is derived from the verified mimetype, never from
 * `originalname`, so nothing the client names reaches the filesystem.
 */
export const jobApplicationSelfieMulterConfig = {
  storage: diskStorage({
    destination: (_req, _file, callback) => {
      mkdirSync(JOB_APPLICATION_SELFIE_DIR, { recursive: true });
      callback(null, JOB_APPLICATION_SELFIE_DIR);
    },
    filename: (_req, file, callback) => {
      const extension = EXTENSION_BY_MIME[file.mimetype as SelfieMime] ?? '.jpg';
      callback(null, `${randomUUID()}${extension}`);
    },
  }),
  limits: {
    fileSize: JOB_APPLICATION_SELFIE_MAX_BYTES,
    files: 1,
    // Text fields of CreateJobApplicationDto plus headroom; the introduction
    // is ≤1000 characters, so 64 KB per field is ample.
    fields: 20,
    fieldSize: 64 * 1024,
    parts: 25,
  },
  fileFilter: (
    _req: unknown,
    file: { mimetype: string },
    callback: (error: Error | null, accept: boolean) => void,
  ) => {
    if (!(file.mimetype in EXTENSION_BY_MIME)) {
      return callback(selfieInvalid(), false);
    }
    callback(null, true);
  },
};

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The subset of an uploaded multer file the service relies on. */
export interface UploadedSelfie {
  filename: string;
  path?: string;
  mimetype: string;
  size?: number;
}

/**
 * Filesystem access for selfies. A provider of its own so the service can be
 * unit-tested without touching disk, and so every path the service handles
 * goes through the same filename validation.
 */
@Injectable()
export class JobApplicationSelfieStorage {
  private readonly logger = new Logger(JobApplicationSelfieStorage.name);

  /** Absolute directory; overridable in tests. */
  directory = resolvePath(JOB_APPLICATION_SELFIE_DIR);

  /**
   * Absolute path of a stored selfie, or null when the name is not one this
   * service could have written (traversal, separators, other extensions).
   */
  resolve(filename: unknown): string | null {
    if (!isSafeSelfieFilename(filename)) return null;
    const absolute = resolvePath(join(this.directory, filename));
    return absolute.startsWith(`${this.directory}${sep}`) ? absolute : null;
  }

  /** True when the file exists and is a regular file. */
  async exists(filename: unknown): Promise<boolean> {
    const absolute = this.resolve(filename);
    if (!absolute) return false;
    try {
      return (await fsp.stat(absolute)).isFile();
    } catch {
      return false;
    }
  }

  /**
   * Confirms an upload is what it claims: a filename we generate, a declared
   * JPEG/PNG mimetype, and file content starting with that format's magic
   * bytes. Anything else is refused.
   */
  async verify(file: UploadedSelfie): Promise<boolean> {
    const absolute = this.resolve(file?.filename);
    if (!absolute) return false;
    const expected =
      file.mimetype === 'image/jpeg'
        ? JPEG_MAGIC
        : file.mimetype === 'image/png'
          ? PNG_MAGIC
          : null;
    if (!expected) return false;
    if (selfieContentType(file.filename) !== file.mimetype) return false;

    let handle: fsp.FileHandle | undefined;
    try {
      handle = await fsp.open(absolute, 'r');
      const header = Buffer.alloc(expected.length);
      const { bytesRead } = await handle.read(header, 0, expected.length, 0);
      return bytesRead === expected.length && header.equals(expected);
    } catch {
      return false;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  /**
   * Best-effort delete. Never throws: callers use it on cleanup paths where a
   * secondary error must not replace the real outcome. The filename is not
   * logged — it would tie a face photo to a request in the logs.
   */
  async remove(filename: unknown): Promise<boolean> {
    const absolute = this.resolve(filename);
    if (!absolute) return false;
    try {
      await fsp.unlink(absolute);
      return true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(
          `[JobApplicationSelfie] could not delete a selfie file (${error?.code ?? 'unknown'})`,
        );
      }
      return false;
    }
  }
}

/**
 * Deletes the uploaded selfie when the request fails anywhere downstream of
 * multer — most importantly in the global ValidationPipe, which runs after
 * interceptors and before the handler, so the service never sees the file.
 *
 * Safe for the success path by construction: `JobApplicationService.apply`
 * does not throw once the application row referencing the file is saved (all
 * post-save work is best-effort), so an error reaching here always means the
 * file is unreferenced.
 *
 * Must be listed BEFORE `FileInterceptor` in `@UseInterceptors` so it wraps it.
 */
@Injectable()
export class JobApplicationSelfieCleanupInterceptor implements NestInterceptor {
  constructor(private readonly storage: JobApplicationSelfieStorage) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      catchError((error) => {
        const file: UploadedSelfie | undefined = request?.file;
        if (!file?.filename) return throwError(() => error);
        return from(this.storage.remove(file.filename)).pipe(
          mergeMap(() => throwError(() => error)),
        );
      }),
    );
  }
}
