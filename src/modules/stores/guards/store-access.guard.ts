import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { StoreAccessResolver } from './store-access.resolver';

/**
 * Tenancy guard for store-addressed routes.
 *
 * `StoresController` is guarded only by `JwtAuthGuard`, which proves that
 * *someone* is signed in. Authorization was left to each service, and only a
 * minority of handlers did it, so an authenticated account could read and
 * mutate another store's payroll, stock and orders by supplying its UUID.
 *
 * Access is granted to the store owner and to anyone holding a non-terminated
 * employee profile at that store — the same rule
 * `assertStoreRevenueReportAccess` already applies. It is a tenancy boundary,
 * not a role check: it does not distinguish roles inside a store.
 *
 * ## Why it reads the route pattern
 *
 * On this controller `:id` is not always a store id — it is the store for
 * `GET :id/payrolls`, but a KPI id for `DELETE employee-kpis/:id`. A guard that
 * blindly read `params.id` would reject most of the controller. So the guard
 * inspects the handler's declared path and acts only when the store parameter
 * is unambiguous:
 *
 *   - the path starts with `:storeId`  -> `params.storeId`
 *   - the path is `:id` or starts `:id/` -> `params.id`
 *   - anything else                     -> not store-addressed, passes through
 *
 * Routes that address a sub-resource by its own id (`employees/:profileId`,
 * `employee-salaries/:salaryId`, ...) therefore keep whatever checking their
 * service already does. Scoping those requires resolving each entity to its
 * store first and is deliberately out of this guard's scope.
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(private readonly accessResolver: StoreAccessResolver) {}

  /** The store id this route addresses, or null when it addresses none. */
  private resolveStoreId(context: ExecutionContext): string | null {
    const path = Reflect.getMetadata(
      PATH_METADATA,
      context.getHandler(),
    ) as unknown;
    if (typeof path !== 'string') return null;

    const normalized = path.replace(/^\/+/, '');
    const params = context.switchToHttp().getRequest().params ?? {};

    if (normalized === ':storeId' || normalized.startsWith(':storeId/')) {
      return typeof params.storeId === 'string' ? params.storeId : null;
    }
    if (normalized === ':id' || normalized.startsWith(':id/')) {
      return typeof params.id === 'string' ? params.id : null;
    }
    return null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const storeId = this.resolveStoreId(context);
    // Not a store-addressed route; this guard has nothing to say about it.
    if (!storeId) return true;

    const accountId: string | undefined = context
      .switchToHttp()
      .getRequest()
      .user?.userId;
    if (!accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    return this.accessResolver.assertAccess(storeId, accountId);
  }
}
