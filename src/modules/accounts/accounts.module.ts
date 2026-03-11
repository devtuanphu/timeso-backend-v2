import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { AccountIdentityDocument } from './entities/account-identity-document.entity';
import { AccountFinance } from './entities/account-finance.entity';
import { AccountRefreshToken } from './entities/account-refresh-token.entity';
import { AccountOtp } from './entities/account-otp.entity';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Account,
      AccountIdentityDocument,
      AccountFinance,
      AccountRefreshToken,
      AccountOtp,
      EmployeeProfile,
    ]),
  ],
  providers: [AccountsService],
  controllers: [AccountsController],
  exports: [AccountsService, TypeOrmModule],
})
export class AccountsModule {}
