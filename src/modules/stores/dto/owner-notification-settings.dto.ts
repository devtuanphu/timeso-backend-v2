import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

import { OWNER_PRE_SHIFT_MINUTES } from '../owner-notification.utils';

/**
 * `PUT /stores/:id/owner-notification-settings`. Every field optional; an
 * omitted field keeps its current value (defaults: all on, 30 minutes).
 */
export class UpdateOwnerNotificationSettingsDto {
  @ApiPropertyOptional({ description: 'Báo trước khi ca bắt đầu' })
  @IsOptional()
  @IsBoolean()
  preShiftEnabled?: boolean;

  @ApiPropertyOptional({ enum: OWNER_PRE_SHIFT_MINUTES, default: 30 })
  @IsOptional()
  @IsIn(OWNER_PRE_SHIFT_MINUTES as unknown as number[])
  preShiftMinutes?: 15 | 30;

  @ApiPropertyOptional({ description: 'Báo khi nhân viên check-in' })
  @IsOptional()
  @IsBoolean()
  checkInEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Báo khi nhân viên check-out' })
  @IsOptional()
  @IsBoolean()
  checkOutEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Báo 15 phút trước khi ca kết thúc' })
  @IsOptional()
  @IsBoolean()
  shiftEndingEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Báo đi trễ / về sớm' })
  @IsOptional()
  @IsBoolean()
  lateEarlyEnabled?: boolean;
}
