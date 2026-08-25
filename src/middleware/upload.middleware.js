import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  getMaxVideoSizeBytes,
  isAllowedMimeType,
  isAllowedExtension,
} from '../utils/validators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${unique}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  if (!isAllowedMimeType(file.mimetype) || !isAllowedExtension(file.originalname)) {
    const error = new Error(
      'Unsupported video type. Allowed: MP4, WebM, MOV, MKV.'
    );
    error.statusCode = 400;
    error.code = 'INVALID_FILE_TYPE';
    return cb(error, false);
  }
  cb(null, true);
};

const createUpload = () =>
  multer({
    storage,
    fileFilter,
    limits: {
      fileSize: getMaxVideoSizeBytes(),
      files: 1,
    },
  });

export const uploadSingleVideo = (req, res, next) => {
  createUpload().single('video')(req, res, next);
};