import { memoryStorage, diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';

export const multerConfig = {
  storage: diskStorage({
    destination: './uploads',
    filename: (req, file, callback) => {
      const uniqueSuffix = uuidv4();
      callback(null, `${uniqueSuffix}${extname(file.originalname)}`);
    },
  }),
  limits: {
    fieldSize: 100 * 1024 * 1024,
    fileSize: 100 * 1024 * 1024,
    parts: 100,
  },
  fileFilter: (req, file, callback) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|pdf|doc|docx)$/)) {
      return callback(
        new Error('Only image and document files are allowed!'),
        false,
      );
    }
    callback(null, true);
  },
};

/**
 * Identity documents (CCCD/ID scans) are sensitive personal data and must not
 * land in `./uploads`, which `ServeStaticModule` publishes at `/uploads` with
 * no authentication. They go to a sibling directory that is not served
 * statically and are read back through an authenticated, ownership-checked
 * route instead.
 */
export const IDENTITY_UPLOAD_DIR = './uploads-private/identity';

export const identityMulterConfig = {
  storage: diskStorage({
    destination: (req, file, callback) => {
      mkdirSync(IDENTITY_UPLOAD_DIR, { recursive: true });
      callback(null, IDENTITY_UPLOAD_DIR);
    },
    filename: (req, file, callback) => {
      callback(null, `${uuidv4()}${extname(file.originalname)}`);
    },
  }),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 2,
    parts: 20,
  },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return callback(
        new Error('Only JPEG and PNG images are allowed!'),
        false,
      );
    }
    callback(null, true);
  },
};

export const attendanceMulterConfig = {
  storage: memoryStorage(),
  limits: {
    fileSize: 1024 * 1024,
    files: 1,
    parts: 8,
  },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return callback(
        new Error('Only JPEG and PNG images are allowed!'),
        false,
      );
    }
    callback(null, true);
  },
};

export const imageFileFilter = (req, file, callback) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
    return callback(new Error('Only image files are allowed!'), false);
  }
  callback(null, true);
};

export const storage = diskStorage({
  destination: './uploads',
  filename: (req, file, callback) => {
    const name = uuidv4();
    const extension = extname(file.originalname);
    callback(null, `${name}${extension}`);
  },
});
