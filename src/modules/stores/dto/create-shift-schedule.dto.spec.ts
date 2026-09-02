import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateShiftScheduleDto } from './create-shift-schedule.dto';

describe('CreateShiftScheduleDto', () => {
  const recurrence = {
    enabled: false,
    frequency: 'DAILY',
    interval: 1,
    endType: 'COUNT',
    occurrenceCount: 1,
  };

  it('accepts the additive multi-shift contract', async () => {
    const value = plainToInstance(CreateShiftScheduleDto, {
      startDate: '2026-09-01',
      recurrence,
      shifts: [
        {
          shiftName: 'Ca sáng',
          startTime: '07:00',
          endTime: '11:00',
          maxStaff: 2,
          note: 'Quầy trước',
          employeeIds: ['employee-1'],
        },
        {
          shiftName: 'Ca chiều',
          startTime: '12:00',
          endTime: '16:00',
          maxStaff: 1,
          employeeIds: [],
        },
      ],
    });

    expect(await validate(value)).toEqual([]);
  });

  it('keeps the legacy flat request valid', async () => {
    const value = plainToInstance(CreateShiftScheduleDto, {
      shiftName: 'Ca cũ',
      startDate: '2026-09-01',
      startTime: '07:00',
      endTime: '11:00',
      maxStaff: 2,
      recurrence,
    });

    expect(await validate(value)).toEqual([]);
  });

  it('rejects an empty batch and invalid per-shift fields', async () => {
    const empty = plainToInstance(CreateShiftScheduleDto, {
      startDate: '2026-09-01',
      recurrence,
      shifts: [],
    });
    const invalidDraft = plainToInstance(CreateShiftScheduleDto, {
      startDate: '2026-09-01',
      recurrence,
      shifts: [
        {
          shiftName: '',
          startTime: '7:00',
          endTime: '11:00',
          maxStaff: 0,
        },
      ],
    });

    expect(await validate(empty)).not.toEqual([]);
    expect(await validate(invalidDraft)).not.toEqual([]);
  });
});
