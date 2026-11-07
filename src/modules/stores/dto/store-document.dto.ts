import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { StoreDocumentKind } from '../entities/store-document.entity';

/** Trường mảng gửi trong multipart là chuỗi JSON. */
const parseJsonArray = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const emptyToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class SaveStoreDocumentDto {
  @ApiProperty({ example: 'Nội quy làm việc tại cửa hàng' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ enum: StoreDocumentKind })
  @IsEnum(StoreDocumentKind)
  kind: StoreDocumentKind;

  @ApiPropertyOptional({ description: 'Văn bản có đánh dấu nhẹ' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  content?: string;

  @ApiProperty({ example: '2026-11-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validFrom: string;

  @ApiPropertyOptional({ example: '2026-12-31', description: 'Bỏ trống = còn hiệu lực' })
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validTo?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Rỗng = tất cả nhân viên' })
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'URL các tệp cũ muốn giữ; bỏ trường = giữ hết' })
  @IsOptional()
  @Transform(parseJsonArray)
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  existingFileUrls?: string[];

  @ApiPropertyOptional({ description: 'Nhân bản: tệp cũ lấy từ bài này' })
  @IsOptional()
  @IsUUID('4')
  sourceDocumentId?: string;

  @ApiPropertyOptional({ description: 'Chống tạo trùng khi gửi lại' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRequestId?: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'string', format: 'binary' } })
  @IsOptional()
  files?: unknown[];
}

export class SetStoreDocumentStoppedDto {
  @ApiProperty()
  @IsBoolean()
  stopped: boolean;
}

export class ReportStoreDocumentViewDto {
  @ApiProperty({ description: 'Số màn hình đã xem' })
  @IsInt()
  @Min(1)
  @Max(1000)
  viewedParts: number;

  @ApiProperty({ description: 'Tổng số màn hình của bài trên máy này' })
  @IsInt()
  @Min(1)
  @Max(1000)
  totalParts: number;

  @ApiProperty({ description: 'Bản nội dung đang xem' })
  @IsInt()
  @Min(1)
  revision: number;
}
