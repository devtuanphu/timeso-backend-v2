import { ZaloService } from './zalo.service';
import * as runtime from '../../app-runtime.config';
import { of } from 'rxjs';

describe('ZaloService read-only lifecycle guards', () => {
  afterEach(() => jest.restoreAllMocks());

  it('skips local startup refresh but still delivers requested OTP via the provider', async () => {
    jest.spyOn(runtime, 'isLocalApiOnly').mockReturnValue(true);
    const repository = { createQueryBuilder: jest.fn(), findOne: jest.fn(), save: jest.fn() };
    const httpService = { post: jest.fn().mockReturnValue(of({ data: { error: 0, message: 'ok' } })) };
    const service = new ZaloService(
      { get: jest.fn() } as never,
      httpService as never,
      repository as never,
    );
    jest.spyOn(service['logger'], 'log').mockImplementation(() => undefined);
    await service.onModuleInit();
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
    expect(httpService.post).not.toHaveBeenCalled();

    const getToken = jest.spyOn(service, 'getValidAccessToken').mockResolvedValue('synthetic-token');
    await service.sendOtp('0900000000', '000000');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(httpService.post).toHaveBeenCalledTimes(1);
  });
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
