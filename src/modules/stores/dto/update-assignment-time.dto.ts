import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Giờ làm riêng của một nhân viên trong một ca (chủ sửa ở Lịch làm). */
export class UpdateAssignmentTimeDto {
  @ApiProperty({ example: '08:00', description: 'Giờ bắt đầu (HH:mm, giờ VN)' })
  @Matches(TIME_PATTERN, { message: 'Giờ bắt đầu phải có dạng HH:mm' })
  startTime: string;

  @ApiProperty({
    example: '12:00',
    description: 'Giờ kết thúc (HH:mm). Nhỏ hơn giờ bắt đầu = qua đêm.',
  })
  @Matches(TIME_PATTERN, { message: 'Giờ kết thúc phải có dạng HH:mm' })
  endTime: string;

  /**
   * Dời ca sang ngày khác (YYYY-MM-DD, giờ VN). Bỏ trống = giữ ngày cũ, nên bản
   * app cũ (chỉ gửi giờ) vẫn chạy như trước.
   */
  @ApiPropertyOptional({
    example: '2026-05-01',
    description: 'Ngày làm mới (YYYY-MM-DD, giờ VN). Bỏ trống = giữ ngày cũ.',
  })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'Ngày làm phải có dạng YYYY-MM-DD' })
  workDate?: string;

  /**
   * Ghi chú ca. Bỏ trống (undefined) = giữ ghi chú cũ; chuỗi rỗng = xoá ghi chú.
   * Cắt khoảng trắng hai đầu trước khi kiểm độ dài.
   */
  @ApiPropertyOptional({
    example: 'Nhớ mang đồng phục',
    description: 'Ghi chú ca (tối đa 200 ký tự). Chuỗi rỗng = xoá ghi chú.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: 'Ghi chú không hợp lệ' })
  @MaxLength(200, { message: 'Ghi chú tối đa 200 ký tự' })
  note?: string;
}
