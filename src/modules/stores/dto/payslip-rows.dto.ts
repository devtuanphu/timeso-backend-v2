import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PayslipRowSign } from '../entities/store-payslip-row.entity';

/** A built-in payslip row (Phụ cấp / Thưởng / Khấu trừ): renamed or removed. */
export class PayslipBuiltinRowDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  removed?: boolean;
}

export class PayslipBuiltinRowsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PayslipBuiltinRowDto)
  ALLOWANCE?: PayslipBuiltinRowDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayslipBuiltinRowDto)
  BONUS?: PayslipBuiltinRowDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PayslipBuiltinRowDto)
  DEDUCTION?: PayslipBuiltinRowDto;
}

/** An extra line: added to the income (PLUS) or taken from the net (MINUS). */
export class PayslipExtraItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/\S/, { message: 'Tên hàng không được để trống' })
  label: string;

  @IsEnum(PayslipRowSign)
  sign: PayslipRowSign;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  amount: number;
}

export class SavePayslipRowsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PayslipBuiltinRowsDto)
  builtins?: PayslipBuiltinRowsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PayslipExtraItemDto)
  items?: PayslipExtraItemDto[];
}
