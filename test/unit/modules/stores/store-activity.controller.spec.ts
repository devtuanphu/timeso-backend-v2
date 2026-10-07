jest.mock('../../../../src/common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  MyActivityLogQueryDto,
  StoreActivityLogQueryDto,
} from '../../../../src/modules/stores/dto/activity-log.dto';
import { StoreAccessGuard } from '../../../../src/modules/stores/guards/store-access.guard';
import { STORE_OWNER_ONLY_KEY } from '../../../../src/modules/stores/guards/store-owner-only.decorator';
import { StoreOwnerOnlyGuard } from '../../../../src/modules/stores/guards/store-owner-only.guard';
import { StoreActivityController } from '../../../../src/modules/stores/store-activity.controller';

const handler = (name: string) => (StoreActivityController.prototype as any)[name];
const isOwnerOnly = (name: string) =>
  Reflect.getMetadata(STORE_OWNER_ONLY_KEY, handler(name)) !== undefined;

describe('StoreActivityController routes', () => {
  it('runs the store tenancy guard and the owner-only guard', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, StoreActivityController);
    expect(guards).toEqual(
      expect.arrayContaining([StoreAccessGuard, StoreOwnerOnlyGuard]),
    );
  });

  it.each([
    ['getMyActivityLogs', ':storeId/me/activity-logs', false],
    ['getStoreActivityLogs', ':storeId/activity-logs', true],
    ['getOwnerNotificationSettings', ':id/owner-notification-settings', true],
    ['updateOwnerNotificationSettings', ':id/owner-notification-settings', true],
  ])('%s at %s (owner-only: %s)', (name, path, ownerOnly) => {
    expect(Reflect.getMetadata(PATH_METADATA, handler(name))).toBe(path);
    expect(isOwnerOnly(name)).toBe(ownerOnly);
  });

  it('staff feed is scoped to the caller’s account, owner feed passes filters', async () => {
    const activity = {
      listForStaff: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      listForOwner: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const controller = new StoreActivityController(activity as any, {} as any);
    await controller.getMyActivityLogs('store-1', { limit: 10 }, { userId: 'staff-1' });
    expect(activity.listForStaff).toHaveBeenCalledWith('store-1', 'staff-1', { limit: 10 });
    await controller.getStoreActivityLogs('store-1', { action: 'attendance.check_in' });
    expect(activity.listForOwner).toHaveBeenCalledWith('store-1', {
      action: 'attendance.check_in',
    });
  });

  it('settings are read and written for the calling owner', async () => {
    const owner = {
      getSettings: jest.fn().mockResolvedValue({}),
      updateSettings: jest.fn().mockResolvedValue({}),
    };
    const controller = new StoreActivityController({} as any, owner as any);
    await controller.getOwnerNotificationSettings('store-1', { userId: 'owner-1' });
    expect(owner.getSettings).toHaveBeenCalledWith('store-1', 'owner-1');
    await controller.updateOwnerNotificationSettings(
      'store-1',
      { preShiftMinutes: 15 },
      { userId: 'owner-1' },
    );
    expect(owner.updateSettings).toHaveBeenCalledWith('store-1', 'owner-1', {
      preShiftMinutes: 15,
    });
  });

  it('query DTOs: limit ≤ 50, known action codes, YYYY-MM-DD dates, uuid employee', async () => {
    const tooMany = plainToInstance(MyActivityLogQueryDto, { limit: '51' });
    expect((await validate(tooMany)).map((e) => e.property)).toEqual(['limit']);
    const fine = plainToInstance(MyActivityLogQueryDto, { limit: '50' });
    expect(await validate(fine)).toHaveLength(0);

    const bad = plainToInstance(StoreActivityLogQueryDto, {
      action: 'drop.table',
      from: '21/09/2026',
      employeeProfileId: 'emp-1',
    });
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual([
      'action',
      'employeeProfileId',
      'from',
    ]);
    const good = plainToInstance(StoreActivityLogQueryDto, {
      action: 'leave_request.approved',
      from: '2026-09-01',
      to: '2026-09-30',
      employeeProfileId: '00000000-0000-4000-8000-000000000001',
    });
    expect(await validate(good)).toHaveLength(0);
  });
});
