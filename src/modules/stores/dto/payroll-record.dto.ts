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
