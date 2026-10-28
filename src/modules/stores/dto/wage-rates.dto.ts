import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Một đơn giá lương (luật áp dụng: wage-rates.utils.ts). */
export class WageRateDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string | null;

  @IsIn(['HOUR', 'SHIFT'])
  unit: 'HOUR' | 'SHIFT';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  workShiftIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('all', { each: true })
  roleIds?: string[];

  @IsOptional()
  @Matches(HH_MM, { message: 'Giờ bắt đầu khung giờ phải dạng HH:MM' })
  timeFrom?: string | null;

  @IsOptional()
  @Matches(HH_MM, { message: 'Giờ kết thúc khung giờ phải dạng HH:MM' })
  timeTo?: string | null;
}

/** Thay cả danh sách đơn giá của cửa hàng. */
export class SaveWageRatesDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WageRateDto)
  rates: WageRateDto[];
}
