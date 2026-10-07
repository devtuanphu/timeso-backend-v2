import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ALLOWED_LATE_MINUTES_MAX,
  ATTENDANCE_RADIUS_MAX,
  ATTENDANCE_WINDOW_MINUTES_MAX,
  ATTENDANCE_RADIUS_MIN,
  StoreTimekeepingSettingDto,
} from '../../../../../src/modules/stores/dto/store-timekeeping-setting.dto';

const errorsFor = async (body: Record<string, unknown>) => {
  const dto = plainToInstance(StoreTimekeepingSettingDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return errors.map((error) => error.property);
};

describe('StoreTimekeepingSettingDto — store location fields', () => {
  it('accepts the radius the owner sets on "Vị trí cửa hàng"', async () => {
    expect(await errorsFor({ attendanceRadius: 50 })).toEqual([]);
    expect(await errorsFor({ attendanceRadius: ATTENDANCE_RADIUS_MIN })).toEqual([]);
    expect(await errorsFor({ attendanceRadius: ATTENDANCE_RADIUS_MAX })).toEqual([]);
  });

  it('rejects a radius outside the bounds or not a whole number', async () => {
    expect(await errorsFor({ attendanceRadius: ATTENDANCE_RADIUS_MIN - 1 })).toEqual([
      'attendanceRadius',
    ]);
    expect(await errorsFor({ attendanceRadius: ATTENDANCE_RADIUS_MAX + 1 })).toEqual([
      'attendanceRadius',
    ]);
    expect(await errorsFor({ attendanceRadius: 25.5 })).toEqual(['attendanceRadius']);
    expect(await errorsFor({ attendanceRadius: '50' })).toEqual(['attendanceRadius']);
  });

  it('accepts requireQrScan as a boolean only', async () => {
    expect(await errorsFor({ requireQrScan: false })).toEqual([]);
    expect(await errorsFor({ requireQrScan: 'no' })).toEqual(['requireQrScan']);
  });
});

describe('StoreTimekeepingSettingDto — attendance minute rules', () => {
  it('accepts whole minutes within the bounds, including 0', async () => {
    expect(
      await errorsFor({
        allowedLateMinutes: 0,
        earlyCheckinMinutes: 0,
        lateCheckoutMinutes: 0,
        overtimeMultiplier: 0,
      }),
    ).toEqual([]);
    expect(
      await errorsFor({
        allowedLateMinutes: ALLOWED_LATE_MINUTES_MAX,
        earlyCheckinMinutes: ATTENDANCE_WINDOW_MINUTES_MAX,
        lateCheckoutMinutes: ATTENDANCE_WINDOW_MINUTES_MAX,
        overtimeMultiplier: 1.5,
      }),
    ).toEqual([]);
  });

  it('rejects negative, fractional or too large minutes', async () => {
    expect(await errorsFor({ allowedLateMinutes: -1 })).toEqual([
      'allowedLateMinutes',
    ]);
    expect(
      await errorsFor({ allowedLateMinutes: ALLOWED_LATE_MINUTES_MAX + 1 }),
    ).toEqual(['allowedLateMinutes']);
    expect(await errorsFor({ earlyCheckinMinutes: 2.5 })).toEqual([
      'earlyCheckinMinutes',
    ]);
    expect(
      await errorsFor({ lateCheckoutMinutes: ATTENDANCE_WINDOW_MINUTES_MAX + 1 }),
    ).toEqual(['lateCheckoutMinutes']);
    expect(await errorsFor({ overtimeMultiplier: -1 })).toEqual([
      'overtimeMultiplier',
    ]);
  });

  it('keeps accepting a large stored overtime multiplier (not applied yet)', async () => {
    expect(await errorsFor({ overtimeMultiplier: 15 })).toEqual([]);
  });

  it('explains a rejected minute value in Vietnamese', async () => {
    const dto = plainToInstance(StoreTimekeepingSettingDto, {
      lateCheckoutMinutes: 300,
    });
    const [error] = await validate(dto);
    expect(Object.values(error.constraints ?? {})).toEqual([
      'Thời gian check-out sau giờ làm phải là số phút nguyên từ 0 đến 240.',
    ]);
  });
});
