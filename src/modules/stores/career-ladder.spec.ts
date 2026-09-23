import { BadRequestException } from '@nestjs/common';

import { CareerLadderService } from './career-ladder.service';
import { LadderDimension } from './entities/store-ladder.entity';
import {
  CriteriaKind,
  CriteriaCode,
  CriteriaOperator,
} from './entities/store-rung-criteria.entity';
import { EmploymentStatus } from './entities/employee-profile.entity';

/**
 * Thăng vị trí và qua thử việc từng là hai cơ chế rời nhau: một bên đọc bốn
 * cột `req_*` trên danh mục loại nhân viên, bên kia chỉ có một con số ngày và
 * không có máy đánh giá nào. Ở đây chúng là cùng một thứ, nên các test dưới
 * đây chạy cùng một phép đo cho cả hai tác nhân.
 */
const STORE = 'store-1';
const PROFILE = 'profile-1';

const ladder = (over: Record<string, unknown> = {}) => ({
  id: 'ladder-1',
  storeId: STORE,
  dimension: LadderDimension.POSITION,
  name: 'Lộ trình vị trí',
  isActive: true,
  ...over,
});

const rung = (over: Record<string, unknown> = {}) => ({
  id: 'rung-2',
  ladderId: 'ladder-1',
  level: 2,
  targetId: 'role-2',
  approval: 'owner',
  suggestedSalary: null,
  resetsLadderId: null,
  ...over,
});

const profile = (over: Record<string, unknown> = {}) => ({
  id: PROFILE,
  storeId: STORE,
  accountId: 'account-1',
  employmentStatus: EmploymentStatus.ACTIVE,
  employeeTypeId: null,
  storeRoleId: 'role-1',
  skillId: null,
  capabilityPoints: 0,
  probationEndsAt: null,
  ...over,
});

const criteria = (over: Record<string, unknown> = {}) => ({
  id: 'crit-1',
  rungId: 'rung-2',
  kind: CriteriaKind.METRIC,
  code: CriteriaCode.ON_TIME_PERCENT,
  operator: CriteriaOperator.GTE,
  value: 90,
  label: '90% ca đúng giờ',
  unit: '%',
  isRequired: true,
  sortOrder: 0,
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  employeeProfileId: PROFILE,
  totalShifts: 10,
  completedShifts: 10,
  onTimeArrivalsCount: 9,
  unauthorizedLeavesCount: 0,
  totalWorkHours: 80,
  performanceScore: 75,
  kpiTotalCount: 4,
  kpiCompletedCount: 3,
  ...over,
});

/**
 * Service được dựng qua prototype thay vì qua Nest: nó có mười một phụ thuộc
 * và các test dưới đây chỉ quan tâm tới phép đo, nên một module thật chỉ thêm
 * nhiễu mà không bắt thêm lỗi nào.
 */
function build(
  opts: {
    criteria?: any[];
    summaries?: any[];
    latestEvent?: any;
    currentRung?: any;
    otherLadder?: any;
  } = {},
) {
  const service = Object.create(CareerLadderService.prototype) as any;

  service.criteriaRepository = {
    find: jest.fn().mockResolvedValue(opts.criteria ?? []),
    findOne: jest.fn().mockResolvedValue(null),
  };
  service.summaryRepository = {
    findOne: jest.fn().mockResolvedValue(opts.summaries?.[0] ?? null),
    createQueryBuilder: jest.fn(() => {
      const qb: any = {
        where: jest.fn(() => qb),
        andWhere: jest.fn(() => qb),
        orderBy: jest.fn(() => qb),
        getMany: jest.fn().mockResolvedValue(opts.summaries ?? []),
      };
      return qb;
    }),
  };
  service.eventRepository = {
    findOne: jest.fn().mockResolvedValue(opts.latestEvent ?? null),
    find: jest.fn().mockResolvedValue([]),
  };
  service.rungRepository = {
    findOne: jest.fn().mockResolvedValue(opts.currentRung ?? null),
    find: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  service.ladderRepository = {
    findOne: jest.fn().mockResolvedValue(opts.otherLadder ?? null),
    find: jest.fn().mockResolvedValue([]),
  };
  service.edgeRepository = { find: jest.fn().mockResolvedValue([]) };
  service.profileRepository = { findOne: jest.fn().mockResolvedValue(null) };
  service.capabilityRepository = { find: jest.fn().mockResolvedValue([]) };
  service.probationSettingRepository = {
    findOne: jest.fn().mockResolvedValue(null),
  };
  service.dataSource = { getRepository: jest.fn() };
  service.notificationsService = { create: jest.fn() };

  return service;
}

describe('evaluateRung — chỉ số đo tự động', () => {
  it('đạt khi tỉ lệ đúng giờ vượt ngưỡng', async () => {
    const service = build({
      criteria: [criteria()],
      summaries: [summary({ totalShifts: 10, onTimeArrivalsCount: 9 })],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.passed).toBe(true);
    expect(result.progress).toBe(100);
    expect(result.items[0]).toMatchObject({
      current: 90,
      target: 90,
      met: true,
    });
  });

  it('không đạt khi dưới ngưỡng', async () => {
    const service = build({
      criteria: [criteria()],
      summaries: [summary({ totalShifts: 10, onTimeArrivalsCount: 5 })],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.passed).toBe(false);
    expect(result.items[0]).toMatchObject({ current: 50, met: false });
  });

  // `lte` tồn tại riêng vì "nghỉ không phép" đạt khi nhỏ hơn ngưỡng, ngược
  // hẳn với mọi chỉ số còn lại.
  it('đảo chiều so sánh với toán tử lte', async () => {
    const service = build({
      criteria: [
        criteria({
          code: CriteriaCode.UNAUTHORIZED_LEAVES,
          operator: CriteriaOperator.LTE,
          value: 2,
          label: 'Nghỉ không phép tối đa 2',
        }),
      ],
      summaries: [summary({ unauthorizedLeavesCount: 1 })],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0]).toMatchObject({ current: 1, met: true });
  });

  it('không chia cho 0 khi chưa có ca nào', async () => {
    const service = build({
      criteria: [criteria()],
      summaries: [summary({ totalShifts: 0, onTimeArrivalsCount: 0 })],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0].current).toBe(0);
    expect(result.items[0].met).toBe(false);
  });

  it('đọc điểm năng lực từ hồ sơ chứ không từ bảng thống kê', async () => {
    const service = build({
      criteria: [
        criteria({
          code: CriteriaCode.CAPABILITY_POINTS,
          value: 80,
          label: 'Điểm năng lực tối thiểu 80',
        }),
      ],
      summaries: [summary()],
    });

    const result = await service.evaluateRung(
      profile({ capabilityPoints: 85 }),
      rung(),
      ladder(),
    );

    expect(result.items[0]).toMatchObject({ current: 85, met: true });
  });

  // Mã lạ trong cấu hình không được lặng lẽ tính là đã đạt — chủ phải nhìn
  // thấy nó chưa đạt để biết cấu hình sai.
  it('coi mã điều kiện không nhận ra là chưa đạt', async () => {
    const service = build({
      criteria: [criteria({ code: 'khong_ton_tai' })],
      summaries: [summary()],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0]).toMatchObject({ current: null, met: false });
  });
});

describe('evaluateRung — thâm niên và checklist', () => {
  it('đếm số ngày ở bậc từ mốc lịch sử gần nhất', async () => {
    const service = build({
      criteria: [
        criteria({
          kind: CriteriaKind.TENURE,
          code: CriteriaCode.DAYS_IN_RUNG,
          value: 30,
          label: 'Đủ 30 ngày thử việc',
        }),
      ],
      latestEvent: {
        effectiveAt: new Date(Date.now() - 45 * 86_400_000),
      },
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0].current).toBe(45);
    expect(result.items[0].met).toBe(true);
  });

  // Không có lịch sử thì không suy ra được mốc nào, và đoán ngày vào bậc là
  // cho không một điều kiện mà người đó chưa đạt.
  it('coi là 0 ngày khi chưa có lịch sử', async () => {
    const service = build({
      criteria: [
        criteria({
          kind: CriteriaKind.TENURE,
          code: CriteriaCode.DAYS_IN_RUNG,
          value: 30,
          label: 'Đủ 30 ngày',
        }),
      ],
      latestEvent: null,
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0]).toMatchObject({ current: 0, met: false });
  });

  it('mục checklist chưa chấm thì chưa đạt', async () => {
    const service = build({
      criteria: [
        criteria({ kind: CriteriaKind.CHECKLIST, code: null, value: null }),
      ],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0].met).toBe(false);
  });

  it('mục checklist được chủ tick thì đạt', async () => {
    const service = build({
      criteria: [
        criteria({ kind: CriteriaKind.CHECKLIST, code: null, value: null }),
      ],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder(), {
      'crit-1': true,
    });

    expect(result.items[0].met).toBe(true);
  });
});

describe('evaluateRung — điều kiện bắt buộc và tiến độ', () => {
  // Điều kiện không bắt buộc vẫn hiện tiến độ nhưng không được chặn việc lên
  // bậc; trước đây "[Bắt buộc]" chỉ là chữ trong nhãn nên không ai phân biệt.
  it('điều kiện không bắt buộc không chặn việc lên bậc', async () => {
    const service = build({
      criteria: [
        criteria({ id: 'a', value: 50 }),
        criteria({ id: 'b', value: 200, isRequired: false, label: 'Thêm' }),
      ],
      summaries: [summary({ totalShifts: 10, onTimeArrivalsCount: 9 })],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.passed).toBe(true);
    expect(result.items.find((i: any) => i.id === 'b').met).toBe(false);
  });

  it('tiến độ tính trên số điều kiện bắt buộc đã đạt', async () => {
    const service = build({
      criteria: [
        criteria({ id: 'a', value: 50 }),
        criteria({ id: 'b', value: 200, label: 'Khó' }),
      ],
      summaries: [summary({ totalShifts: 10, onTimeArrivalsCount: 9 })],
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.progress).toBe(50);
    expect(result.passed).toBe(false);
  });

  it('bậc không có điều kiện nào thì đi qua được', async () => {
    const service = build({ criteria: [] });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.passed).toBe(true);
    expect(result.progress).toBe(100);
  });
});

describe('evaluateRung — điều kiện chéo giữa hai lộ trình', () => {
  // Đây là thứ cho phép "lên Bánh tráng phải đã Chính thức": một lộ trình đặt
  // điều kiện lên lộ trình kia mà không cần cơ chế riêng.
  it('đạt khi đã ở bậc đủ cao trên lộ trình được tham chiếu', async () => {
    const service = build({
      criteria: [
        criteria({
          kind: CriteriaKind.LADDER,
          code: 'ladder-2',
          value: 2,
          label: 'Đã là Chính thức',
        }),
      ],
      otherLadder: ladder({
        id: 'ladder-2',
        dimension: LadderDimension.EMPLOYMENT_TYPE,
      }),
      currentRung: rung({ id: 'rung-official', level: 2 }),
    });

    // Hồ sơ phải đang giữ một loại nhân viên, nếu không thì tra bậc trên lộ
    // trình kia trả về rỗng và điều kiện chéo không có gì để so.
    const result = await service.evaluateRung(
      profile({ employeeTypeId: 'type-official' }),
      rung(),
      ladder(),
    );

    expect(result.items[0].met).toBe(true);
  });

  it('không đạt khi bậc trên lộ trình kia còn thấp hơn', async () => {
    const service = build({
      criteria: [
        criteria({
          kind: CriteriaKind.LADDER,
          code: 'ladder-2',
          value: 2,
          label: 'Đã là Chính thức',
        }),
      ],
      otherLadder: ladder({ id: 'ladder-2' }),
      currentRung: rung({ id: 'rung-probation', level: 1 }),
    });

    const result = await service.evaluateRung(
      profile({ employeeTypeId: 'type-probation' }),
      rung(),
      ladder(),
    );

    expect(result.items[0].met).toBe(false);
  });

  it('không đạt khi lộ trình được tham chiếu không còn tồn tại', async () => {
    const service = build({
      criteria: [
        criteria({
          kind: CriteriaKind.LADDER,
          code: 'ladder-mat-roi',
          value: 1,
        }),
      ],
      otherLadder: null,
    });

    const result = await service.evaluateRung(profile(), rung(), ladder());

    expect(result.items[0].met).toBe(false);
  });
});

describe('phép map giữa tác nhân và trường trên hồ sơ', () => {
  // Ba dòng này là toàn bộ phép map. Sai một dòng là thăng bậc ghi vào nhầm
  // trường và lộ trình lệch khỏi hồ sơ mà không có gì báo.
  it.each([
    [LadderDimension.EMPLOYMENT_TYPE, 'employeeTypeId'],
    [LadderDimension.POSITION, 'storeRoleId'],
    [LadderDimension.SKILL, 'skillId'],
  ])('%s ghi vào %s', (dimension, column) => {
    const service = build();
    expect(service.profileColumn(dimension)).toBe(column);
  });

  it('từ chối tác nhân không hợp lệ', () => {
    const service = build();
    expect(() => service.profileColumn('khong_ton_tai')).toThrow(
      BadRequestException,
    );
  });
});

describe('awardCapabilityPoints', () => {
  it('từ chối điểm bằng 0', async () => {
    const service = build();
    await expect(
      service.awardCapabilityPoints(PROFILE, 0, 'không có lý do', 'owner-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('từ chối điểm không phải số nguyên', async () => {
    const service = build();
    await expect(
      service.awardCapabilityPoints(PROFILE, 1.5, 'lẻ', 'owner-1'),
    ).rejects.toThrow(BadRequestException);
  });

  // Chủ trừ điểm cũng là một lần chấm hợp lệ.
  it('cho phép điểm âm', async () => {
    const service = build();
    const saved: any[] = [];
    const manager = {
      findOne: jest.fn().mockResolvedValue(profile({ capabilityPoints: 10 })),
      create: jest.fn((_e: unknown, data: any) => data),
      save: jest.fn(async (_e: unknown, data: any) => {
        saved.push(data);
        return data;
      }),
    };
    service.dataSource.transaction = jest.fn((fn: any) => fn(manager));

    const result = await service.awardCapabilityPoints(
      PROFILE,
      -3,
      'đi trễ nhiều',
      'owner-1',
    );

    expect(result.capabilityPoints).toBe(7);
    expect(saved[0]).toMatchObject({ points: -3, reason: 'đi trễ nhiều' });
  });
});

describe('hasCycle — lộ trình phân nhánh phải không có vòng lặp', () => {
  const service = () => build();

  it('chấp nhận một dãy thẳng', () => {
    expect(
      service().hasCycle([
        { from: null, to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ]),
    ).toBe(false);
  });

  // Đây chính là ca mà phân nhánh sinh ra: hai đường rời nhau rồi gặp lại.
  it('chấp nhận nhánh tách ra rồi nhập lại', () => {
    expect(
      service().hasCycle([
        { from: null, to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'd' },
        { from: 'c', to: 'd' },
      ]),
    ).toBe(false);
  });

  it('bắt được vòng lặp trực tiếp', () => {
    expect(
      service().hasCycle([
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ]),
    ).toBe(true);
  });

  it('bắt được vòng lặp gián tiếp qua nhiều bậc', () => {
    expect(
      service().hasCycle([
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ]),
    ).toBe(true);
  });

  it('bắt được bậc tự trỏ vào chính nó', () => {
    expect(service().hasCycle([{ from: 'a', to: 'a' }])).toBe(true);
  });

  it('lộ trình rỗng không có vòng lặp', () => {
    expect(service().hasCycle([])).toBe(false);
  });
});

describe('planRungRemoval — gỡ bậc không được làm đứt lộ trình', () => {
  // Import muộn để không đụng các describe phía trên.
  const { planRungRemoval } = jest.requireActual('./career-ladder.service');
  const edge = (id: string, from: string | null, to: string) => ({
    id,
    fromRungId: from,
    toRungId: to,
  });

  // Trước khi sửa, bậc chỉ bị xoá mềm và cạnh ở lại: bậc trước vẫn "lên tiếp"
  // tới bậc đã gỡ và mọi lần sửa đều báo "Có bậc không tồn tại".
  it('gỡ bậc giữa thì nối thẳng bậc trước sang bậc sau', () => {
    const plan = planRungRemoval(
      [edge('e0', null, 'A'), edge('e1', 'A', 'B'), edge('e2', 'B', 'C')],
      'B',
    );
    expect(plan.detachEdgeIds.sort()).toEqual(['e1', 'e2']);
    expect(plan.bridges).toEqual([{ fromRungId: 'A', toRungId: 'C' }]);
  });

  it('gỡ điểm vào thì bậc sau thành điểm vào', () => {
    const plan = planRungRemoval(
      [edge('e0', null, 'A'), edge('e1', 'A', 'B')],
      'A',
    );
    expect(plan.bridges).toEqual([{ fromRungId: null, toRungId: 'B' }]);
  });

  it('nối mọi bậc trước sang mọi bậc sau khi có phân nhánh', () => {
    const plan = planRungRemoval(
      [
        edge('e1', 'A', 'M'),
        edge('e2', 'B', 'M'),
        edge('e3', 'M', 'X'),
        edge('e4', 'M', 'Y'),
      ],
      'M',
    );
    expect(plan.bridges).toHaveLength(4);
  });

  it('không nối trùng cạnh đã có sẵn', () => {
    const plan = planRungRemoval(
      [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'A', 'C')],
      'B',
    );
    expect(plan.bridges).toEqual([]);
    expect(plan.detachEdgeIds.sort()).toEqual(['e1', 'e2']);
  });

  it('bậc cuối bị gỡ thì chỉ dọn cạnh, không nối gì', () => {
    const plan = planRungRemoval([edge('e1', 'A', 'B')], 'B');
    expect(plan).toEqual({ detachEdgeIds: ['e1'], bridges: [] });
  });
});

describe('assertCanViewOwnCareer — chỉ chủ hoặc chính nhân viên', () => {
  const ME = 'account-me';
  const OWNER = 'account-owner';
  const build = (profile: any) => {
    const service = Object.create(CareerLadderService.prototype) as any;
    service.profileRepository = { findOne: jest.fn().mockResolvedValue(profile) };
    service.dataSource = {
      manager: {
        query: jest.fn().mockResolvedValue([{ owner_account_id: OWNER }]),
      },
    };
    return service;
  };
  const myProfile = (over = {}) => ({
    id: 'p-me',
    storeId: 'store-1',
    accountId: ME,
    employmentStatus: EmploymentStatus.ACTIVE,
    ...over,
  });

  it('nhân viên xem được lộ trình của chính mình', async () => {
    await expect(build(myProfile()).assertCanViewOwnCareer('p-me', ME)).resolves.toBeTruthy();
  });

  it('chủ cửa hàng xem được', async () => {
    await expect(build(myProfile()).assertCanViewOwnCareer('p-me', OWNER)).resolves.toBeTruthy();
  });

  // Guard "thuộc cửa hàng" cho đồng nghiệp đi qua; phải chặn ở đây.
  it('đồng nghiệp cùng cửa hàng bị từ chối', async () => {
    await expect(
      build(myProfile()).assertCanViewOwnCareer('p-me', 'account-coworker'),
    ).rejects.toThrow('Bạn chỉ có thể xem lộ trình của chính mình');
  });

  it('người đã nghỉ việc không xem được hồ sơ cũ', async () => {
    await expect(
      build(myProfile({ employmentStatus: EmploymentStatus.TERMINATED })).assertCanViewOwnCareer(
        'p-me',
        ME,
      ),
    ).rejects.toThrow();
  });

  it('hồ sơ không tồn tại thì 404', async () => {
    await expect(build(null).assertCanViewOwnCareer('p-x', ME)).rejects.toThrow(
      'Không tìm thấy nhân viên',
    );
  });
});

describe('getCareerSummary', () => {
  it('mỗi lộ trình trả bậc đang giữ và bậc kế có tiến độ cao nhất, không lộ số đo thô', async () => {
    const service = Object.create(CareerLadderService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue(profile({ employeeTypeId: 'type-probation' })),
    };
    service.ladderRepository = {
      find: jest.fn().mockResolvedValue([
        ladder({ id: 'L-emp', dimension: LadderDimension.EMPLOYMENT_TYPE, name: 'Lộ trình nhân sự' }),
      ]),
    };
    service.currentRung = jest.fn().mockResolvedValue(rung({ id: 'r1', targetId: 'type-probation' }));
    service.targetNames = jest.fn().mockResolvedValue(new Map([['type-probation', 'Thử việc']]));
    service.nextRungs = jest.fn().mockResolvedValue([
      { rungId: 'r-a', targetName: 'Nhánh A', level: 2, progress: 20, passed: false, items: [] },
      {
        rungId: 'r-b',
        targetName: 'Chính thức',
        level: 2,
        progress: 80,
        passed: false,
        items: [
          { label: 'Đủ 30 ngày', kind: 'tenure', met: true, isRequired: true, current: 45, target: 30 },
        ],
      },
    ]);

    const result = await service.getCareerSummary('profile-1');

    expect(result.ladders).toEqual([
      {
        ladderId: 'L-emp',
        ladderName: 'Lộ trình nhân sự',
        dimension: LadderDimension.EMPLOYMENT_TYPE,
        currentName: 'Thử việc',
        next: {
          rungId: 'r-b',
          name: 'Chính thức',
          progress: 80,
          passed: false,
          items: [{ label: 'Đủ 30 ngày', kind: 'tenure', met: true, isRequired: true }],
        },
      },
    ]);
  });
});

describe('probationDeadline — hạn thử việc lấy từ bậc kế tiếp (C)', () => {
  const managerWith = (opts: { next?: any[]; own?: any }) => ({
    find: jest.fn(async (entity: any) =>
      entity?.name === 'StoreLadderEdge'
        ? [{ toRungId: 'rung-official' }]
        : (opts.next ?? []),
    ),
    findOne: jest.fn().mockResolvedValue(opts.own ?? null),
  });

  it("dùng days_in_rung của bậc Chính thức", async () => {
    const service = build();
    const before = Date.now();
    const deadline: Date = await service.probationDeadline(
      managerWith({ next: [{ value: 60 }] }),
      'rung-probation',
    );
    const days = (deadline.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(59.99);
    expect(days).toBeLessThan(60.01);
  });

  it('không có thì lấy của chính bậc thử việc', async () => {
    const service = build();
    const before = Date.now();
    const deadline: Date = await service.probationDeadline(
      managerWith({ own: { value: 14 } }),
      'rung-probation',
    );
    expect(Math.round((deadline.getTime() - before) / 86_400_000)).toBe(14);
  });
});

describe('metricValue — KPI_COMPLETION tính từ nhiệm vụ KPI (D6)', () => {
  const withTasks = (row: any) => {
    const service = build({
      criteria: [
        criteria({
          code: CriteriaCode.KPI_COMPLETION,
          value: 80,
          label: 'Hoàn thành 80% KPI',
        }),
      ],
      // The deprecated monthly counters say 3/4; they must be ignored.
      summaries: [summary({ kpiTotalCount: 4, kpiCompletedCount: 3 })],
    });
    const qb: any = {};
    for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawOne = jest.fn().mockResolvedValue(row);
    service.dataSource = { getRepository: jest.fn(() => ({ createQueryBuilder: () => qb })) };
    return { service, qb };
  };

  it('đếm nhiệm vụ đạt 100% trên tổng nhiệm vụ tháng này', async () => {
    const { service, qb } = withTasks({ total: '5', done: '4' });
    const result = await service.evaluateRung(profile(), rung(), ladder());
    expect(result.items[0]).toMatchObject({ current: 80, met: true });
    // Only owner-confirmed KPIs: self-reported progress on an active KPI
    // must not move career eligibility.
    expect(qb.andWhere).toHaveBeenCalledWith('kpi.status = :status', {
      status: 'Hoàn thành',
    });
    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'kpi.status IN (:...statuses)',
      expect.anything(),
    );
    expect(qb.andWhere).toHaveBeenCalledWith('kpi.deleted_at IS NULL');
    expect(qb.andWhere).toHaveBeenCalledWith('task.is_hidden = false');
    expect(qb.where).toHaveBeenCalledWith('kpi.employee_profile_id = :profileId', {
      profileId: PROFILE,
    });
  });

  it('trả 0 khi không có nhiệm vụ nào', async () => {
    const { service } = withTasks({ total: '0', done: '0' });
    const result = await service.evaluateRung(profile(), rung(), ladder());
    expect(result.items[0]).toMatchObject({ current: 0, met: false });
  });
});

describe('CareerLadderService — current employment stint only', () => {
  const build = (joinedAt: Date | null) => {
    const service = Object.create(CareerLadderService.prototype) as any;
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue({ id: PROFILE, joinedAt }),
    };
    service.capabilityRepository = { find: jest.fn().mockResolvedValue([]) };
    service.eventRepository = { find: jest.fn().mockResolvedValue([]) };
    service.rungRepository = { find: jest.fn().mockResolvedValue([]) };
    return service;
  };

  it('filters capability entries from the rehire onwards', async () => {
    const service = build(new Date('2026-09-10T03:00:00.000Z'));

    await service.getCapabilityEntries(PROFILE);

    const where = service.capabilityRepository.find.mock.calls[0][0].where;
    expect(where.employeeProfileId).toBe(PROFILE);
    expect(where.awardedAt.type).toBe('moreThanOrEqual');
    expect(where.awardedAt.value.toISOString()).toBe('2026-09-10T02:59:00.000Z');
  });

  it('filters career history from the rehire onwards', async () => {
    const service = build(new Date('2026-09-10T03:00:00.000Z'));

    await service.getCareerHistory(PROFILE);

    const where = service.eventRepository.find.mock.calls[0][0].where;
    expect(where.effectiveAt.type).toBe('moreThanOrEqual');
    expect(where.effectiveAt.value.toISOString()).toBe('2026-09-10T02:59:00.000Z');
  });

  it('does not filter a legacy profile without joinedAt', async () => {
    const service = build(null);

    await service.getCapabilityEntries(PROFILE);
    await service.getCareerHistory(PROFILE);

    expect(service.capabilityRepository.find.mock.calls[0][0].where).toEqual({
      employeeProfileId: PROFILE,
    });
    expect(service.eventRepository.find.mock.calls[0][0].where).toEqual({
      employeeProfileId: PROFILE,
    });
  });
});

describe('CareerLadderService — rehire leaks A/B (current stint only)', () => {
  const JOINED = new Date('2026-09-10T03:00:00.000Z');
  const FLOOR = '2026-09-10T02:59:00.000Z';

  const withKpiTasks = (joinedAt: Date | null) => {
    const service = build({
      criteria: [
        criteria({ code: CriteriaCode.KPI_COMPLETION, value: 80, label: 'KPI' }),
      ],
    });
    const qb: any = {};
    for (const method of ['innerJoin', 'select', 'addSelect', 'where', 'andWhere']) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawOne = jest.fn().mockResolvedValue({ total: '2', done: '2' });
    service.dataSource = { getRepository: jest.fn(() => ({ createQueryBuilder: () => qb })) };
    return { service, qb, subject: profile({ joinedAt }) };
  };

  it('KPI completion counts only KPIs created in the current stint', async () => {
    const { service, qb, subject } = withKpiTasks(JOINED);

    await service.evaluateRung(subject, rung(), ladder());

    const call = qb.andWhere.mock.calls.find(
      ([sql]: [string]) => sql === 'kpi.created_at >= :stint',
    );
    expect(call).toBeDefined();
    expect(call[1].stint.toISOString()).toBe(FLOOR);
  });

  it('KPI completion is not filtered for a legacy profile', async () => {
    const { service, qb, subject } = withKpiTasks(null);

    await service.evaluateRung(subject, rung(), ladder());

    expect(qb.andWhere).not.toHaveBeenCalledWith(
      'kpi.created_at >= :stint',
      expect.anything(),
    );
  });

  const progression = (joinedAt: Date | null, events: any[]) => {
    const service = build();
    service.profileRepository = {
      findOne: jest.fn().mockResolvedValue(profile({ joinedAt })),
    };
    service.ladderRepository = { find: jest.fn().mockResolvedValue([ladder()]) };
    service.rungRepository.find = jest.fn().mockResolvedValue([
      rung({ id: 'rung-1', level: 1, targetId: 'role-1' }),
      rung({ id: 'rung-2', level: 2, targetId: 'role-2' }),
    ]);
    service.edgeRepository = { find: jest.fn().mockResolvedValue([]) };
    service.currentRung = jest.fn().mockResolvedValue(null);
    service.targetNames = jest.fn().mockResolvedValue(new Map());
    service.eventRepository.find = jest.fn().mockResolvedValue(events);
    return service;
  };

  it('progression timeline ignores rungs traversed in the previous stint', async () => {
    const service = progression(JOINED, []);

    const stages = await service.getProgressionStages(PROFILE);

    const where = service.eventRepository.find.mock.calls[0][0].where;
    expect(where).toMatchObject({ employeeProfileId: PROFILE, ladderId: 'ladder-1' });
    expect(where.effectiveAt.type).toBe('moreThanOrEqual');
    expect(where.effectiveAt.value.toISOString()).toBe(FLOOR);
    expect(stages.map((s: any) => s.progress)).toEqual([0, 0]);
  });

  it('progression timeline is not filtered for a legacy profile', async () => {
    const service = progression(null, [{ fromRungId: null, toRungId: 'rung-1' }]);

    const stages = await service.getProgressionStages(PROFILE);

    expect(service.eventRepository.find.mock.calls[0][0].where).toEqual({
      employeeProfileId: PROFILE,
      ladderId: 'ladder-1',
    });
    expect(stages[0].progress).toBe(100);
  });
});
