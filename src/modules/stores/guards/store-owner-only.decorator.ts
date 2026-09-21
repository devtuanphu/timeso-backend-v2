import { SetMetadata } from '@nestjs/common';

export const STORE_OWNER_ONLY_KEY = 'stores:owner-only';

/** Stable error codes returned by `StoreOwnerOnlyGuard`. */
export const STORE_OWNER_REQUIRED = 'STORE_OWNER_REQUIRED';
export const STORE_SCOPE_CONFLICT = 'STORE_SCOPE_CONFLICT';

/** Request locations that may name the target store as `storeId`. */
export type StoreIdSource = 'query' | 'body';

export interface StoreOwnerOnlyOptions {
  /**
   * Where the handler itself reads the target store from, besides the path.
   * Only a source listed here can *prove* which store the request addresses:
   * the guard authorizes against it and the handler must use that same value.
   * A `storeId` in an unlisted source is still checked (it must be owned and
   * agree with the other sources) but never counts as proof, because the
   * handler ignores it and acts on something else.
   */
  storeFrom?: StoreIdSource[];
  /**
   * JSON body fields naming a resource (a family in `RESOURCE_SCOPES`, e.g.
   * `employees`) whose store must be owned. A string value is a target store
   * source and must agree with the others; an array value is a list whose
   * every store must be owned.
   */
  bodyResources?: { field: string; resource: string }[];
  /** JSON body fields holding a list of store ids that must all be owned. */
  bodyStoreIdLists?: string[];
}

/**
 * Marks a handler as store-administration: only `stores.owner_account_id` of
 * the addressed store may call it. Enforced by `StoreOwnerOnlyGuard`, which
 * must be in the controller's guard chain.
 *
 * The guard fails closed: a decorated route whose store cannot be resolved is
 * refused. Multipart routes cannot use this (the body is parsed after guards
 * run) unless the store is in the path or addressed resource.
 */
export const StoreOwnerOnly = (options: StoreOwnerOnlyOptions = {}) =>
  SetMetadata(STORE_OWNER_ONLY_KEY, options);
