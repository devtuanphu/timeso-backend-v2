import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const NOT_BLANK = /\S/;

export class StageChecklistItemDto {
  /** Mục đang có của giai đoạn — giữ id để không đổi danh tính khi chỉ sửa chữ. */
  @IsOptional()
  @IsUUID()
  id?: string | null;

  @IsString()
  @MaxLength(200)
  @Matches(NOT_BLANK, { message: 'Tiêu chí đánh giá chưa có nội dung' })
  label: string;
}

/**
 * Một giai đoạn nhân sự (Học việc, Thử việc…) cùng điều kiện để qua nó.
 * Lưu một lần, trong một transaction: tên/mô tả, giai đoạn trước/sau, điều
 * kiện chuyển, tiêu chí đánh giá và người duyệt.
 */
export class SaveStageDto {
  @IsString()
  @MaxLength(100)
  @Matches(NOT_BLANK, { message: 'Nhập tên giai đoạn' })
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string | null;

  /** Giai đoạn đi tới giai đoạn này. Rỗng = giai đoạn bắt đầu. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  previousRungIds?: string[];

  /** Giai đoạn kế tiếp (có thể rẽ nhánh). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  nextRungIds?: string[];

  /** Thời gian tối thiểu ở giai đoạn (ngày); 0 / null = không yêu cầu. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  minDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  minShifts?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100000)
  minHours?: number | null;

  /** Tiêu chí chủ chấm tay, theo thứ tự hiển thị. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StageChecklistItemDto)
  checklist?: StageChecklistItemDto[];

  /** Người duyệt kết quả; rỗng / null = chủ cửa hàng. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  reviewerProfileIds?: string[] | null;
}

export class ReorderStagesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  rungIds: string[];
}
