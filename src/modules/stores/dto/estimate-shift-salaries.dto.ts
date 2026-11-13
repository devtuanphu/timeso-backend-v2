import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Same shape as ShiftDraftDto's time pattern ("24:00" is rejected; midnight is
// sent as "00:00"), so the estimate accepts exactly what the create endpoint does.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A proposed (not yet persisted) shift the owner app wants a salary quote for. */
export class EstimateShiftDto {
  @ApiProperty({
    maxLength: 64,
    description:
      'Opaque client-side id echoed back so the app can match each quote to its draft row.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  clientId: string;

  @ApiProperty({ example: '2026-11-12' })
  @Matches(DATE_PATTERN)
  date: string;

  @ApiProperty({ example: '07:00' })
  @Matches(TIME_PATTERN)
  startTime: string;

  @ApiProperty({ example: '11:00' })
  @Matches(TIME_PATTERN)
  endTime: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  employeeIds: string[];
}

export class EstimateShiftSalariesDto {
  @ApiProperty({ type: [EstimateShiftDto], minItems: 1, maxItems: 200 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => EstimateShiftDto)
  shifts: EstimateShiftDto[];
}
