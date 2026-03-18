import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  MinLength,
} from 'class-validator';

export enum Gender {
  MALE = 'Nam',
  FEMALE = 'Nữ',
  OTHER = 'Khác',
}

export class RegisterDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsEnum(Gender, { message: 'Giới tính không hợp lệ' })
  @IsOptional()
  gender?: Gender;

  @IsDateString({}, { message: 'Ngày sinh không đúng định dạng' })
  @IsOptional()
  birthday?: string;

  @IsEmail({}, { message: 'Email không hợp lệ' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  phone: string;

  @IsString()
  @MinLength(6, { message: 'Mật khẩu phải ít nhất 6 ký tự' })
  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  password: string;
}
