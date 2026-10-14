import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsDateString,
  IsUUID,
} from 'class-validator';

export class CreateManualEmployeeDto {
  @IsString()
  @IsNotEmpty()
  storeId: string;

  @IsString()
  @IsNotEmpty()
  fullName: string;

  @IsString()
  @IsOptional()
  avatar?: string;

  @IsString()
  @IsOptional()
  gender?: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsDateString()
  @IsNotEmpty()
  birthday: string;

  @IsString()
  @IsOptional()
  maritalStatus?: string;

  @IsString()
  @IsOptional()
  address?: string;

  // Bank info
  @IsString()
  @IsOptional()
  bankName?: string;

  @IsString()
  @IsOptional()
  bankNumber?: string;

  // Identity document
  @IsString()
  @IsOptional()
  documentNumber?: string;

  @IsString()
  @IsOptional()
  frontImageUrl?: string;

  @IsString()
  @IsOptional()
  backImageUrl?: string;

  // Employee profile
  @IsString()
  @IsOptional()
  storeRoleId?: string;

  /** Lộ trình v2: bộ phận khi chưa xếp vị trí (xem EmployeeWorkAssignmentDto). */
  @IsUUID()
  @IsOptional()
  departmentId?: string;

  @IsString()
  @IsOptional()
  employeeTypeId?: string;

  @IsString()
  @IsOptional()
  workShiftId?: string;

  @IsString()
  @IsOptional()
  skillId?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsOptional()
  assetIds?: string[];

  @IsOptional()
  contract?: any;
}
