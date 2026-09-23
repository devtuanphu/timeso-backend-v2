import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentType } from '../entities/employee-contract.entity';

export class ExistingEmployeeCandidateQueryDto {
  @IsString()
  phone: string;
}

export class ContractTermDto {
  @IsString()
  title: string;

  @IsString()
  content: string;
}

export class ExistingEmployeeContractDto {
  @IsOptional()
  @IsString()
  contractName?: string;

  @IsOptional()
  @IsString()
  jobDescription?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  /** 0 = "Không hợp đồng" (no labor contract; the pay rate still applies). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1200)
  durationMonths?: number;

  /**
   * True: the employee works without a labor contract ("Không hợp đồng"). The
   * row is still created to carry the pay rate. Sending
   * `contractName: 'Không hợp đồng'` has the same effect and is also accepted
   * by older backends.
   */
  @IsOptional()
  @IsBoolean()
  noLaborContract?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weeklyWorkingHours?: number;

  @IsOptional()
  @IsString()
  probationPeriod?: string;

  @IsOptional()
  @IsEnum(PaymentType)
  paymentType?: PaymentType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  salaryAmount?: number;

  @IsOptional()
  @IsObject()
  allowances?: Record<string, number>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContractTermDto)
  terms?: ContractTermDto[];

  @IsOptional()
  @IsString()
  contractFileUrl?: string;
}

export class EmployeeWorkAssignmentDto {
  @IsOptional()
  @IsUUID()
  storeRoleId?: string;

  @IsOptional()
  @IsUUID()
  employeeTypeId?: string;

  @IsOptional()
  @IsUUID()
  workShiftId?: string;

  @IsOptional()
  @IsUUID()
  skillId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  assetIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ExistingEmployeeContractDto)
  contract?: ExistingEmployeeContractDto;
}

export class AddExistingEmployeeDto extends EmployeeWorkAssignmentDto {
  @IsString()
  phone: string;
}

export class LinkExistingEmployeeDto extends EmployeeWorkAssignmentDto {
  @IsUUID()
  accountId: string;
}
