import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Editable payslip figures. No `id`, no relation objects, no approval or
 * payment state (those move only through the approve/pay routes), so a body
 * cannot point the row at another store's employee or payroll.
 */
export class UpdateEmployeeSalaryDto {
  @ApiPropertyOptional({ description: 'Bảng lương tháng (cùng cửa hàng)' })
  @IsOptional()
  @IsUUID()
  monthlyPayrollId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  baseSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  paymentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  earnedBaseSalary?: number;

  @ApiPropertyOptional({ example: { 'Tiền ăn': 500000 } })
  @IsOptional()
  @IsObject()
  allowances?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  bonus?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  penalty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  workingDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  workingHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unauthorizedLeaveDays?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  advancePayment?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  otherDeductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalIncome?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  totalDeductions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  netSalary?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class CreateEmployeeSalaryDto extends UpdateEmployeeSalaryDto {
  @ApiProperty({ description: 'Hồ sơ nhân viên' })
  @IsUUID()
  employeeProfileId: string;

  @ApiProperty({ description: 'Tháng lương (YYYY-MM hoặc YYYY-MM-DD)' })
  @IsString()
  @IsNotEmpty()
  month: string;
}
