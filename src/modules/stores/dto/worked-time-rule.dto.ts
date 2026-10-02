import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';

/** Employees one rule may name at once (a store has far fewer). */
export const WORKED_TIME_RULE_MAX_EMPLOYEES = 500;

import {
  WORKED_TIME_MODES,
  WORKED_TIME_PERIODS,
  type WorkedTimeMode,
  type WorkedTimePeriod,
} from '../worked-time-rules';

/** POST /stores/:id/worked-time-rules — "Cách tính giờ công". */
export class CreateWorkedTimeRuleDto {
  @ApiProperty({
    enum: WORKED_TIME_MODES,
    description:
      'SHIFT = Tính lương theo ca; ACTUAL = Làm bao nhiêu trả bấy nhiêu',
  })
  @IsIn(WORKED_TIME_MODES, { message: 'Cách tính giờ công không hợp lệ.' })
  mode: WorkedTimeMode;

  @ApiProperty({ enum: WORKED_TIME_PERIODS, description: 'Thời hạn áp dụng' })
  @IsIn(WORKED_TIME_PERIODS, { message: 'Thời hạn áp dụng không hợp lệ.' })
  period: WorkedTimePeriod;

  @ApiProperty({
    example: '2026-10-02',
    description: 'Ngày bắt đầu áp dụng (YYYY-MM-DD)',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Ngày bắt đầu không hợp lệ (YYYY-MM-DD).',
  })
  startDate: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Các nhân viên được áp dụng. Bỏ trống (và không có employeeProfileId) = toàn cửa hàng',
  })
  @IsOptional()
  @IsArray({ message: 'Danh sách nhân viên không hợp lệ.' })
  @ArrayNotEmpty({ message: 'Vui lòng chọn ít nhất một nhân viên.' })
  @ArrayMaxSize(WORKED_TIME_RULE_MAX_EMPLOYEES, {
    message: `Chọn tối đa ${WORKED_TIME_RULE_MAX_EMPLOYEES} nhân viên.`,
  })
  @IsUUID('4', { each: true, message: 'Nhân viên không hợp lệ.' })
  employeeProfileIds?: string[];

  @ApiPropertyOptional({
    description:
      'Một nhân viên (cách gửi cũ, tương đương employeeProfileIds 1 phần tử)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Nhân viên không hợp lệ.' })
  employeeProfileId?: string;
}
