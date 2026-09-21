import { ForbiddenException, NotFoundException } from '@nestjs/common';

// `uuid` ships ESM only; the repository mocks it in specs that pull in the
// multer config transitively.
jest.mock('uuid', () => ({ v4: () => 'test-upload-id' }));

import { AccountsController } from './accounts.controller';

/**
 * Identity scans used to be written into `./uploads`, which ServeStaticModule
 * publishes at `/uploads` with no authentication. They are now read back
 * through an authenticated route, so these cover the access rules on it.
 */
describe('AccountsController identity image access', () => {
  const OWNER = 'account-1';
  const FILE = 'a9bd5385-b670-47a9-8947-f1940ee06190.jpg';

  let identityRepository: { findOne: jest.Mock; manager: { query: jest.Mock } };
  let controller: AccountsController;
  let res: { setHeader: jest.Mock };

  beforeEach(() => {
    identityRepository = {
      findOne: jest.fn(),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    controller = new AccountsController(
      {} as any,
      identityRepository as any,
      {} as any,
    );
    res = { setHeader: jest.fn() };
  });

  const call = (filename: string, accountId = OWNER) =>
    controller.getIdentityImage(filename, { userId: accountId }, res as any);

  it('rejects a path-traversal filename before touching the filesystem', async () => {
    await expect(call('../../.env')).rejects.toThrow(NotFoundException);
    expect(identityRepository.findOne).not.toHaveBeenCalled();
  });

  it('rejects a filename containing a path separator', async () => {
    await expect(call('nested/file.jpg')).rejects.toThrow(NotFoundException);
    expect(identityRepository.findOne).not.toHaveBeenCalled();
  });

  it('404s when the caller has no identity document', async () => {
    identityRepository.findOne.mockResolvedValue(null);
    await expect(call(FILE)).rejects.toThrow(NotFoundException);
  });

  // The core rule: knowing another account's filename must not be enough.
  it('forbids reading a file that belongs to another account', async () => {
    identityRepository.findOne.mockResolvedValue({
      accountId: 'someone-else',
      frontImageUrl: `/api/accounts/identity/image/${FILE}`,
      backImageUrl: null,
    });
    await expect(call(FILE)).rejects.toThrow(ForbiddenException);
    expect(identityRepository.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('owner_account_id'),
      ['someone-else', OWNER],
    );
  });

  it('looks the document up by the exact private URL of the file', async () => {
    identityRepository.findOne.mockResolvedValue(null);
    await expect(call(FILE, 'account-2')).rejects.toThrow(NotFoundException);
    expect(identityRepository.findOne).toHaveBeenCalledWith({
      where: [
        { frontImageUrl: `/api/accounts/identity/image/${FILE}` },
        { backImageUrl: `/api/accounts/identity/image/${FILE}` },
      ],
    });
  });

  it("lets the owner of the employee's store past the ownership check", async () => {
    identityRepository.findOne.mockResolvedValue({
      accountId: 'employee-account',
      frontImageUrl: `/api/accounts/identity/image/${FILE}`,
      backImageUrl: null,
    });
    identityRepository.manager.query.mockResolvedValue([{ '?column?': 1 }]);
    // Access is granted; the file itself does not exist in this test run.
    await expect(call(FILE)).rejects.toThrow(NotFoundException);
  });

  it('404s for an owned record whose file is missing on disk', async () => {
    identityRepository.findOne.mockResolvedValue({
      accountId: OWNER,
      frontImageUrl: `/api/accounts/identity/image/${FILE}`,
      backImageUrl: null,
    });
    // Ownership passes, but nothing was ever written for this test run.
    await expect(call(FILE)).rejects.toThrow(NotFoundException);
  });
});
