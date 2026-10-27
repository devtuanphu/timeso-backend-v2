import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DEFAULT_WORK_TYPES, StoreWorkType } from './entities/store-work-type.entity';

/**
 * Danh mục hình thức làm việc của cửa hàng (Toàn thời gian, Bán thời gian…).
 * Chỉ phân loại — không ảnh hưởng lương, ca, chấm công.
 */
@Injectable()
export class WorkTypesService {
  constructor(
    @InjectRepository(StoreWorkType)
    private readonly repo: Repository<StoreWorkType>,
  ) {}

  /**
   * Danh mục còn dùng, theo thứ tự. Cửa hàng chưa từng có mục nào (kể cả đã
   * xoá) thì tạo bốn mục mặc định — chủ xoá hết thì không tạo lại.
   */
  async list(storeId: string) {
    const ever = await this.repo.count({ where: { storeId }, withDeleted: true });
    if (ever === 0) {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(StoreWorkType)
        .values(
          DEFAULT_WORK_TYPES.map((t, index) => ({
            storeId,
            name: t.name,
            description: t.description,
            sortOrder: index,
            isActive: true,
          })),
        )
        // Hai lần mở cùng lúc: ràng buộc unique (store, tên) chặn bản thứ hai.
        .orIgnore()
        .execute();
    }
    const rows = await this.repo.find({
      where: { storeId, isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((t) => this.view(t));
  }

  async create(storeId: string, data: { name: string; description?: string | null }) {
    const name = data.name.trim();
    await this.assertNameFree(storeId, name);
    const last = await this.repo
      .createQueryBuilder('t')
      .select('COALESCE(MAX(t.sort_order), -1)', 'max')
      .where('t.store_id = :storeId', { storeId })
      .getRawOne<{ max: number }>();
    const saved = await this.repo.save(
      this.repo.create({
        storeId,
        name,
        description: data.description?.trim() || null,
        sortOrder: Number(last?.max ?? -1) + 1,
        isActive: true,
      }),
    );
    return this.view(saved);
  }

  async update(
    storeId: string,
    id: string,
    data: { name?: string; description?: string | null },
  ) {
    const row = await this.owned(storeId, id);
    if (data.name !== undefined) {
      const name = data.name.trim();
      await this.assertNameFree(storeId, name, row.id);
      row.name = name;
    }
    if (data.description !== undefined) row.description = data.description?.trim() || null;
    return this.view(await this.repo.save(row));
  }

  /**
   * Xoá mềm và gỡ khỏi nhân viên đang mang nó — xoá mềm không kích hoạt FK
   * SET NULL, mà quan hệ tới hàng đã xoá mềm đọc ra null, nên để lại id thì
   * hồ sơ trỏ vào một mục không ai thấy được.
   */
  async remove(storeId: string, id: string) {
    return this.repo.manager.transaction(async (manager) => {
      const row = await manager.findOne(StoreWorkType, { where: { id, storeId } });
      if (!row) throw new NotFoundException('Không tìm thấy hình thức làm việc');
      await manager.query(
        `UPDATE employee_profiles SET work_type_id = NULL, updated_at = now()
          WHERE store_id = $1 AND work_type_id = $2`,
        [storeId, id],
      );
      await manager.softRemove(row);
      return { id: row.id, deleted: true };
    });
  }

  private async owned(storeId: string, id: string) {
    const row = await this.repo.findOne({ where: { id, storeId } });
    if (!row) throw new NotFoundException('Không tìm thấy hình thức làm việc');
    return row;
  }

  private async assertNameFree(storeId: string, name: string, exceptId?: string) {
    if (!name) throw new BadRequestException('Nhập tên hình thức làm việc');
    const clash = await this.repo
      .createQueryBuilder('t')
      .where('t.store_id = :storeId', { storeId })
      .andWhere('lower(t.name) = lower(:name)', { name })
      .andWhere(exceptId ? 't.id <> :exceptId' : '1=1', { exceptId })
      .getOne();
    if (clash) throw new ConflictException('Đã có hình thức làm việc cùng tên');
  }

  private view(t: StoreWorkType) {
    return {
      id: t.id,
      name: t.name,
      description: t.description ?? null,
      sortOrder: t.sortOrder,
    };
  }
}
