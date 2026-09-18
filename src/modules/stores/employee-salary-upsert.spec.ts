// stores.service kéo theo cấu hình upload dùng uuid bản ESM mà Jest không parse.
jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
}));

import { StoresService } from './stores.service';
import { PaymentStatus } from './entities/employee-salary.entity';
import { PaymentType } from './entities/employee-contract.entity';

/**
 * Xoá nhân viên khỏi cửa hàng chỉ xoá mềm hồ sơ; phiếu lương tháng đó vẫn nằm
 * lại. Nhận lại đúng người đó trong cùng tháng từng đụng ràng buộc duy nhất
 * (employee_profile_id, month), làm cả giao dịch thêm nhân viên hỏng với lỗi
 * 500 "duplicate key value violates unique constraint".
 */
const MONTH = new Date('2026-09-01T00:00:00Z');
const PROFILE = 'profile-1';
const PAYROLL = 'payroll-9';

const input = {
  employeeProfileId: PROFILE,
  month: MONTH,
  monthlyPayrollId: PAYROLL,
  baseSalary: 7_000_000,
  paymentType: PaymentType.MONTH,
};

const build = (existing: Record<string, unknown> | null) => {
  const repository = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((data: unknown) => ({
      ...(data as object),
      created: true,
    })),
    save: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    restore: jest.fn().mockResolvedValue({}),
  };
  const manager = { getRepository: jest.fn(() => repository) } as any;
  const service = Object.create(StoresService.prototype) as any;
  return { service, manager, repository };
};

describe('phiếu lương tháng khi nhận nhân viên vào cửa hàng', () => {
  it('chưa có phiếu tháng này thì tạo mới', async () => {
    const { service, manager, repository } = build(null);

    await service.upsertInitialEmployeeSalary(manager, input);

    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeProfileId: PROFILE,
        month: MONTH,
        monthlyPayrollId: PAYROLL,
        baseSalary: 7_000_000,
        workingHours: 0,
        earnedBaseSalary: 0,
      }),
    );
    expect(repository.update).not.toHaveBeenCalled();
  });

  // Đây là lỗi gốc: phải nhìn thấy cả phiếu của hồ sơ đã xoá mềm, nếu không
  // sẽ INSERT đè lên ràng buộc duy nhất.
  it('tìm phiếu cũ kể cả khi đã bị xoá mềm', async () => {
    const { service, manager, repository } = build(null);

    await service.upsertInitialEmployeeSalary(manager, input);

    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { employeeProfileId: PROFILE, month: MONTH },
        withDeleted: true,
      }),
    );
  });

  it('đã có phiếu chờ duyệt thì cập nhật, không tạo phiếu thứ hai', async () => {
    const { service, manager, repository } = build({
      id: 'salary-1',
      paymentStatus: PaymentStatus.PENDING,
      monthlyPayrollId: 'payroll-cu',
      deletedAt: null,
    });

    await service.upsertInitialEmployeeSalary(manager, input);

    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith('salary-1', {
      monthlyPayrollId: PAYROLL,
      baseSalary: 7_000_000,
      paymentType: PaymentType.MONTH,
    });
  });

  it('nhận lại người đã xoá: khôi phục phiếu cũ thay vì tạo mới', async () => {
    const { service, manager, repository } = build({
      id: 'salary-1',
      paymentStatus: PaymentStatus.PENDING,
      monthlyPayrollId: PAYROLL,
      deletedAt: new Date('2026-09-18T01:23:00Z'),
    });

    await service.upsertInitialEmployeeSalary(manager, input);

    expect(repository.save).not.toHaveBeenCalled();
    expect(repository.restore).toHaveBeenCalledWith('salary-1');
  });

  it.each([PaymentStatus.APPROVED, PaymentStatus.PAID])(
    'phiếu %s giữ nguyên số tiền chủ đã chốt',
    async (paymentStatus) => {
      const { service, manager, repository } = build({
        id: 'salary-1',
        paymentStatus,
        monthlyPayrollId: PAYROLL,
        deletedAt: null,
      });

      await service.upsertInitialEmployeeSalary(manager, input);

      expect(repository.save).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    },
  );

  it('phiếu đã duyệt chưa thuộc bảng lương nào thì chỉ gắn vào bảng lương tháng', async () => {
    const { service, manager, repository } = build({
      id: 'salary-1',
      paymentStatus: PaymentStatus.APPROVED,
      monthlyPayrollId: null,
      deletedAt: null,
    });

    await service.upsertInitialEmployeeSalary(manager, input);

    expect(repository.update).toHaveBeenCalledWith('salary-1', {
      monthlyPayrollId: PAYROLL,
    });
  });
});
