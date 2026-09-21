import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZaloAdminGuard, parseZaloAdminAccountIds } from './zalo-admin.guard';
import { ZaloController } from './zalo.controller';

function contextFor(userId?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: userId ? { userId } : undefined }),
    }),
  } as any;
}

const guardWith = (value: string | undefined) =>
  new ZaloAdminGuard({ get: jest.fn().mockReturnValue(value) } as any);

describe('ZaloAdminGuard', () => {
  it('allows an account listed in ZALO_ADMIN_ACCOUNT_IDS', () => {
    expect(guardWith(' admin-1 , admin-2 ').canActivate(contextFor('admin-2'))).toBe(true);
  });

  it('refuses any other signed-in account', () => {
    expect(() => guardWith('admin-1').canActivate(contextFor('owner-1'))).toThrow(
      ForbiddenException,
    );
  });

  it.each([undefined, '', ' , '])('denies everyone when the allowlist is %p', (value) => {
    expect(() => guardWith(value).canActivate(contextFor('admin-1'))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses a request with no principal', () => {
    expect(() => guardWith('admin-1').canActivate(contextFor())).toThrow(
      ForbiddenException,
    );
  });

  it('parses the list and drops blanks', () => {
    expect([...parseZaloAdminAccountIds('a,,b , ')]).toEqual(['a', 'b']);
    expect(parseZaloAdminAccountIds(undefined).size).toBe(0);
  });

  it.each(['initToken', 'getOAuthUrl', 'getTokenStatus'])(
    'guards ZaloController.%s with JWT then the admin allowlist',
    (handler) => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        (ZaloController.prototype as any)[handler],
      );
      expect(guards).toEqual([JwtAuthGuard, ZaloAdminGuard]);
    },
  );

  // The OAuth provider redirects here without a token; it must stay public.
  it('leaves the OAuth callback unauthenticated', () => {
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        (ZaloController.prototype as any).oauthCallback,
      ),
    ).toBeUndefined();
  });
});
