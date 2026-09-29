import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { ACTIVITY_ACTION_CODES } from '../activity-log.summary';
import { ACTIVITY_LOG_MAX_LIMIT } from '../activity-log.service';

/** `GET /stores/:storeId/me/activity-logs` */
export class MyActivityLogQueryDto {
  @ApiPropertyOptional({ description: 'nextCursor của trang trước' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: ACTIVITY_LOG_MAX_LIMIT, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(ACTIVITY_LOG_MAX_LIMIT)
  limit?: number;
}

/** `GET /stores/:storeId/activity-logs` (owner) */
export class StoreActivityLogQueryDto extends MyActivityLogQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo nhân viên (đối tượng)' })
  @IsOptional()
  @IsUUID()
  employeeProfileId?: string;

  @ApiPropertyOptional({ enum: ACTIVITY_ACTION_CODES })
  @IsOptional()
  @IsIn(ACTIVITY_ACTION_CODES as string[])
  action?: string;

  @ApiPropertyOptional({ description: 'Từ ngày (YYYY-MM-DD, giờ VN)' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  from?: string;

  @ApiPropertyOptional({ description: 'Đến ngày (YYYY-MM-DD, giờ VN, gồm cả ngày này)' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  to?: string;
}
