import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class StoreDiscoveryQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 20;
}

export interface StoreDiscoveryItemDto {
  id: string;
  name: string;
  displayAddress: string;
  avatarUrl: string | null;
}

export interface StoreDiscoveryPageDto {
  items: StoreDiscoveryItemDto[];
  page: number;
  limit: number;
  hasMore: boolean;
}

