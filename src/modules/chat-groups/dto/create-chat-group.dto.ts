import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsOptional,
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChatGroupDto {
  @ApiProperty({ description: 'Tên nhóm chat' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'ID cửa hàng' })
  @IsUUID()
  storeId: string;

  @ApiPropertyOptional({
    description: 'Quyền gửi tin nhắn',
    enum: ['everyone', 'custom', 'admin_only'],
  })
  @IsEnum(['everyone', 'custom', 'admin_only'])
  @IsOptional()
  messagePermission?: string;

  @ApiPropertyOptional({ description: 'Danh sách ID người được gửi tin (nếu custom)' })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  @IsOptional()
  customSenderIds?: string[];

  @ApiProperty({ description: 'Danh sách ID thành viên' })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  memberIds: string[];
}
