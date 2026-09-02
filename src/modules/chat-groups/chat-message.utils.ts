import { BadRequestException } from '@nestjs/common';

const MAX_MESSAGE_CODE_POINTS = 4_000;
const MAX_GROUP_NAME_CODE_POINTS = 120;
const MAX_INT64 = 9_223_372_036_854_775_807n;

export const canonicalizeChatContent = (content: string): string =>
  content.replace(/\r\n?/g, '\n').normalize('NFC').trim();

export const validateChatContent = (content: string): string => {
  const canonical = canonicalizeChatContent(content);
  const length = Array.from(canonical).length;

  if (length < 1 || length > MAX_MESSAGE_CODE_POINTS) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'CHAT_CONTENT_INVALID',
      message: 'Nội dung tin nhắn phải có từ 1 đến 4000 ký tự',
    });
  }

  return canonical;
};

export const validateChatGroupName = (name: string): string => {
  const canonical = name.normalize('NFC').trim();
  const length = Array.from(canonical).length;

  if (length < 1 || length > MAX_GROUP_NAME_CODE_POINTS) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'CHAT_GROUP_NAME_INVALID',
      message: 'Tên nhóm phải có từ 1 đến 120 ký tự',
    });
  }

  return canonical;
};

export const parseChatSequence = (
  value: string,
  field: string,
  allowZero: boolean,
): bigint => {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new BadRequestException(`${field} không hợp lệ`);
  }

  const parsed = BigInt(value);
  if ((!allowZero && parsed === 0n) || parsed > MAX_INT64) {
    throw new BadRequestException(`${field} không hợp lệ`);
  }
  return parsed;
};

export const escapeIlikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, (character) => `\\${character}`);

export const compareSequence = (left: string, right: string): number => {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};
