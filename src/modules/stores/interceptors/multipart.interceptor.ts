import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const multer = require('multer');
import { multerConfig } from '../../../common/utils/multer-config';

/**
 * Runs multer's `.any()` over the request before the handler.
 *
 * `AssetMultipartInterceptor` and `ProductMultipartInterceptor` were
 * byte-identical apart from a log string, so both now extend this single
 * implementation. The label only distinguishes them in logs.
 */
@Injectable()
export class MultipartInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MultipartInterceptor.name);

  private readonly upload = multer({
    ...multerConfig,
    limits: {
      fieldSize: 100 * 1024 * 1024,
      fileSize: 100 * 1024 * 1024,
    },
  }).any();

  constructor(private readonly label: string) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();

    return new Observable((subscriber) => {
      this.upload(req, res, (err: unknown) => {
        if (err) {
          this.logger.error(
            `[${this.label}] multipart parse failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          subscriber.error(err);
          return;
        }
        subscriber.next(true);
        subscriber.complete();
      });
    }).pipe(switchMap(() => next.handle()));
  }
}

@Injectable()
export class AssetMultipartInterceptor extends MultipartInterceptor {
  constructor() {
    super('Asset');
  }
}

@Injectable()
export class ProductMultipartInterceptor extends MultipartInterceptor {
  constructor() {
    super('Product');
  }
}
