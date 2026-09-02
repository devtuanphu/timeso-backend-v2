import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccountsModule } from '../accounts/accounts.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { MailModule } from '../mail/mail.module';
import { ZaloModule } from '../zalo/zalo.module';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';
import { AccountRefreshToken } from '../accounts/entities/account-refresh-token.entity';
import { StoresModule } from '../stores/stores.module';
import { createJwtModuleOptions } from './jwt.config';

@Module({
  imports: [
    AccountsModule,
    MailModule,
    ZaloModule,
    StoresModule,
    PassportModule,
    TypeOrmModule.forFeature([EmployeeProfile, AccountRefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: createJwtModuleOptions,
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
