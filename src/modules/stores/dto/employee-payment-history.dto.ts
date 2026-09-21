import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * Editable fields of an individual salary payment. No `id` (it was
 * `Object.assign`ed onto the loaded row, so a body could overwrite another
 * row), no relation objects, and the bank snapshot is derived server-side.
 */
class EmployeePaymentFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;

  @ApiPropertyOptional({ description: 'Thời điểm thanh toán (ISO)' })
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  paymentMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  referenceNumber?: string;

  @ApiPropertyOptional({ description: 'Tài khoản thanh toán (cùng cửa hàng)' })
  @IsOptional()
  @IsUUID()
  paymentAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateEmployeePaymentHistoryDto extends EmployeePaymentFieldsDto {
  @ApiPropertyOptional({ description: 'Tháng lương (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  salaryMonth?: string;
}

export class CreateEmployeePaymentHistoryDto extends EmployeePaymentFieldsDto {
  @ApiProperty({ description: 'Hồ sơ nhân viên' })
  @IsUUID()
  employeeProfileId: string;

  @ApiPropertyOptional({
    description: 'Cửa hàng; nếu gửi, phải là cửa hàng của nhân viên',
  })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiProperty({ description: 'Tháng lương (YYYY-MM-DD)' })
  @IsDateString()
  salaryMonth: string;
}
