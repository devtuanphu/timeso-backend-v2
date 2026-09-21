import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ZaloService } from './zalo.service';
import { ZaloController } from './zalo.controller';
import { ZaloToken } from './entities/zalo-token.entity';
import { ZaloOAuthStateService } from './zalo-oauth-state.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ZaloToken]),
    HttpModule,
  ],
  controllers: [ZaloController],
  providers: [ZaloService, ZaloOAuthStateService],
  exports: [ZaloService],
})
export class ZaloModule {}
