import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';

export const CHAT_ACCESS_DENIED = 'CHAT_ACCESS_DENIED';
export const CHAT_IDEMPOTENCY_CONFLICT = 'CHAT_IDEMPOTENCY_CONFLICT';
export const CHAT_NOT_READY = 'CHAT_NOT_READY';
export const CHAT_UPGRADE_REQUIRED = 'CHAT_UPGRADE_REQUIRED';
export const CHAT_DIRECT_IMMUTABLE = 'CHAT_DIRECT_IMMUTABLE';
export const CHAT_DIRECT_INVALID_TARGET = 'CHAT_DIRECT_INVALID_TARGET';

export const chatAccessDenied = (): ForbiddenException =>
  new ForbiddenException({
    statusCode: 403,
    code: CHAT_ACCESS_DENIED,
    message: 'Bạn không có quyền truy cập cuộc trò chuyện này',
  });

export const chatIdempotencyConflict = (): ConflictException =>
  new ConflictException({
    statusCode: 409,
    code: CHAT_IDEMPOTENCY_CONFLICT,
    message: 'Mã gửi tin đã được sử dụng cho nội dung khác',
  });

export const chatNotReady = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    statusCode: 503,
    code: CHAT_NOT_READY,
    message: 'Dịch vụ trò chuyện tạm thời chưa sẵn sàng',
  });


/** Chat riêng 1-1 luôn đúng hai người: không đổi tên/quyền, thêm, xoá hay rời. */
export const directChatImmutable = (): BadRequestException =>
  new BadRequestException({
    statusCode: 400,
    code: CHAT_DIRECT_IMMUTABLE,
    message: 'Không thể thay đổi chat riêng',
  });

export const directChatInvalidTarget = (): BadRequestException =>
  new BadRequestException({
    statusCode: 400,
    code: CHAT_DIRECT_INVALID_TARGET,
    message: 'Không thể mở chat riêng với người này',
  });
