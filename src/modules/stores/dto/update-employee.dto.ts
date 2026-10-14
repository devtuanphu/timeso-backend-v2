import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** Chuỗi rỗng / toàn khoảng trắng → null ("xoá giá trị"); bỏ trường → giữ nguyên. */
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

export const EMPLOYEE_GENDERS = ['male', 'female', 'other'] as const;
export const EMPLOYEE_MARITAL_STATUSES = ['single', 'married', 'children'] as const;

/**
 * Chủ cửa hàng sửa thông tin một nhân viên (PATCH stores/employees/:profileId).
 *
 * Mọi trường đều tuỳ chọn: không gửi = giữ nguyên, gửi null / "" = xoá (trừ
 * họ tên). Số điện thoại cố ý không có: đó là tài khoản đăng nhập của nhân
 * viên. Ảnh đại diện / ảnh CCCD vẫn do nhân viên tự cập nhật.
 */
export class UpdateEmployeeByOwnerDto {
  // --- Tài khoản (dùng chung mọi cửa hàng nhân viên làm) -------------------

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Họ tên không được để trống' })
  @MaxLength(100)
  fullName?: string;

  @ApiPropertyOptional({ enum: EMPLOYEE_GENDERS })
  @IsOptional()
  @IsIn(EMPLOYEE_GENDERS)
  gender?: (typeof EMPLOYEE_GENDERS)[number];

  @ApiPropertyOptional({ example: '1999-01-31', nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.birthday !== null && o.birthday !== undefined)
  @IsDateString({ strict: true }, { message: 'Ngày sinh không hợp lệ' })
  birthday?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.email !== null && o.email !== undefined)
  @IsEmail({}, { message: 'Email không hợp lệ' })
  @MaxLength(255)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.address !== null && o.address !== undefined)
  @IsString()
  @MaxLength(255)
  address?: string | null;

  @ApiPropertyOptional({ enum: EMPLOYEE_MARITAL_STATUSES, nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.maritalStatus !== null && o.maritalStatus !== undefined)
  @IsIn(EMPLOYEE_MARITAL_STATUSES)
  maritalStatus?: (typeof EMPLOYEE_MARITAL_STATUSES)[number] | null;

  @ApiPropertyOptional({ description: 'Số CCCD / giấy tờ', nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.identityCardNumber !== null && o.identityCardNumber !== undefined)
  @Matches(/^[0-9A-Za-z]{6,20}$/, { message: 'Số CCCD chỉ gồm chữ / số, 6–20 ký tự' })
  identityCardNumber?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.bankName !== null && o.bankName !== undefined)
  @IsString()
  @MaxLength(100)
  bankName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.bankNumber !== null && o.bankNumber !== undefined)
  @Matches(/^[0-9]{4,30}$/, { message: 'Số tài khoản chỉ gồm chữ số' })
  bankNumber?: string | null;

  // --- Hồ sơ tại cửa hàng ------------------------------------------------------

  /** Hình thức làm việc (loại nhân viên); null = bỏ chọn. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o) => o.employeeTypeId !== null && o.employeeTypeId !== undefined)
  @IsUUID()
  employeeTypeId?: string | null;

  /** Ca làm việc mặc định; null = bỏ chọn. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o) => o.workShiftId !== null && o.workShiftId !== undefined)
  @IsUUID()
  workShiftId?: string | null;
}
