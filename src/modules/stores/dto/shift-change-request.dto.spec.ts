import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateShiftChangeRequestDto,
  ListShiftChangeRequestsDto,
  ReviewShiftChangeRequestDto,
} from './shift-change-request.dto';

describe('shift change request DTOs', () => {
  it('rejects invalid identifiers, dates, and oversized reasons', async () => {
    const dto = plainToInstance(CreateShiftChangeRequestDto, {
      storeId: 'not-a-uuid',
      employeeProfileId: 'not-a-uuid',
      currentShiftId: 'not-a-uuid',
      requestDate: 'not-a-date',
      reason: 'x'.repeat(501),
    });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('bounds optional pagination without changing unpaged requests', async () => {
    expect(await validate(plainToInstance(ListShiftChangeRequestsDto, {}))).toHaveLength(0);
    expect(
      await validate(plainToInstance(ListShiftChangeRequestsDto, { page: '0', limit: '51' })),
    ).not.toHaveLength(0);
  });

  it('accepts legacy request-date range keys and rejects invalid dates', async () => {
    expect(
      await validate(
        plainToInstance(ListShiftChangeRequestsDto, {
          startDate: '2026-08-01',
          endDate: '2026-08-31',
        }),
      ),
    ).toHaveLength(0);
    expect(
      await validate(plainToInstance(ListShiftChangeRequestsDto, { startDate: 'not-a-date' })),
    ).not.toHaveLength(0);
  });

  it('limits an optional review reason', async () => {
    expect(
      await validate(plainToInstance(ReviewShiftChangeRequestDto, { reason: 'x'.repeat(501) })),
    ).not.toHaveLength(0);
  });
});
