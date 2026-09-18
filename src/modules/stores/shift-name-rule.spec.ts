// stores.service kéo theo cấu hình upload dùng uuid bản ESM mà Jest không parse.
jest.mock('../../common/utils/multer-config', () => ({
  attendanceMulterConfig: {},
  multerConfig: {},
}));

import {
  findSameNameShiftOnDates,
  sameNameShiftMessage,
} from './stores.service';

/**
 * Chủ cửa hàng muốn dùng lại tên ca (vd. "Ca tối") cho ngày khác. Chỉ chặn
 * khi một ca cùng tên đã làm vào đúng ngày đó.
 */
describe('tên ca chỉ được trùng khi khác ngày', () => {
  const manager = (rows: Array<{ shift_name: string; work_date: string }>) => ({
    query: jest.fn().mockResolvedValue(rows),
  });

  it('ca cùng tên vào ngày khác thì cho tạo', async () => {
    const m = manager([]);
    await expect(
      findSameNameShiftOnDates(m as any, 'store-1', ['Ca tối'], ['2026-09-20']),
    ).resolves.toBeNull();
    // Chỉ hỏi DB đúng những ngày của lịch mới, trong cửa hàng này.
    expect(m.query.mock.calls[0][1]).toEqual(['store-1', ['2026-09-20'], []]);
  });

  it('ca cùng tên (khác hoa thường, khoảng trắng) vào cùng ngày thì chặn', async () => {
    const m = manager([
      { shift_name: 'Ca sáng', work_date: '2026-09-20' },
      { shift_name: '  ca   TỐI ', work_date: '2026-09-20' },
    ]);
    const hit = await findSameNameShiftOnDates(
      m as any,
      'store-1',
      ['Ca tối'],
      ['2026-09-20'],
    );
    expect(hit).toEqual({ shiftName: '  ca   TỐI ', workDate: '2026-09-20' });
    expect(sameNameShiftMessage(hit!)).toContain('20/09/2026');
  });

  it('ca khác tên cùng ngày không bị chặn', async () => {
    const m = manager([{ shift_name: 'Ca sáng', work_date: '2026-09-20' }]);
    await expect(
      findSameNameShiftOnDates(m as any, 'store-1', ['Ca tối'], ['2026-09-20']),
    ).resolves.toBeNull();
  });

  it('không có ngày nào thì không cần hỏi DB', async () => {
    const m = manager([]);
    await expect(
      findSameNameShiftOnDates(m as any, 'store-1', ['Ca tối'], []),
    ).resolves.toBeNull();
    expect(m.query).not.toHaveBeenCalled();
  });

  it('khi đổi tên thì loại chính ca đang sửa khỏi phép so', async () => {
    const m = manager([]);
    await findSameNameShiftOnDates(
      m as any,
      'store-1',
      ['Ca tối'],
      ['2026-09-20'],
      ['shift-self'],
    );
    expect(m.query.mock.calls[0][1][2]).toEqual(['shift-self']);
  });
});
