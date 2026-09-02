import {
  BadRequestException,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShiftAggregationController } from './shift-aggregation.controller';
import { ShiftAggregationService, StaffingStatus } from './shift-aggregation.service';

describe('ShiftAggregationController HTTP contract', () => {
  let app: INestApplication;
  const aggregationService = {
    getShiftSlots: jest.fn(),
    getShiftSummary: jest.fn(),
    getMonthSummary: jest.fn(),
    getShiftSuggestions: jest.fn(),
    getShiftDetail: jest.fn(),
    getEmployeeScheduleGrid: jest.fn(),
    getEmployeeActivities: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ShiftAggregationController],
      providers: [{ provide: ShiftAggregationService, useValue: aggregationService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          if (req.headers.authorization !== 'Bearer test-token') {
            throw new UnauthorizedException();
          }
          req.user = { userId: 'owner-1' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    aggregationService.getShiftSlots.mockResolvedValue({ data: [], meta: { total: 0 } });
  });

  it('requires authentication and forwards the authenticated owner account', async () => {
    await request(app.getHttpServer())
      .get('/stores/store-1/shifts/slots')
      .expect(401);

    await request(app.getHttpServer())
      .get('/stores/store-1/shifts/slots?from=2026-08-01&to=2026-08-31')
      .set('Authorization', 'Bearer test-token')
      .expect(200);

    expect(aggregationService.getShiftSlots).toHaveBeenCalledWith({
      storeId: 'store-1',
      from: '2026-08-01',
      to: '2026-08-31',
      type: undefined,
      staffingStatus: undefined,
      page: 1,
      limit: 50,
      ownerAccountId: 'owner-1',
    });
  });

  it('maps a foreign-store authorization failure to HTTP 403', async () => {
    aggregationService.getShiftSlots.mockRejectedValueOnce(
      new ForbiddenException('Bạn không có quyền truy cập cửa hàng này'),
    );

    await request(app.getHttpServer())
      .get('/stores/foreign-store/shifts/slots')
      .set('Authorization', 'Bearer test-token')
      .expect(403);
  });

  it('maps malformed aggregation filters to HTTP 400', async () => {
    aggregationService.getShiftSlots.mockImplementationOnce(async (params: any) => {
      if (params.type && !['morning', 'noon', 'evening'].includes(params.type)) {
        throw new BadRequestException('Loại ca không hợp lệ');
      }
      if (params.staffingStatus && !Object.values(StaffingStatus).includes(params.staffingStatus)) {
        throw new BadRequestException('Trạng thái nhân sự không hợp lệ');
      }
      throw new BadRequestException('Ngày bắt đầu không hợp lệ');
    });

    await request(app.getHttpServer())
      .get('/stores/store-1/shifts/slots?type=night')
      .set('Authorization', 'Bearer test-token')
      .expect(400);
  });
});
