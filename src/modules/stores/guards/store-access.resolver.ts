import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';

import {
  EmployeeProfile,
  EmploymentStatus,
} from '../entities/employee-profile.entity';
import { Store } from '../entities/store.entity';

/**
 * The single definition of "may this account act on this store".
 *
 * Shared by `StoreAccessGuard` (routes addressed by the store) and
 * `StoreResourceAccessGuard` (routes addressed by a sub-resource) so the two
 * cannot drift into different answers for the same question.
 *
 * The rule is tenancy, not role: the store owner, or anyone holding a
 * non-terminated employee profile at that store.
 */
@Injectable()
export class StoreAccessResolver {
  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
    @InjectRepository(EmployeeProfile)
    private readonly profileRepository: Repository<EmployeeProfile>,
  ) {}

  /** Returns true, or throws. Never returns false. */
  async assertAccess(storeId: string, accountId: string): Promise<boolean> {
    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });
    // 404 before 403, so a non-existent store and a foreign one are
    // indistinguishable to someone entitled to neither.
    if (!store) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }
    if (store.ownerAccountId === accountId) return true;

    const isEmployed = await this.profileRepository.exists({
      where: {
        accountId,
        storeId,
        employmentStatus: Not(EmploymentStatus.TERMINATED),
      },
    });
    if (isEmployed) return true;

    throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
  }
}
