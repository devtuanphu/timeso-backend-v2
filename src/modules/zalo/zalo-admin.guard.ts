import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const ZALO_ADMIN_ACCOUNT_IDS_ENV = 'ZALO_ADMIN_ACCOUNT_IDS';

/** Parses the comma-separated allowlist; blanks are dropped. */
export function parseZaloAdminAccountIds(raw: unknown): Set<string> {
  if (typeof raw !== 'string') return new Set();
  return new Set(
    raw
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

/**
 * Restricts the Zalo OA token-management routes to operator accounts.
 *
 * `init-token` replaces the system-wide ZNS token, so any signed-in user of
 * either app could hijack or disable OTP delivery. There is no admin role in
 * the codebase, so operators are listed by account id in
 * `ZALO_ADMIN_ACCOUNT_IDS` (comma-separated). When the variable is unset or
 * empty, everyone is denied. Must run after `JwtAuthGuard`.
 */
@Injectable()
export class ZaloAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const accountId: unknown = context.switchToHttp().getRequest().user?.userId;
    const allowed = parseZaloAdminAccountIds(
      this.configService.get<string>(ZALO_ADMIN_ACCOUNT_IDS_ENV),
    );
    if (typeof accountId === 'string' && allowed.has(accountId)) return true;
    throw new ForbiddenException({
      code: 'ZALO_ADMIN_REQUIRED',
      message: 'Bạn không có quyền quản lý tích hợp Zalo',
    });
  }
}
