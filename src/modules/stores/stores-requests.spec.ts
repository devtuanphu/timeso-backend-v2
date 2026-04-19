import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StoresService } from './stores.service';
import { ShiftChangeRequest, ShiftChangeRequestStatus } from './entities/shift-change-request.entity';
import { BonusWorkRequest, BonusWorkRequestStatus } from './entities/bonus-work-request.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { Store } from './entities/store.entity';
import { EmployeeContract, PaymentType } from './entities/employee-contract.entity';
import { MonthlyPayroll } from './entities/monthly-payroll.entity';
import { EmployeeSalary } from './entities/employee-salary.entity';
import { StorePayrollSetting } from './entities/store-payroll-setting.entity';
import { StorePayrollRule, PayrollRuleCategory, PayrollCalcType } from './entities/store-payroll-rule.entity';
import { SalaryAdjustment } from './entities/salary-adjustment.entity';
import { ShiftSlot } from './entities/shift-management.entity';
import { ShiftAssignment, ShiftAssignmentStatus } from './entities/shift-management.entity';

function mockRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((d) => ({ id: 'gen-id', ...d })),
    save: jest.fn((e) => Promise.resolve(Array.isArray(e) ? e : { id: 'gen-id', ...e })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {};
      qb.where = jest.fn().mockReturnValue(qb);
      qb.andWhere = jest.fn().mockReturnValue(qb);
      qb.leftJoinAndSelect = jest.fn().mockReturnValue(qb);
      qb.innerJoin = jest.fn().mockReturnValue(qb);
      qb.orderBy = jest.fn().mockReturnValue(qb);
      qb.getMany = jest.fn().mockResolvedValue([]);
      qb.getRawMany = jest.fn().mockResolvedValue([]);
      qb.getRawOne = jest.fn().mockResolvedValue(null);
      qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
      qb.limit = jest.fn().mockReturnValue(qb);
      qb.select = jest.fn().mockReturnValue(qb);
      return qb;
    }),
  };
}

function mockDataSource() {
  return {
    transaction: jest.fn(async (cb) => cb({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((entity, data) => ({ id: 'tx-gen-id', ...data })),
      save: jest.fn((e) => Promise.resolve({ id: 'tx-gen-id', ...(Array.isArray(e) ? e[0] : e) })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      decrement: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: () => ({
        delete: () => ({ execute: jest.fn().mockResolvedValue({ affected: 0 }) }),
        from: () => ({ where: () => ({ execute: jest.fn().mockResolvedValue({ affected: 0 }) }) }),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      }),
    })),
  };
}

describe('StoresService - Shift & Bonus Request Features', () => {
  let shiftChangeRepo: ReturnType<typeof mockRepo>;
  let bonusWorkRepo: ReturnType<typeof mockRepo>;
  let service: StoresService;

  beforeEach(async () => {
    const shiftChangeMock = mockRepo();
    const bonusWorkMock = mockRepo();
    shiftChangeRepo = shiftChangeMock;
    bonusWorkRepo = bonusWorkMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StoresService,
        { provide: getRepositoryToken(ShiftChangeRequest), useValue: shiftChangeMock },
        { provide: getRepositoryToken(BonusWorkRequest), useValue: bonusWorkMock },
        { provide: getRepositoryToken(Store), useValue: mockRepo() },
        { provide: getRepositoryToken(EmployeeProfile), useValue: mockRepo() },
        { provide: getRepositoryToken(EmployeeContract), useValue: mockRepo() },
        { provide: getRepositoryToken(MonthlyPayroll), useValue: mockRepo() },
        { provide: getRepositoryToken(EmployeeSalary), useValue: mockRepo() },
        { provide: getRepositoryToken(StorePayrollSetting), useValue: mockRepo() },
        { provide: getRepositoryToken(StorePayrollRule), useValue: mockRepo() },
        { provide: getRepositoryToken(SalaryAdjustment), useValue: mockRepo() },
        { provide: getRepositoryToken(ShiftSlot), useValue: mockRepo() },
        { provide: getRepositoryToken(ShiftAssignment), useValue: mockRepo() },
        { provide: DataSource, useValue: mockDataSource() },
      ],
    }).compile();

    service = module.get<StoresService>(StoresService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===== Shift Change Request Tests =====

  describe('createShiftChangeRequest', () => {
    it('should create a shift change request with both shift IDs', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        currentShiftId: 'shift-current',
        requestedShiftId: 'shift-requested',
        requestDate: '2026-04-20',
        reason: 'Cần đổi ca',
        attachments: [],
      };

      const result = await service.createShiftChangeRequest(data);

      expect(shiftChangeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        currentShiftId: 'shift-current',
        requestedShiftId: 'shift-requested',
        status: ShiftChangeRequestStatus.PENDING,
      }));
      expect(shiftChangeRepo.save).toHaveBeenCalled();
    });

    it('should create a shift change request with only currentShiftId', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        currentShiftId: 'shift-current',
        requestDate: '2026-04-20',
        reason: 'Cần đổi ca',
      };

      const result = await service.createShiftChangeRequest(data);

      expect(shiftChangeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        currentShiftId: 'shift-current',
        requestedShiftId: undefined,
      }));
    });

    it('should create a shift change request with only requestedShiftId', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        requestedShiftId: 'shift-requested',
        requestDate: '2026-04-20',
      };

      const result = await service.createShiftChangeRequest(data);

      expect(shiftChangeRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        currentShiftId: undefined,
        requestedShiftId: 'shift-requested',
      }));
    });

    it('should throw BadRequestException when neither shift ID is provided', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        requestDate: '2026-04-20',
      };

      await expect(service.createShiftChangeRequest(data)).rejects.toThrow(BadRequestException);
    });
  });

  describe('approveShiftChangeRequest', () => {
    it('should approve a pending shift change request', async () => {
      const mockRequest = {
        id: 'req-1',
        status: ShiftChangeRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      const result = await service.approveShiftChangeRequest('req-1', 'approver-1');

      expect(mockRequest.status).toBe(ShiftChangeRequestStatus.APPROVED);
      expect(mockRequest.approvedById).toBe('approver-1');
      expect(shiftChangeRepo.save).toHaveBeenCalledWith(mockRequest);
    });

    it('should throw NotFoundException when request does not exist', async () => {
      shiftChangeRepo.findOne.mockResolvedValue(null);

      await expect(service.approveShiftChangeRequest('non-existent', 'approver-1'))
        .rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when approver ID is undefined', async () => {
      await expect(service.approveShiftChangeRequest('req-1', undefined))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('rejectShiftChangeRequest', () => {
    it('should reject a pending shift change request with reason', async () => {
      const mockRequest = {
        id: 'req-1',
        status: ShiftChangeRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await service.rejectShiftChangeRequest('req-1', 'approver-1', 'Ca không phù hợp');

      expect(mockRequest.status).toBe(ShiftChangeRequestStatus.REJECTED);
      expect(mockRequest.approvedById).toBe('approver-1');
      expect(mockRequest.rejectionReason).toBe('Ca không phù hợp');
    });
  });

  describe('cancelShiftChangeRequest', () => {
    it('should cancel a pending shift change request by the owner', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeProfileId: 'emp-1',
        status: ShiftChangeRequestStatus.PENDING,
        save: jest.fn(),
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await service.cancelShiftChangeRequest('req-1', 'emp-1');

      expect(mockRequest.status).toBe(ShiftChangeRequestStatus.CANCELLED);
    });

    it('should throw BadRequestException when cancelling from different employee', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeProfileId: 'emp-1',
        status: ShiftChangeRequestStatus.PENDING,
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await expect(service.cancelShiftChangeRequest('req-1', 'emp-2'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when cancelling a non-pending request', async () => {
      const mockRequest = {
        id: 'req-1',
        employeeProfileId: 'emp-1',
        status: ShiftChangeRequestStatus.APPROVED,
      };
      shiftChangeRepo.findOne.mockResolvedValue(mockRequest);

      await expect(service.cancelShiftChangeRequest('req-1', 'emp-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ===== Bonus Work Request Tests =====

  describe('createBonusWorkRequest', () => {
    it('should create a bonus work request with shiftSlotId', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        shiftSlotId: 'slot-1',
        requestDate: '2026-04-20',
        startTime: '08:00',
        endTime: '12:00',
        reason: 'Tăng ca hoàn thành deadline',
      };

      const result = await service.createBonusWorkRequest(data);

      expect(bonusWorkRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        shiftSlotId: 'slot-1',
        status: BonusWorkRequestStatus.PENDING,
      }));
      expect(bonusWorkRepo.save).toHaveBeenCalled();
    });

    it('should create a bonus work request without shiftSlotId (null)', async () => {
      const data = {
        storeId: 'store-1',
        employeeProfileId: 'emp-1',
        shiftSlotId: null,
        requestDate: '2026-04-20',
        startTime: '08:00',
        endTime: '12:00',
        reason: 'Tăng ca ad-hoc',
      };

      const result = await service.createBonusWorkRequest(data);

      expect(bonusWorkRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        shiftSlotId: undefined,
      }));
    });
  });

  describe('approveBonusWorkRequest', () => {
    it('should approve a pending bonus work request', async () => {
      const mockRequest = {
        id: 'bonus-1',
        status: BonusWorkRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await service.approveBonusWorkRequest('bonus-1', 'approver-1');

      expect(mockRequest.status).toBe(BonusWorkRequestStatus.APPROVED);
      expect(mockRequest.approvedById).toBe('approver-1');
    });
  });

  describe('rejectBonusWorkRequest', () => {
    it('should reject a pending bonus work request', async () => {
      const mockRequest = {
        id: 'bonus-1',
        status: BonusWorkRequestStatus.PENDING,
        approvedById: null as string | null,
        rejectionReason: null as string | null,
        save: jest.fn(),
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await service.rejectBonusWorkRequest('bonus-1', 'approver-1', 'Không cần thiết');

      expect(mockRequest.status).toBe(BonusWorkRequestStatus.REJECTED);
      expect(mockRequest.rejectionReason).toBe('Không cần thiết');
    });
  });

  describe('cancelBonusWorkRequest', () => {
    it('should cancel a pending bonus work request by the owner', async () => {
      const mockRequest = {
        id: 'bonus-1',
        employeeProfileId: 'emp-1',
        status: BonusWorkRequestStatus.PENDING,
        save: jest.fn(),
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await service.cancelBonusWorkRequest('bonus-1', 'emp-1');

      expect(mockRequest.status).toBe(BonusWorkRequestStatus.CANCELLED);
    });

    it('should throw BadRequestException when cancelling from different employee', async () => {
      const mockRequest = {
        id: 'bonus-1',
        employeeProfileId: 'emp-1',
        status: BonusWorkRequestStatus.PENDING,
      };
      bonusWorkRepo.findOne.mockResolvedValue(mockRequest);

      await expect(service.cancelBonusWorkRequest('bonus-1', 'emp-2'))
        .rejects.toThrow(BadRequestException);
    });
  });
});
