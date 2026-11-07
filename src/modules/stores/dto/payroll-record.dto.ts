import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

/** Chủ ghi nhận một khoản thưởng / vi phạm thủ công cho một nhân viên. */
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
