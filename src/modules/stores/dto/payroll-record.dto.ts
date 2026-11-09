import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/** Chủ ghi nhận một khoản thưởng / vi phạm thủ công cho một nhân viên. */
/** Một lần ghi nhận tối đa 100 triệu đồng (như mức tối đa của một khoản). */
export const PAYROLL_RECORD_AMOUNT_MAX = 100_000_000;

export class CreatePayrollRecordDto {
  @ApiProperty({ description: 'Khoản (store_payroll_rules.id), loại ghi nhận thủ công' })
  @IsUUID()
  ruleId: string;

  @ApiProperty({ example: '2026-10-15', description: 'Ngày phát sinh (giờ VN)' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  workDate: string;

  @ApiProperty({ example: 1, description: 'Số giờ / ca / lần, theo cách tính của khoản' })
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  quantity: number;

  @ApiPropertyOptional({
    example: 30000,
    description:
      'Số tiền của riêng lần này (đồng). Bỏ trống = tính theo cách tính của khoản × số lượng.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PAYROLL_RECORD_AMOUNT_MAX)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

/** Sửa một lần ghi nhận: ngày, số lượng, ghi chú (đổi khoản = xoá rồi ghi lại). */
export class UpdatePayrollRecordDto {
  @ApiPropertyOptional({ example: '2026-10-15', description: 'Ngày phát sinh (giờ VN)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  workDate?: string;

  @ApiPropertyOptional({ example: 1, description: 'Số giờ / ca / lần, theo cách tính của khoản' })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(1000)
  quantity?: number;

  @ApiPropertyOptional({
    example: 20000,
    nullable: true,
    description: 'Số tiền của riêng lần này (đồng); null = bỏ, tính lại theo cách tính của khoản.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(PAYROLL_RECORD_AMOUNT_MAX)
  amount?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

/**
 * Chủ xoá một khoản thưởng / vi phạm trong popup chi tiết của sao kê lương,
 * kèm lý do. `recordId` (ghi nhận tay) hoặc `assignmentId` (một lần của khoản
 * tự động, theo ca); không có cả hai = cả dòng của khoản trong tháng.
 */
export class CreatePayrollWaiverDto {
  @ApiPropertyOptional({
    description: 'Khoản của dòng (adjustmentBreakdown[].ruleId); bắt buộc trừ khi xoá ghi nhận tay (recordId)',
  })
  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @ApiProperty({ example: '2026-11', description: 'Tháng của phiếu lương (YYYY-MM)' })
  @Matches(/^\d{4}-\d{2}$/)
  month: string;

  @ApiPropertyOptional({ description: 'Ca của lần tự động (occurrences[].assignmentId)' })
  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @ApiPropertyOptional({ description: 'Ghi nhận tay (occurrences[].recordId)' })
  @IsOptional()
  @IsUUID()
  recordId?: string;

  @ApiProperty({ description: 'Lý do xoá' })
  @IsString()
  @MaxLength(300)
  reason: string;
}

export class UpdateOvertimeCoefficientDto {
  @ApiProperty({
    example: 1.5,
    description: 'Hệ số lương giờ / ca của khoản "Tăng ca" (1,5 = trả 150% lương giờ)',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(100)
  coef: number;
}
