import { ApiProperty } from '@nestjs/swagger';
import { VerifiedStatus } from '../entities/account-identity-document.entity';
import { AccountStatus } from '../entities/account.entity';

export class IdentityResponseDto {
  @ApiProperty({ example: 'uuid-identity' })
  id: string;

  @ApiProperty({ example: 'CCCD' })
  docType: string;

  @ApiProperty({ example: '012345678912' })
  documentNumber: string;

  @ApiProperty({ example: '/uploads/front.jpg' })
  frontImageUrl: string;

  @ApiProperty({ example: '/uploads/back.jpg' })
  backImageUrl: string;

  @ApiProperty({ enum: VerifiedStatus, example: VerifiedStatus.VERIFIED })
  verifiedStatus: VerifiedStatus;
}

export class FinanceResponseDto {
  @ApiProperty({ example: 'Vietcombank' })
  bankName: string;

  @ApiProperty({ example: '1234567890' })
  bankNumber: string;

  @ApiProperty({ example: '123456789' })
  taxCode: string;

  @ApiProperty()
  updatedAt: Date;
}

export class AccountResponseDto {
  @ApiProperty({ example: 'uuid-account' })
  id: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  fullName: string;

  @ApiProperty({ example: 'Nam' })
  gender: string;

  @ApiProperty({ example: '/uploads/avatar.jpg', nullable: true })
  avatar: string;

  @ApiProperty({ example: '1990-01-01' })
  birthday: Date;

  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: '0901234567' })
  phone: string;

  @ApiProperty({ example: true, default: true })
  isInnovationPioneer: boolean;

  @ApiProperty({ example: 'Ha Noi' })
  address: string;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ type: IdentityResponseDto })
  identityDocument: IdentityResponseDto;

  @ApiProperty({ type: FinanceResponseDto })
  finance: FinanceResponseDto;
}
