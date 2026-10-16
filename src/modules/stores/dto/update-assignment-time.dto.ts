import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
}
