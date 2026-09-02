import {
  ArrayMaxSize,
  ArrayUnique,
  IsString,
  IsOptional,
  IsEnum,
  IsArray,
  IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateChatGroupDto {
  @ApiPropertyOptional({ description: 'Tên nhóm chat' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Avatar nhóm' })
  @IsString()
  @IsOptional()
  avatar?: string;

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
}
