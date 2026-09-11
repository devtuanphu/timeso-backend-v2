import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Store } from '../stores/entities/store.entity';

/**
 * Requires the caller to own the store named by the `:id` route parameter.
 *
 * Every route on `AiReportsController` takes a store id and returns that
 * store's revenue, forecast, loss analysis and employee rankings, but none of
 * them received the caller at all — `JwtAuthGuard` proved only that *someone*
 * was signed in, so any authenticated account could read any store's business
 * figures by supplying its UUID.
 *
 * This is applied at the class level rather than threaded through the eleven
 * service methods, so a route added later cannot silently miss the check.
 *
 * If another module needs the same rule, move this to `src/common/guards/`.
 */
@Injectable()
export class StoreOwnerGuard implements CanActivate {
  constructor(
    @InjectRepository(Store)
    private readonly storeRepository: Repository<Store>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const storeId: string | undefined = request.params?.id;
    const accountId: string | undefined = request.user?.userId;

    if (!storeId) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }
    if (!accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    const store = await this.storeRepository.findOne({
      where: { id: storeId },
      select: ['id', 'ownerAccountId'],
    });

    // 404 before 403, matching `assertOwnerStoreAccess`, so a wrong id and a
    // foreign id are not distinguishable by anyone who owns neither.
    if (!store) {
      throw new NotFoundException('Cửa hàng không tồn tại');
    }
    if (store.ownerAccountId !== accountId) {
      throw new ForbiddenException('Bạn không có quyền truy cập cửa hàng này');
    }

    return true;
  }
}
