import { ZaloService } from './zalo.service';

describe('ZaloService read-only lifecycle guards', () => {
  it('skips startup and keep-alive token reads or refreshes', async () => {
    const repository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
    };
    const httpService = { post: jest.fn() };
    const service = new ZaloService(
      { get: jest.fn().mockReturnValue('true') } as any,
      httpService as any,
      repository as any,
    );

    await service.onModuleInit();
    await service.keepAliveToken();

    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(httpService.post).not.toHaveBeenCalled();
  });
});
