import { EntityManager, In } from 'typeorm';

import { EmployeePersonalSchedule } from './entities/employee-personal-schedule.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { stintFloor } from './employment-stint.utils';

/**
 * Lịch cá nhân (đợt làm hiện tại) của các nhân viên trong cửa hàng, theo id
 * hồ sơ. Dùng cho cảnh báo khi chủ xếp ca.
 */
export async function loadPersonalSchedules(
  manager: EntityManager,
  storeId: string,
  profiles: Pick<EmployeeProfile, 'id' | 'joinedAt'>[],
): Promise<Map<string, EmployeePersonalSchedule[]>> {
  const result = new Map<string, EmployeePersonalSchedule[]>();
  if (!profiles.length) return result;
  const rows = await manager.getRepository(EmployeePersonalSchedule).find({
    where: { storeId, employeeProfileId: In(profiles.map((profile) => profile.id)) },
  });
  const floors = new Map(profiles.map((profile) => [profile.id, stintFloor(profile.joinedAt)]));
  for (const row of rows) {
    const floor = floors.get(row.employeeProfileId);
    if (floor && row.createdAt < floor) continue;
    const list = result.get(row.employeeProfileId) ?? [];
    list.push(row);
    result.set(row.employeeProfileId, list);
  }
  return result;
}
