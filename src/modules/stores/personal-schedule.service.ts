import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';

import { vnDateString } from '../../common/utils/vn-calendar';
import {
  CreatePersonalScheduleDto,
  UpdatePersonalScheduleDto,
} from './dto/personal-schedule.dto';
import {
  EmployeePersonalSchedule,
  PersonalScheduleKind,
} from './entities/employee-personal-schedule.entity';
import {
  EmployeeProfile,
  isEmployedStatus,
} from './entities/employee-profile.entity';
import { stintFloor } from './employment-stint.utils';
import {
  normalizePersonalSlots,
  PERSONAL_SCHEDULE_MAX_PER_EMPLOYEE,
} from './personal-schedule.utils';
import { StoresService } from './stores.service';

type ProfileRef = Pick<EmployeeProfile, 'id' | 'storeId' | 'joinedAt'>;

/** Hàng của lịch cá nhân trả cho app (không có clientRequestId). */
const toDto = (schedule: EmployeePersonalSchedule) => ({
  id: schedule.id,
  kind: schedule.kind,
  repeat: schedule.repeat,
  slots: schedule.slots,
  note: schedule.note,
  createdAt: schedule.createdAt,
  updatedAt: schedule.updatedAt,
});

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === '23505';

/**
 * Lịch cá nhân (lịch trống / bận / học): nhân viên tự thêm, sửa, xoá lịch của
 * chính mình; chủ cửa hàng chỉ đọc. Chỉ lịch của đợt làm hiện tại (sau lần
 * tuyển lại gần nhất) được tính.
 */
@Injectable()
export class PersonalScheduleService {
  constructor(
    @InjectRepository(EmployeePersonalSchedule)
    private readonly scheduleRepository: Repository<EmployeePersonalSchedule>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
    private readonly storesService: StoresService,
  ) {}

  /** Hồ sơ của người gọi ở cửa hàng này; chỉ người đang làm việc. */
  private async resolveSelf(storeId: string, accountId: string): Promise<ProfileRef> {
    const profile = await this.profileRepository.findOne({
      where: { storeId, accountId },
      select: ['id', 'storeId', 'joinedAt', 'employmentStatus'],
    });
    if (!profile || !isEmployedStatus(profile.employmentStatus)) {
      throw new ForbiddenException('Bạn không phải nhân viên của cửa hàng này');
    }
    return profile;
  }

  private currentStint(profile: ProfileRef) {
    const floor = stintFloor(profile.joinedAt);
    return {
      employeeProfileId: profile.id,
      ...(floor ? { createdAt: MoreThanOrEqual(floor) } : {}),
    };
  }

  private async list(profile: ProfileRef) {
    const schedules = await this.scheduleRepository.find({
      where: this.currentStint(profile),
      order: { createdAt: 'DESC' },
    });
    const summary: Record<PersonalScheduleKind, number> = {
      AVAILABLE: 0,
      BUSY: 0,
      STUDY: 0,
    };
    for (const schedule of schedules) summary[schedule.kind] += 1;
    return { schedules: schedules.map(toDto), summary };
  }

  private normalize(dto: UpdatePersonalScheduleDto) {
    const result = normalizePersonalSlots(dto.slots, vnDateString());
    if ('error' in result) throw new BadRequestException(result.error);
    const note = dto.note?.trim();
    return { repeat: dto.repeat, slots: result.slots, note: note || null };
  }

  async listMine(storeId: string, accountId: string) {
    return this.list(await this.resolveSelf(storeId, accountId));
  }

  /** Chủ cửa hàng (hoặc chính nhân viên) xem lịch cá nhân của một nhân viên. */
  async listForEmployee(storeId: string, profileId: string, accountId: string) {
    await this.storesService.assertEmployeeCalendarAccess(profileId, accountId, storeId);
    const profile = await this.profileRepository.findOne({
      where: { id: profileId },
      select: ['id', 'storeId', 'joinedAt'],
    });
    if (!profile) throw new NotFoundException('Không tìm thấy nhân viên');
    return this.list(profile);
  }

  async create(storeId: string, accountId: string, dto: CreatePersonalScheduleDto) {
    const profile = await this.resolveSelf(storeId, accountId);
    const values = this.normalize(dto);

    if (dto.clientRequestId) {
      const existing = await this.scheduleRepository.findOne({
        where: { employeeProfileId: profile.id, clientRequestId: dto.clientRequestId },
      });
      if (existing) return toDto(existing);
    }

    // Giới hạn mềm: hai lần tạo đồng thời có thể vượt một chút, không hại gì.
    const count = await this.scheduleRepository.count({ where: this.currentStint(profile) });
    if (count >= PERSONAL_SCHEDULE_MAX_PER_EMPLOYEE) {
      throw new BadRequestException(
        `Bạn đã có ${PERSONAL_SCHEDULE_MAX_PER_EMPLOYEE} lịch. Xoá bớt lịch cũ rồi thêm lại.`,
      );
    }

    try {
      const saved = await this.scheduleRepository.save(
        this.scheduleRepository.create({
          storeId: profile.storeId,
          employeeProfileId: profile.id,
          kind: dto.kind,
          clientRequestId: dto.clientRequestId ?? null,
          ...values,
        }),
      );
      return toDto(saved);
    } catch (error) {
      // Hai lần gửi cùng clientRequestId chạy song song: lần sau trả bản đã tạo.
      if (dto.clientRequestId && isUniqueViolation(error)) {
        const existing = await this.scheduleRepository.findOne({
          where: { employeeProfileId: profile.id, clientRequestId: dto.clientRequestId },
        });
        if (existing) return toDto(existing);
      }
      throw error;
    }
  }

  private async findMine(storeId: string, accountId: string, scheduleId: string) {
    const profile = await this.resolveSelf(storeId, accountId);
    const schedule = await this.scheduleRepository.findOne({
      where: { id: scheduleId, ...this.currentStint(profile) },
    });
    if (!schedule) throw new NotFoundException('Không tìm thấy lịch');
    return schedule;
  }

  async update(
    storeId: string,
    accountId: string,
    scheduleId: string,
    dto: UpdatePersonalScheduleDto,
  ) {
    const schedule = await this.findMine(storeId, accountId, scheduleId);
    Object.assign(schedule, this.normalize(dto));
    return toDto(await this.scheduleRepository.save(schedule));
  }

  async remove(storeId: string, accountId: string, scheduleId: string) {
    const schedule = await this.findMine(storeId, accountId, scheduleId);
    await this.scheduleRepository.delete({ id: schedule.id });
    return { success: true };
  }
}
