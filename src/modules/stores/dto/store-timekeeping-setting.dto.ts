import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Store-location radius bounds. The column and the check-in rule
 * (attendance-enforcement.ts) existed, but this DTO never accepted the field,
 * so the owner's "Vị trí cửa hàng" radius was never saved.
 */
export const ATTENDANCE_RADIUS_MIN = 10;
export const ATTENDANCE_RADIUS_MAX = 5000;

/**
 * Bounds of the minute rules applied at check-in/out (attendance-rules.ts).
 * 0 is allowed: builds of the owner app already installed save an emptied
 * field as 0.
 */
export const ALLOWED_LATE_MINUTES_MAX = 120;
export const ATTENDANCE_WINDOW_MINUTES_MAX = 240;

const ALLOWED_LATE_MESSAGE = `Thời gian cho phép đi muộn/về sớm phải là số phút nguyên từ 0 đến ${ALLOWED_LATE_MINUTES_MAX}.`;
const EARLY_CHECKIN_MESSAGE = `Thời gian check-in trước giờ làm phải là số phút nguyên từ 0 đến ${ATTENDANCE_WINDOW_MINUTES_MAX}.`;
const LATE_CHECKOUT_MESSAGE = `Thời gian check-out sau giờ làm phải là số phút nguyên từ 0 đến ${ATTENDANCE_WINDOW_MINUTES_MAX}.`;

export class StoreTimekeepingSettingDto {
  @ApiProperty({ description: 'Bật ca linh hoạt', example: false })
  @IsBoolean()
  @IsOptional()
  enableFlexibleShift?: boolean;

  @ApiProperty({ description: 'Bắt buộc có vị trí khi chấm công', example: true })
  @IsBoolean()
  @IsOptional()
  requireLocation?: boolean;

  @ApiProperty({
    description: 'Bán kính chấm công tối đa tính từ vị trí cửa hàng (mét)',
    example: 50,
    minimum: ATTENDANCE_RADIUS_MIN,
    maximum: ATTENDANCE_RADIUS_MAX,
  })
  @IsInt()
  @Min(ATTENDANCE_RADIUS_MIN)
  @Max(ATTENDANCE_RADIUS_MAX)
  @IsOptional()
  attendanceRadius?: number;

  @ApiProperty({ description: 'Bắt buộc quét QR cửa hàng khi chấm công', example: true })
  @IsBoolean()
  @IsOptional()
  requireQrScan?: boolean;

  @ApiProperty({ description: 'Danh sách ID nhân viên miễn trừ yêu cầu vị trí', example: [] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  locationExceptionEmployeeIds?: string[];

  @ApiProperty({
    description:
      'Đi muộn/về sớm trong số phút này được tính là đúng giờ (không ghi muộn/sớm, không phạt)',
    example: 15,
    minimum: 0,
    maximum: ALLOWED_LATE_MINUTES_MAX,
  })
  @IsInt({ message: ALLOWED_LATE_MESSAGE })
  @Min(0, { message: ALLOWED_LATE_MESSAGE })
  @Max(ALLOWED_LATE_MINUTES_MAX, { message: ALLOWED_LATE_MESSAGE })
  @IsOptional()
  allowedLateMinutes?: number;

  @ApiProperty({ description: 'Trừ giờ công nếu vượt quá', example: true })
  @IsBoolean()
  @IsOptional()
  deductWorkTimeIfLate?: boolean;

  @ApiProperty({ description: 'Hiển thị cảnh báo đi muộn', example: true })
  @IsBoolean()
  @IsOptional()
  showLateAlert?: boolean;

  @ApiProperty({ description: 'Tính đủ công dù đi muộn/về sớm', example: false })
  @IsBoolean()
  @IsOptional()
  countFullTimeIfLate?: boolean;

  @ApiProperty({
    description: 'Check-in mở trước giờ vào ca bao nhiêu phút',
    example: 15,
    minimum: 0,
    maximum: ATTENDANCE_WINDOW_MINUTES_MAX,
  })
  @IsInt({ message: EARLY_CHECKIN_MESSAGE })
  @Min(0, { message: EARLY_CHECKIN_MESSAGE })
  @Max(ATTENDANCE_WINDOW_MINUTES_MAX, { message: EARLY_CHECKIN_MESSAGE })
  @IsOptional()
  earlyCheckinMinutes?: number;

  @ApiProperty({
    description:
      'Sau giờ kết thúc ca bao nhiêu phút thì hệ thống tự check-out (quên check-out)',
    example: 15,
    minimum: 0,
    maximum: ATTENDANCE_WINDOW_MINUTES_MAX,
  })
  @IsInt({ message: LATE_CHECKOUT_MESSAGE })
  @Min(0, { message: LATE_CHECKOUT_MESSAGE })
  @Max(ATTENDANCE_WINDOW_MINUTES_MAX, { message: LATE_CHECKOUT_MESSAGE })
  @IsOptional()
  lateCheckoutMinutes?: number;

  @ApiProperty({ description: 'Bật tính lương phụ trội làm thêm giờ', example: false })
  @IsBoolean()
  @IsOptional()
  enableOvertimeMultiplier?: boolean;

  @ApiProperty({
    description: 'Hệ số lương làm thêm giờ (chưa áp dụng vào bảng lương)',
    example: 1.5,
    minimum: 0,
  })
  // No upper bound: not applied yet and read-only in the owner app, so an
  // old stored value must never block saving the other settings.
  @IsNumber()
  @Min(0)
  @IsOptional()
  overtimeMultiplier?: number;

  @ApiProperty({ description: 'Nhắc nhở khi gần trễ ca', example: false })
  @IsBoolean()
  @IsOptional()
  notifyLateShift?: boolean;

  @ApiProperty({ description: 'Danh sách ca làm việc' })
  @IsOptional()
  shifts?: any[]; // StoreWorkShiftDto[] - Define properly if possible, or use any for now
}

export class StoreWorkShiftDto {
  @ApiProperty() @IsString() @IsOptional() id?: string;
  @ApiProperty() @IsString() @IsOptional() shiftName: string;
  @ApiProperty() @IsString() @IsOptional() startTime: string;
  @ApiProperty() @IsString() @IsOptional() endTime: string;
  @ApiProperty() @IsBoolean() @IsOptional() isActive: boolean;
}

