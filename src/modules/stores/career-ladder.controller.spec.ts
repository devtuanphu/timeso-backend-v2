// Cấu hình upload kéo theo gói uuid bản ESM mà Jest không parse được; spec
// controller sẵn có cũng mock nó theo cách này.
jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => `/api/accounts/identity/image/${filename}`,
}));

import { ForbiddenException } from '@nestjs/common';

import { StoresController } from './stores.controller';

/**
 * StoreAccessGuard và StoreResourceAccessGuard chỉ kiểm "tài khoản có thuộc
 * cửa hàng này không" và cho qua cả nhân viên đang làm. Các route lộ trình là
 * việc của chủ, nên chúng tự gọi assertOwnerStoreAccess.
 *
 * Trước khi có kiểm tra này, một nhân viên gửi
 * `POST /stores/employees/<hồ sơ của chính mình>/advance {"force": true}` là
 * tự thăng chức, bỏ qua mọi điều kiện. Các test dưới đây giữ cho lỗ đó đóng.
 */
const STORE = 'store-1';
const PROFILE = 'profile-1';
const OWNER = 'owner-account';
const EMPLOYEE = 'employee-account';

function build() {
  // Chỉ chủ của STORE mới qua; mọi tài khoản khác bị từ chối như thật.
  const storesService = {
    assertOwnerStoreAccess: jest.fn(
      async (storeId: string, accountId: string) => {
        if (storeId !== STORE || accountId !== OWNER) {
          throw new ForbiddenException(
            'Bạn không có quyền truy cập cửa hàng này',
          );
        }
        return { id: storeId, ownerAccountId: OWNER };
      },
    ),
  };
  const careerLadderService = {
    storeIdOfProfile: jest.fn().mockResolvedValue(STORE),
    assertCanViewOwnCareer: jest.fn(async (_profileId: string, accountId: string) => {
      if (accountId !== OWNER && accountId !== EMPLOYEE) {
        throw new ForbiddenException('Bạn chỉ có thể xem lộ trình của chính mình');
      }
    }),
    getCareerSummary: jest.fn().mockResolvedValue({ ladders: [] }),
    getLadders: jest.fn().mockResolvedValue([]),
    createLadder: jest.fn().mockResolvedValue({}),
    createRung: jest.fn().mockResolvedValue({}),
    updateRung: jest.fn().mockResolvedValue({}),
    deleteRung: jest.fn().mockResolvedValue({}),
    setRungCriteria: jest.fn().mockResolvedValue({}),
    setRungNextRungs: jest.fn().mockResolvedValue({}),
    getCareerHistory: jest.fn().mockResolvedValue([]),
    nextRungs: jest.fn().mockResolvedValue([]),
    advance: jest.fn().mockResolvedValue({}),
    getCapabilityEntries: jest.fn().mockResolvedValue([]),
    awardCapabilityPoints: jest.fn().mockResolvedValue({}),
  };
  const controller = new StoresController(
    storesService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    careerLadderService as any,
  );
  return { controller, storesService, careerLadderService };
}

const asOwner = { userId: OWNER };
const asEmployee = { userId: EMPLOYEE };

describe('lộ trình — chỉ chủ cửa hàng mới được thao tác', () => {
  // Đây là lỗ hổng gốc: tự thăng chức bằng cờ force.
  it('nhân viên không tự thăng chức được, kể cả khi gửi force', async () => {
    const { controller, careerLadderService } = build();

    await expect(
      controller.advanceEmployee(
        PROFILE,
        { rungId: 'rung-top', force: true },
        asEmployee,
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(careerLadderService.advance).not.toHaveBeenCalled();
  });

  it('nhân viên không tự cộng điểm năng lực được', async () => {
    const { controller, careerLadderService } = build();

    await expect(
      controller.awardCapabilityPoints(PROFILE, { points: 1000 }, asEmployee),
    ).rejects.toThrow(ForbiddenException);

    expect(careerLadderService.awardCapabilityPoints).not.toHaveBeenCalled();
  });

  it('nhân viên không xoá được điều kiện lên bậc', async () => {
    const { controller, careerLadderService } = build();

    await expect(
      controller.setRungCriteria(STORE, 'rung-1', { items: [] }, asEmployee),
    ).rejects.toThrow(ForbiddenException);

    expect(careerLadderService.setRungCriteria).not.toHaveBeenCalled();
  });

  // Route theo hồ sơ phải tra đúng cửa hàng của hồ sơ trước khi kiểm chủ —
  // nếu không, chủ cửa hàng này thao tác được nhân viên của cửa hàng khác.
  it('tra cửa hàng của hồ sơ rồi mới kiểm chủ', async () => {
    const { controller, careerLadderService, storesService } = build();

    await controller.advanceEmployee(PROFILE, { rungId: 'rung-2' }, asOwner);

    expect(careerLadderService.storeIdOfProfile).toHaveBeenCalledWith(PROFILE);
    expect(storesService.assertOwnerStoreAccess).toHaveBeenCalledWith(
      STORE,
      OWNER,
    );
    expect(careerLadderService.advance).toHaveBeenCalled();
  });

  it('chủ cửa hàng khác không thao tác được nhân viên của cửa hàng này', async () => {
    const { controller, careerLadderService } = build();
    careerLadderService.storeIdOfProfile.mockResolvedValue('store-khac');

    await expect(
      controller.advanceEmployee(PROFILE, { rungId: 'rung-2' }, asOwner),
    ).rejects.toThrow(ForbiddenException);

    expect(careerLadderService.advance).not.toHaveBeenCalled();
  });

  // Mọi route mới đều phải bị chặn với nhân viên. Liệt kê hết để route thêm
  // sau này mà quên kiểm chủ thì test này đỏ ngay.
  it.each([
    ['getLadders', (c: any) => c.getLadders(STORE, asEmployee)],
    ['createLadder', (c: any) => c.createLadder(STORE, {}, asEmployee)],
    ['createRung', (c: any) => c.createRung(STORE, 'ladder-1', {}, asEmployee)],
    ['updateRung', (c: any) => c.updateRung(STORE, 'rung-1', {}, asEmployee)],
    ['deleteRung', (c: any) => c.deleteRung(STORE, 'rung-1', asEmployee)],
    [
      'setRungCriteria',
      (c: any) => c.setRungCriteria(STORE, 'rung-1', {}, asEmployee),
    ],
    [
      'setRungNextRungs',
      (c: any) => c.setRungNextRungs(STORE, 'rung-1', {}, asEmployee),
    ],
    ['getCareerHistory', (c: any) => c.getCareerHistory(PROFILE, asEmployee)],
    [
      'getNextRungs',
      (c: any) => c.getNextRungs(PROFILE, 'ladder-1', asEmployee),
    ],
    ['advanceEmployee', (c: any) => c.advanceEmployee(PROFILE, {}, asEmployee)],
    [
      'getCapabilityEntries',
      (c: any) => c.getCapabilityEntries(PROFILE, asEmployee),
    ],
    [
      'awardCapabilityPoints',
      (c: any) => c.awardCapabilityPoints(PROFILE, {}, asEmployee),
    ],
  ])('%s từ chối nhân viên', async (_name, call) => {
    const { controller } = build();
    await expect(call(controller)).rejects.toThrow(ForbiddenException);
  });

  // Route tóm tắt dành cho app nhân viên: không dùng kiểm chủ, mà kiểm
  // "chủ hoặc chính mình" — và phải kiểm TRƯỚC khi đọc dữ liệu.
  it('career-summary kiểm quyền trước khi đọc dữ liệu', async () => {
    const { controller, careerLadderService } = build();

    await controller.getCareerSummary(PROFILE, asEmployee);
    expect(careerLadderService.assertCanViewOwnCareer).toHaveBeenCalledWith(PROFILE, EMPLOYEE);
    expect(careerLadderService.getCareerSummary).toHaveBeenCalledWith(PROFILE);

    careerLadderService.getCareerSummary.mockClear();
    await expect(
      controller.getCareerSummary(PROFILE, { userId: 'account-coworker' }),
    ).rejects.toThrow(ForbiddenException);
    expect(careerLadderService.getCareerSummary).not.toHaveBeenCalled();
  });
});
