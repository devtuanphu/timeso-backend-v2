import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import { Store } from '../entities/store.entity';
import {
  STORE_OWNER_ONLY_KEY,
  STORE_OWNER_REQUIRED,
  STORE_SCOPE_CONFLICT,
  StoreOwnerOnlyOptions,
} from './store-owner-only.decorator';
import { StoreResourceLocator } from './store-resource.locator';

const ownerRequired = () =>
  new ForbiddenException({
    code: STORE_OWNER_REQUIRED,
    message: 'Chỉ chủ cửa hàng mới được thực hiện thao tác này',
  });

/** Adds a query/body value (string or string[]) to `into`, ignoring blanks. */
function collect(into: Set<string>, value: unknown): void {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item === 'string' && item) into.add(item);
  }
}

/**
 * Owner-only authorization for handlers marked `@StoreOwnerOnly()`.
 *
 * Handlers without the marker pass through; `StoreAccessGuard` and
 * `StoreResourceAccessGuard` still scope them by membership.
 *
 * For a marked handler, the target store is resolved from, in order:
 *   1. the `:id` / `:storeId` path parameter when the path starts with it;
 *   2. the row the route addresses (`StoreResourceLocator`), including
 *      soft-deleted employee profiles;
 *   3. `query.storeId`, when the decorator lists `storeFrom: ['query']`;
 *   4. JSON `body.storeId`, when the decorator lists `storeFrom: ['body']`;
 *   5. any `bodyResources` declared on the decorator.
 * Every source that is present must name the same store (else 403
 * STORE_SCOPE_CONFLICT). List sources (`bodyStoreIdLists`, array
 * `bodyResources`) must be owned entry by entry. If nothing resolves, the
 * request is refused (403 STORE_OWNER_REQUIRED) — never passed.
 *
 * A `query.storeId` / `body.storeId` the route did not opt into is still
 * checked when present (it must agree and be owned), but it is not proof: a
 * route whose only resolved store is such an ignored value is refused. Before
 * this, `?storeId=<own store>` authorized routes whose handler acted on a
 * row from another store.
 *
 * The caller must be `stores.owner_account_id` of every resolved store. A
 * missing store is 404, matching `assertOwnerStoreAccess`.
 */
@Injectable()
export class StoreOwnerOnlyGuard implements CanActivate {
  private readonly locator: StoreResourceLocator;

  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    this.locator = new StoreResourceLocator(dataSource);
  }

  /** The store id in the path, when the path is addressed by the store. */
  private static storeParam(path: string | null, params: any): string | null {
    if (!path) return null;
    if (path === ':storeId' || path.startsWith(':storeId/')) {
      return typeof params?.storeId === 'string' ? params.storeId : null;
    }
    if (path === ':id' || path.startsWith(':id/')) {
      return typeof params?.id === 'string' ? params.id : null;
    }
    return null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<
      StoreOwnerOnlyOptions | undefined
    >(STORE_OWNER_ONLY_KEY, [context.getHandler(), context.getClass()]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest();
    const accountId: string | undefined = request.user?.userId;
    if (!accountId) throw ownerRequired();

    const path = StoreResourceLocator.normalizePath(
      Reflect.getMetadata(PATH_METADATA, context.getHandler()),
    );
    // Multipart bodies are not parsed yet when guards run; treat them as absent.
    const body =
      request.body && typeof request.body === 'object' ? request.body : {};

    const targets = new Set<string>();
    const listed = new Set<string>();
    let ownerAccountResolved = false;
    // Stores that prove what the request addresses (vs. merely checked).
    const proofs = new Set<string>();
    const storeFrom = new Set(options.storeFrom ?? []);

    const paramStore = StoreOwnerOnlyGuard.storeParam(path, request.params);
    if (paramStore) {
      targets.add(paramStore);
      proofs.add(paramStore);
    }

    const location = await this.locator.locate(path, request);
    if (location.kind === 'store') {
      targets.add(location.storeId);
      proofs.add(location.storeId);
    }
    if (location.kind === 'ownerAccount') {
      if (location.ownerAccountId !== accountId) throw ownerRequired();
      ownerAccountResolved = true;
    }

    collect(targets, request.query?.storeId);
    collect(targets, body.storeId);
    if (storeFrom.has('query')) collect(proofs, request.query?.storeId);
    if (storeFrom.has('body')) collect(proofs, body.storeId);

    for (const { field, resource } of options.bodyResources ?? []) {
      const value: unknown = body[field];
      if (typeof value === 'string' && value) {
        const storeId = await this.locator.storeIdOf(resource, value);
        targets.add(storeId);
        proofs.add(storeId);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item !== 'string' || !item) continue;
          listed.add(await this.locator.storeIdOf(resource, item));
        }
      }
    }
    for (const field of options.bodyStoreIdLists ?? []) {
      if (Array.isArray(body[field])) collect(listed, body[field]);
    }

    if (targets.size > 1) {
      throw new ForbiddenException({
        code: STORE_SCOPE_CONFLICT,
        message: 'Yêu cầu tham chiếu nhiều cửa hàng khác nhau',
      });
    }

    const storeIds = [...new Set([...targets, ...listed])];
    if (proofs.size === 0 && listed.size === 0 && !ownerAccountResolved) {
      // Nothing the handler acts on names a store; an ignored query/body
      // storeId is not enough.
      throw ownerRequired();
    }
    if (storeIds.length === 0) return true;

    let stores: Pick<Store, 'id' | 'ownerAccountId'>[];
    try {
      stores = await this.dataSource.getRepository(Store).find({
        where: { id: In(storeIds) },
        select: ['id', 'ownerAccountId'],
      });
    } catch {
      // A malformed id (not a uuid) is rejected by Postgres.
      throw new NotFoundException('Cửa hàng không tồn tại');
    }

    for (const storeId of storeIds) {
      const store = stores.find((row) => row.id === storeId);
      if (!store) throw new NotFoundException('Cửa hàng không tồn tại');
      if (store.ownerAccountId !== accountId) throw ownerRequired();
    }
    return true;
  }
}
