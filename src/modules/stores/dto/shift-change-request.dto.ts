import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShiftChangeRequestStatus } from '../entities/shift-change-request.entity';

export class CreateShiftChangeRequestDto {
  @ApiProperty()
  @IsUUID()
  storeId: string;

  @ApiProperty()
  @IsUUID()
  employeeProfileId: string;

  // Older staff clients use assignment IDs while newer flows can use slot IDs.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  currentShiftId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  requestedShiftId?: string;

  @ApiProperty({ example: '2026-08-25' })
  @IsDateString()
  requestDate: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  attachments?: string[];
}

export class ReviewShiftChangeRequestDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ListShiftChangeRequestsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeProfileId?: string;

  @ApiPropertyOptional({ enum: ShiftChangeRequestStatus })
  @IsOptional()
  @IsEnum(ShiftChangeRequestStatus)
  status?: ShiftChangeRequestStatus;

  @ApiPropertyOptional({ example: '2026-08-01', description: 'Legacy inclusive request-date lower bound' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'Legacy inclusive request-date upper bound' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Optional, enables paginated response' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, description: 'Optional, enables paginated response' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}
