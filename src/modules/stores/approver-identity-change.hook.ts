/**
 * A4(b) decoupling seam. The accounts module lets a user edit their own identity
 * document (POST /accounts/identity). When that account is currently an ACTIVE
 * approver in any store, the store owner must be told and an activity log
 * written — but the accounts module must NOT reach into stores internals
 * (NotificationsModule already depends on AccountsModule, so a direct import
 * would be a cycle). The accounts controller therefore injects THIS token
 * `@Optional()` and fires the hook; the stores side provides the implementation
 * through a global module. Absent (unit doubles) → no-op.
 */
export const APPROVER_IDENTITY_CHANGE_HOOK = Symbol(
  'APPROVER_IDENTITY_CHANGE_HOOK',
);

export interface ApproverIdentityChangeHook {
  /**
   * Called after an account's identity document number actually changed. Finds
   * the stores where this account is an active approver, notifies each owner
   * (name only, never the numbers) and writes an activity log. Best-effort: it
   * must never throw into the identity-update request.
   */
  onIdentityDocumentChanged(accountId: string): Promise<void>;
}
