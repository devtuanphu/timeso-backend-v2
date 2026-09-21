import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StopWorkCycleDto {
  @ApiPropertyOptional({
    description:
      'Dừng ngay lập tức. Mặc định là true. Nếu false, cần truyền scheduledStopAt.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  stopImmediately?: boolean;

  @ApiPropertyOptional({
    description:
      'Ngày đầu tiên không còn ca (YYYY-MM-DD); chu kỳ dừng lúc 00:00 giờ Việt Nam ngày đó. ' +
      'Chấp nhận cả thời điểm ISO đầy đủ. Chỉ dùng khi stopImmediately = false.',
    example: '2026-02-15',
  })
  @IsOptional()
  @IsString()
  scheduledStopAt?: string;

  /** @deprecated Released owner builds: 'immediate' | 'scheduled'. */
  @ApiPropertyOptional({
    deprecated: true,
    enum: ['immediate', 'scheduled'],
  })
  @IsOptional()
  @IsIn(['immediate', 'scheduled'])
  stopType?: 'immediate' | 'scheduled';

  /**
   * @deprecated Released owner builds: the last working day (YYYY-MM-DD).
   * The cycle stops at 00:00 Vietnam time the day after.
   */
  @ApiPropertyOptional({ deprecated: true, example: '2026-02-14' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  stopDate?: string;
}
