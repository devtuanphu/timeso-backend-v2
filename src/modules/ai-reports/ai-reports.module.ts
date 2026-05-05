import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiReportsController } from './ai-reports.controller';
import { AiReportsService } from './ai-reports.service';
import { Order } from '../stores/entities/order.entity';
import {
  ShiftAssignment,
  ShiftSlot,
} from '../stores/entities/shift-management.entity';
import { EmployeeProfile } from '../stores/entities/employee-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      ShiftAssignment,
      ShiftSlot,
      EmployeeProfile,
    ]),
  ],
  controllers: [AiReportsController],
  providers: [AiReportsService],
  exports: [AiReportsService],
})
export class AiReportsModule {}
