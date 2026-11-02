import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';

/**
 * Ảnh đại diện nhóm chat: giữ trong bộ nhớ, chỉ ghi ra `./uploads` sau khi đã
 * kiểm quyền admin nhóm và nhận ra đúng là ảnh (xem `detectImageExtension`).
 */
export const groupAvatarMulterConfig = {
  storage: memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    parts: 4,
  },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(
        new BadRequestException('Ảnh nhóm phải là JPG, PNG hoặc WEBP'),
        false,
      );
    }
    callback(null, true);
  },
};

/**
 * Đuôi tệp theo vài byte đầu (không tin tên tệp / content-type client gửi);
 * null khi không phải JPG / PNG / WEBP.
 */
export const detectImageExtension = (buffer: Buffer): string | null => {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return '.jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return '.png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return '.webp';
  }
  return null;
};

/** Thư mục riêng của ảnh nhóm: chỉ tệp trong đây mới được xoá khi đổi ảnh. */
export const GROUP_AVATAR_DIR = './uploads/group-avatars';
/** Đường dẫn công khai tương ứng (ServeStaticModule phục vụ `./uploads`). */
export const GROUP_AVATAR_URL_PREFIX = '/uploads/group-avatars/';
/** Tên tệp do route ảnh nhóm tạo ra (uuid + đuôi ảnh). */
export const GROUP_AVATAR_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

const corrupt = () => new Error('IMAGE_CORRUPT');

/** Hướng xoay (tag 0x0112) trong khối EXIF của JPEG; null khi không có. */
function jpegExifOrientation(segment: Buffer): number | null {
  // segment = dữ liệu APP1 sau 2 byte độ dài: "Exif\0\0" + TIFF.
  if (segment.length < 14 || segment.subarray(0, 6).toString('binary') !== 'Exif\0\0') {
    return null;
  }
  const tiff = segment.subarray(6);
  const order = tiff.subarray(0, 2).toString('ascii');
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (offset: number) => (le ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset: number) => (le ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return null;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** Khối APP1 EXIF tối thiểu chỉ mang hướng xoay (big-endian). */
function minimalOrientationApp1(orientation: number): Buffer {
  const body = Buffer.alloc(32);
  body.write('Exif\0\0', 0, 'binary');
  body.write('MM', 6, 'ascii');
  body.writeUInt16BE(42, 8);
  body.writeUInt32BE(8, 10); // IFD0 ngay sau header TIFF
  body.writeUInt16BE(1, 14); // 1 mục
  body.writeUInt16BE(0x0112, 16); // Orientation
  body.writeUInt16BE(3, 18); // SHORT
  body.writeUInt32BE(1, 20);
  body.writeUInt16BE(orientation, 24);
  body.writeUInt32BE(0, 28); // không có IFD tiếp
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([header, body]);
}

/**
 * JPEG: bỏ APP1 (EXIF — có GPS — và XMP), APP13 (IPTC) và COM; giữ phần còn
 * lại (JFIF, ICC, bảng lượng tử…) và dữ liệu ảnh. Ảnh có hướng xoay khác 1
 * được trả lại một khối EXIF chỉ chứa hướng xoay, để không hiện nghiêng.
 */
function stripJpeg(input: Buffer): Buffer {
  if (input[0] !== 0xff || input[1] !== 0xd8) throw corrupt();
  const kept: Buffer[] = [];
  let orientation: number | null = null;
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== 0xff) throw corrupt();
    let markerAt = offset;
    while (input[markerAt + 1] === 0xff) markerAt += 1; // byte đệm
    const marker = input[markerAt + 1];
    if (marker === undefined) throw corrupt();
    if (marker === 0xd9) {
      kept.push(input.subarray(markerAt, markerAt + 2));
      offset = markerAt + 2;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(input.subarray(markerAt, markerAt + 2));
      offset = markerAt + 2;
      continue;
    }
    if (markerAt + 4 > input.length) throw corrupt();
    const length = input.readUInt16BE(markerAt + 2);
    const end = markerAt + 2 + length;
    if (length < 2 || end > input.length) throw corrupt();
    if (marker === 0xda) {
      // Bắt đầu dữ liệu ảnh: giữ nguyên tới hết tệp.
      kept.push(input.subarray(markerAt));
      offset = input.length;
      break;
    }
    if (marker === 0xe1) {
      orientation ??= jpegExifOrientation(input.subarray(markerAt + 4, end));
    } else if (marker !== 0xed && marker !== 0xfe) {
      kept.push(input.subarray(markerAt, end));
    }
    offset = end;
  }
  const head: Buffer[] = [input.subarray(0, 2)];
  if (orientation && orientation !== 1) {
    // JFIF (APP0) phải đứng ngay sau SOI; EXIF đặt sau nó.
    const jfifFirst = kept[0]?.[1] === 0xe0;
    if (jfifFirst) head.push(kept.shift()!);
    head.push(minimalOrientationApp1(orientation));
  }
  return Buffer.concat([...head, ...kept]);
}

const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

/** PNG: bỏ các chunk metadata (EXIF, chữ, thời gian); ảnh giữ nguyên. */
function stripPng(input: Buffer): Buffer {
  const kept: Buffer[] = [input.subarray(0, 8)];
  let offset = 8;
  while (offset < input.length) {
    if (offset + 12 > input.length) throw corrupt();
    const length = input.readUInt32BE(offset);
    const type = input.subarray(offset + 4, offset + 8).toString('ascii');
    const end = offset + 12 + length;
    if (end > input.length) throw corrupt();
    if (!PNG_METADATA_CHUNKS.has(type)) kept.push(input.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(kept);
}

/** WEBP: bỏ chunk EXIF / XMP và tắt cờ tương ứng trong VP8X. */
function stripWebp(input: Buffer): Buffer {
  const kept: Buffer[] = [];
  let offset = 12;
  while (offset < input.length) {
    if (offset + 8 > input.length) throw corrupt();
    const fourcc = input.subarray(offset, offset + 4).toString('ascii');
    const size = input.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > input.length) throw corrupt();
    const chunk = Buffer.from(input.subarray(offset, Math.min(end, input.length)));
    if (fourcc === 'VP8X' && size >= 1) chunk[8] &= ~(0x08 | 0x04);
    if (fourcc !== 'EXIF' && fourcc !== 'XMP ') kept.push(chunk);
    offset = end;
  }
  const body = Buffer.concat(kept);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

/**
 * Bỏ metadata (EXIF có toạ độ GPS, XMP, IPTC, chữ chú thích) khỏi ảnh nhóm
 * trước khi công khai ở `/uploads`. Ném lỗi khi cấu trúc tệp hỏng.
 */
export function stripImageMetadata(image: Buffer, extension: string): Buffer {
  if (extension === '.jpg') return stripJpeg(image);
  if (extension === '.png') return stripPng(image);
  if (extension === '.webp') return stripWebp(image);
  throw corrupt();
}
