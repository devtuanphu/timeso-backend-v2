import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
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

  /** Giai đoạn (loại nhân viên: Học việc, Thử việc…); null = bỏ chọn. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o) => o.employeeTypeId !== null && o.employeeTypeId !== undefined)
  @IsUUID()
  employeeTypeId?: string | null;

  /** Hình thức làm việc (Toàn thời gian, Bán thời gian…); null = bỏ chọn. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o) => o.workTypeId !== null && o.workTypeId !== undefined)
  @IsUUID()
  workTypeId?: string | null;

  /** Ca làm việc mặc định; null = bỏ chọn. */
  @ApiPropertyOptional({ nullable: true })
  @ValidateIf((o) => o.workShiftId !== null && o.workShiftId !== undefined)
  @IsUUID()
  workShiftId?: string | null;

  // --- Điều kiện làm việc (work-terms.utils.ts) --------------------------------

  /** Ngày chính thức vào làm (VN); trước ngày này không đăng ký / xếp ca được. null = bỏ. */
  @ApiPropertyOptional({ example: '2026-10-20', nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.officialStartDate !== null && o.officialStartDate !== undefined)
  @IsDateString({ strict: true }, { message: 'Ngày vào làm không hợp lệ' })
  officialStartDate?: string | null;

  /** Số ngày làm tối đa nhân viên tự đăng ký mỗi tuần (T2–CN); null = không giới hạn. */
  @ApiPropertyOptional({ minimum: 1, maximum: 7, nullable: true })
  @ValidateIf((o) => o.workDaysPerWeek !== null && o.workDaysPerWeek !== undefined)
  @IsInt({ message: 'Số ngày mỗi tuần phải là số nguyên' })
  @Min(1, { message: 'Số ngày mỗi tuần từ 1 đến 7' })
  @Max(7, { message: 'Số ngày mỗi tuần từ 1 đến 7' })
  workDaysPerWeek?: number | null;

  /** Số ngày làm tối đa nhân viên tự đăng ký mỗi tháng; null = không giới hạn. */
  @ApiPropertyOptional({ minimum: 1, maximum: 31, nullable: true })
  @ValidateIf((o) => o.workDaysPerMonth !== null && o.workDaysPerMonth !== undefined)
  @IsInt({ message: 'Số ngày mỗi tháng phải là số nguyên' })
  @Min(1, { message: 'Số ngày mỗi tháng từ 1 đến 31' })
  @Max(31, { message: 'Số ngày mỗi tháng từ 1 đến 31' })
  workDaysPerMonth?: number | null;

  /** Ngày nghỉ cố định hằng tuần: 0 = Chủ nhật … 6 = Thứ 7; [] = không có. */
  @ApiPropertyOptional({ type: [Number], example: [4, 5] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6, { message: 'Phải còn ít nhất một ngày làm trong tuần' })
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  fixedDaysOff?: number[];

  /** Ghi chú mong muốn của nhân viên — chỉ chủ xem; null / "" = xoá. */
  @ApiPropertyOptional({ nullable: true })
  @Transform(blankToNull)
  @ValidateIf((o) => o.ownerNote !== null && o.ownerNote !== undefined)
  @IsString()
  @MaxLength(1000, { message: 'Ghi chú tối đa 1000 ký tự' })
  ownerNote?: string | null;
}
