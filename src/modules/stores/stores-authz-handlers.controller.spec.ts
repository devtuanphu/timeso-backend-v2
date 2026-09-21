jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
  mixedIdentityMulterConfig: () => ({}),
  identityImageUrl: (filename: string) => filename,
}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { StoresController } from './stores.controller';

const OWNER = { userId: 'owner-1' };
const STAFF = { userId: 'staff-1' };

describe('StoresController authorization hand-off', () => {
  const storesService = {
    approveBonusWorkRequest: jest.fn(),
    rejectBonusWorkRequest: jest.fn(),
    cancelBonusWorkRequest: jest.fn(),
    getEmployeeByAccountId: jest.fn(),
    getEmployeeById: jest.fn(),
    cancelSalaryAdvanceRequest: jest.fn(),
    resolveStoreViewer: jest.fn(),
    getBonusHistory: jest.fn(),
    getPenaltyHistory: jest.fn(),
    getFeedbacksForViewer: jest.fn(),
    getFeedbacks: jest.fn(),
    permanentDeleteEmployee: jest.fn(),
    assertOwnsAnyStore: jest.fn(),
    extractPlaceholdersFromDocx: jest.fn(),
    getInventoryReports: jest.fn(),
  };
  const accountsService = { verifyPassword: jest.fn() };
  const shiftEndWorkflowService = {
    approveOvertime: jest.fn(),
    resumeAfterOvertime: jest.fn(),
  };
  const controller = new StoresController(
    storesService as any,
    accountsService as any,
    {} as any,
    {} as any,
    shiftEndWorkflowService as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(storesService).forEach((mock) => mock.mockResolvedValue(undefined));
  });

  describe('bonus-work requests (was user.id, always undefined)', () => {
    it('passes the owner account to approve and reject', async () => {
      storesService.approveBonusWorkRequest.mockResolvedValue({ id: 'b-1' });
      storesService.rejectBonusWorkRequest.mockResolvedValue({ id: 'b-1' });

      await controller.approveBonusWorkRequest('b-1', OWNER);
      await controller.rejectBonusWorkRequest('b-1', OWNER, { reason: 'no' });

      expect(storesService.approveBonusWorkRequest).toHaveBeenCalledWith('b-1', 'owner-1');
      expect(storesService.rejectBonusWorkRequest).toHaveBeenCalledWith(
        'b-1',
        'owner-1',
        'no',
      );
      // No longer looks up "any profile" by an undefined account id.
      expect(storesService.getEmployeeByAccountId).not.toHaveBeenCalled();
    });

    it('passes the caller account to cancel', async () => {
      storesService.cancelBonusWorkRequest.mockResolvedValue({ id: 'b-1' });
      await controller.cancelBonusWorkRequest('b-1', STAFF);
      expect(storesService.cancelBonusWorkRequest).toHaveBeenCalledWith('b-1', 'staff-1');
    });
  });

  it('cancels a salary advance by account id, not as a profile id', async () => {
    await controller.cancelSalaryAdvanceRequest('req-1', STAFF);
    expect(storesService.getEmployeeById).not.toHaveBeenCalled();
    expect(storesService.cancelSalaryAdvanceRequest).toHaveBeenCalledWith(
      'req-1',
      'staff-1',
    );
  });

  describe('bonus and penalty history', () => {
    it('gives the owner every employee', async () => {
      storesService.resolveStoreViewer.mockResolvedValue({
        isOwner: true,
        profileId: null,
      });
      await controller.getBonusHistory('store-1', '09/2026', OWNER);
      await controller.getPenaltyHistory('store-1', '09/2026', OWNER);
      expect(storesService.resolveStoreViewer).toHaveBeenCalledWith('store-1', 'owner-1');
      expect(storesService.getBonusHistory).toHaveBeenCalledWith(
        'store-1',
        '09/2026',
        undefined,
      );
      expect(storesService.getPenaltyHistory).toHaveBeenCalledWith(
        'store-1',
        '09/2026',
        undefined,
      );
    });

    it('limits an employee to their own rows', async () => {
      storesService.resolveStoreViewer.mockResolvedValue({
        isOwner: false,
        profileId: 'profile-staff',
      });
      await controller.getBonusHistory('store-1', undefined, STAFF);
      await controller.getPenaltyHistory('store-1', undefined, STAFF);
      expect(storesService.getBonusHistory).toHaveBeenCalledWith(
        'store-1',
        undefined,
        'profile-staff',
      );
      expect(storesService.getPenaltyHistory).toHaveBeenCalledWith(
        'store-1',
        undefined,
        'profile-staff',
      );
    });

    it('refuses an outsider before reading anything', async () => {
      storesService.resolveStoreViewer.mockRejectedValue(new ForbiddenException());
      await expect(
        controller.getBonusHistory('store-1', undefined, { userId: 'outsider' }),
      ).rejects.toThrow(ForbiddenException);
      expect(storesService.getBonusHistory).not.toHaveBeenCalled();
    });
  });

  it('scopes feedback reads to the caller', async () => {
    await controller.getFeedbacksEarly('store-1', undefined, 'NEW', STAFF);
    await controller.getFeedbacks('store-1', undefined, 'NEW', STAFF);
    expect(storesService.getFeedbacks).not.toHaveBeenCalled();
    expect(storesService.getFeedbacksForViewer).toHaveBeenCalledTimes(2);
    expect(storesService.getFeedbacksForViewer).toHaveBeenCalledWith('staff-1', {
      storeId: 'store-1',
      employeeProfileId: undefined,
      status: 'NEW',
    });
  });

  it('never runs the unfiltered inventory-report query', async () => {
    await expect(controller.getInventoryReports(undefined)).rejects.toThrow(
      BadRequestException,
    );
    expect(storesService.getInventoryReports).not.toHaveBeenCalled();
  });

  it('passes the owner account to permanent delete', async () => {
    accountsService.verifyPassword.mockResolvedValue(true);
    await controller.permanentDeleteEmployee(OWNER, 'profile-1', {
      password: 'x',
    } as any);
    expect(storesService.permanentDeleteEmployee).toHaveBeenCalledWith(
      'profile-1',
      'owner-1',
    );
  });

  describe('contract-template files', () => {
    it('refuses extraction for a caller who owns no store', async () => {
      storesService.assertOwnsAnyStore.mockRejectedValue(new ForbiddenException());
      await expect(
        controller.extractPlaceholdersFromFile({ fileUrl: '/uploads/a.docx' }, STAFF),
      ).rejects.toThrow(ForbiddenException);
      expect(storesService.extractPlaceholdersFromDocx).not.toHaveBeenCalled();
    });

    it('refuses a path that escapes the uploads directory', async () => {
      await expect(
        controller.extractPlaceholdersFromFile(
          { fileUrl: '/uploads/../package.docx' },
          OWNER,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(storesService.extractPlaceholdersFromDocx).not.toHaveBeenCalled();
    });

    it('rejects a missing fileUrl', async () => {
      await expect(
        controller.extractPlaceholdersFromFile({} as any, OWNER),
      ).rejects.toThrow(BadRequestException);
    });

    it('discards an upload from a caller who owns no store', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeso-upload-'));
      const filePath = path.join(dir, 'template.docx');
      fs.writeFileSync(filePath, 'x');
      storesService.assertOwnsAnyStore.mockRejectedValue(new ForbiddenException());
      try {
        await expect(
          controller.uploadContractTemplateFile(
            { path: filePath, filename: 'template.docx' } as any,
            STAFF,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(fs.existsSync(filePath)).toBe(false);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
