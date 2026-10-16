
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsArray, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PayrollCalculationMethod } from '../entities/store-payroll-setting.entity';
import {
  PayrollCalcType,
  PayrollRuleCalcMode,
  PayrollRuleCategory,
  PayrollRuleCode,
} from '../entities/store-payroll-rule.entity';
import { IncrementRuleType } from '../entities/store-payroll-increment-rule.entity';

// I put some enums in different files. Let's move them to a central place or just redo imports.
// Actually, I put PayrollCalculationMethod in store-payroll-setting.entity.ts. 
// I put PayrollRuleCategory and PayrollCalcType in store-payroll-rule.entity.ts.
// I put IncrementRuleType in store-payroll-increment-rule.entity.ts.

export class PayrollRuleDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() id?: string;
  @ApiProperty() @IsString() @MaxLength(255) name: string;
  @ApiProperty() @IsString() ruleType: string;
  @ApiProperty({ enum: ['amount', 'percentage', 'shift'] }) @IsEnum(['amount', 'percentage', 'shift']) calcType: string;
  @ApiProperty() @IsNumber() @Min(0) value: number;
  // v2 (Thiết lập tính lương mới); chỉ đọc khi body có rulesVersion = 2.
  @ApiProperty({ required: false, enum: PayrollRuleCode }) @IsOptional() @IsIn(Object.values(PayrollRuleCode)) code?: string;
  @ApiProperty({ required: false, enum: PayrollRuleCalcMode }) @IsOptional() @IsIn(Object.values(PayrollRuleCalcMode)) calcMode?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsNumber() @Min(0) @Max(100000) threshold?: number;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(300) description?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class IncrementRuleDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString() id?: string;
  @ApiProperty({ enum: ['periodic', 'seniority'] }) @IsEnum(['periodic', 'seniority']) type: string;
  @ApiProperty() @IsString() conditionType: string;
  @ApiProperty() @IsString() conditionValue: string;
  @ApiProperty({ enum: ['amount', 'percentage', 'shift'] }) @IsEnum(['amount', 'percentage', 'shift']) calcType: string;
  @ApiProperty() @IsNumber() value: number;
}

export class RolePayrollDto {
  @ApiProperty() @IsString() id: string;
  @ApiProperty() @IsString() name: string;
  @ApiProperty() @IsNumber() coefficient: number;
  @ApiProperty() @IsNumber() allowance: number;
}

export class UpdatePayrollSettingDto {
  /**
   * 2 = app gửi đủ danh sách khoản thưởng / vi phạm v2 (cả khoản đang tắt).
   * Bỏ trống = app cũ: chỉ đụng tới khoản cũ đang bật, không bao giờ xoá khoản
   * v2 hay khoản đang tắt mà app cũ không nhìn thấy.
   */
  @ApiProperty({ required: false }) @IsOptional() @IsIn([2]) rulesVersion?: number;

  @ApiProperty({ enum: ['hour', 'shift', 'day', 'month', 'flexible'] }) @IsOptional() @IsString() calculationMethod?: string;
  @ApiProperty() @IsOptional() @IsString() priorityCalcType?: string;
  @ApiProperty() @IsOptional() @IsNumber() priorityCalcValue?: number;
  @ApiProperty() @IsOptional() @IsString() alternativeCalcType?: string;
  @ApiProperty() @IsOptional() @IsNumber() alternativeCalcValue?: number;

  @ApiProperty({ type: [PayrollRuleDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayrollRuleDto) bonuses?: PayrollRuleDto[];
  @ApiProperty({ type: [PayrollRuleDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayrollRuleDto) fines?: PayrollRuleDto[];
  @ApiProperty({ type: [PayrollRuleDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PayrollRuleDto) benefits?: PayrollRuleDto[];
  @ApiProperty({ type: [IncrementRuleDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => IncrementRuleDto) incrementRules?: IncrementRuleDto[];
  @ApiProperty({ type: [RolePayrollDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RolePayrollDto) roles?: RolePayrollDto[];
}
