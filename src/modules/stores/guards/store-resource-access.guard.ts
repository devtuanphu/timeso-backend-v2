import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { StoreAccessResolver } from './store-access.resolver';
import { StoreResourceLocator } from './store-resource.locator';

/**
 * Tenancy guard for routes addressed by a sub-resource id.
 *
 * `StoreAccessGuard` covers routes whose path begins with the store itself
 * (`:id/...`, `:storeId/...`). It cannot cover `employees/:profileId`,
 * `payrolls/:payrollId`, `stock-transactions/:transactionId` and the rest,
 * because the store is not in the URL — it has to be read from the row.
 *
 * This guard does that: `StoreResourceLocator` maps the route to an entity,
 * loads the row named by the route parameter, and this guard applies the same
 * owner-or-current-employee rule.
 *
 * Once a route is mapped it fails closed: a missing row, a broken hop or a
 * null store column is a 404. Unmapped routes (and routes with no parameter)
 * pass through unchanged — ACCOUNT and PUBLIC routes live on this controller
 * too. Owner-only routes are enforced separately by `StoreOwnerOnlyGuard`.
 *
 * ## What neither guard can reach
 *
 * Collection and report routes (`POST employees/manual`, `GET kpi-tasks`,
 * `GET monthly-salary-fund`, ...) carry the store in the body or query string,
 * not the path. No path-based guard can scope those; they need the check in
 * the service method that reads the store id. They are the remaining gap.
 */
@Injectable()
export class StoreResourceAccessGuard implements CanActivate {
  private readonly locator: StoreResourceLocator;

  constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly accessResolver: StoreAccessResolver,
  ) {
    this.locator = new StoreResourceLocator(dataSource);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const path = StoreResourceLocator.normalizePath(
      Reflect.getMetadata(PATH_METADATA, context.getHandler()),
    );

    const accountId: string | undefined = request.user?.userId;
    const location = await this.locator.locate(path, request);

    // Family not mapped (or no parameter): leave the route as it was.
    if (location.kind === 'unmapped') return true;

    if (!accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    // `salary-configs/:configId` is an owner-account boundary, not a store
    // one; `StoreOwnerOnlyGuard` enforces it on every such route.
    if (location.kind === 'ownerAccount') return true;

    return this.accessResolver.assertAccess(location.storeId, accountId);
  }
}
