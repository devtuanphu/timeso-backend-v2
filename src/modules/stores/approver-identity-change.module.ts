import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationsModule } from '../notifications/notifications.module';
import { StoreRequestApprover } from './entities/store-request-approver.entity';
import { EmployeeProfile } from './entities/employee-profile.entity';
import { Store } from './entities/store.entity';
import { APPROVER_IDENTITY_CHANGE_HOOK } from './approver-identity-change.hook';
import { ApproverIdentityChangeService } from './approver-identity-change.service';

/**
 * A4(b): exposes the approver-identity-change hook GLOBALLY so the accounts
 * module can fire it without importing the stores module (which would be a
 * cycle: NotificationsModule already depends on AccountsModule). `@Global` makes
 * the exported token visible to every injector, including AccountsController,
 * while this module itself depends only downward on NotificationsModule.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([StoreRequestApprover, EmployeeProfile, Store]),
    NotificationsModule,
  ],
  providers: [
    ApproverIdentityChangeService,
    {
      provide: APPROVER_IDENTITY_CHANGE_HOOK,
      useExisting: ApproverIdentityChangeService,
    },
  ],
  exports: [APPROVER_IDENTITY_CHANGE_HOOK],
})
export class ApproverIdentityChangeModule {}
