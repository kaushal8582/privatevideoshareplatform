import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { getR2Client, getR2Config, isPrivateR2Endpoint } from '../../config/r2.js';
import { safeUnlink } from '../../utils/cleanupTempFile.js';
import { extractVideoMetadata } from '../../utils/videoMetadata.js';

const PLAYBACK_URL_EXPIRY_SECONDS = 4 * 60 * 60;
const THUMBNAIL_URL_EXPIRY_SECONDS = 24 * 60 * 60;
const PART_URL_EXPIRY_SECONDS = 2 * 60 * 60;
export const MULTIPART_PART_SIZE = 8 * 1024 * 1024; // 8 MB

const generateAssetId = () => crypto.randomBytes(12).toString('hex');

const buildObjectKeys = (originalName = '') => {
  const ext = path.extname(originalName).toLowerCase() || '.mp4';
  const id = generateAssetId();
  return {
    videoKey: `videos/${id}${ext}`,
    thumbnailKey: `thumbnails/${id}.jpg`,
  };
};

const buildPublicUrl = (key) => {
  const { publicUrl } = getR2Config();
  if (!publicUrl) return null;
  const base = publicUrl.replace(/\/$/, '');
  return `${base}/${key}`;
};

const createPresignedUrl = async (key, expiresIn = PLAYBACK_URL_EXPIRY_SECONDS) => {
  const { bucket } = getR2Config();
  const client = getR2Client();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );
};

const uploadBufferToR2 = async (key, body, contentType) => {
  const { bucket } = getR2Config();
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
};

/**
 * Start multipart upload + return presigned part URLs.
 * Browser uploads chunks directly to R2 (bypasses API proxy 413).
 */
export const createDirectMultipartUpload = async ({
  originalName,
  mimeType,
  partCount,
}) => {
  const { bucket } = getR2Config();
  const client = getR2Client();
  const { videoKey, thumbnailKey } = buildObjectKeys(originalName);

  const createRes = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: videoKey,
      ContentType: mimeType || 'video/mp4',
    })
  );

  const r2UploadId = createRes.UploadId;
  const parts = [];

  for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
    const url = await getSignedUrl(
      client,
      new UploadPartCommand({
        Bucket: bucket,
        Key: videoKey,
        UploadId: r2UploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: PART_URL_EXPIRY_SECONDS }
    );
    parts.push({ partNumber, url });
  }

  const thumbnailUploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: thumbnailKey,
      ContentType: 'image/jpeg',
    }),
    { expiresIn: PART_URL_EXPIRY_SECONDS }
  );

  return {
    key: videoKey,
    thumbnailKey,
    r2UploadId,
    partSize: MULTIPART_PART_SIZE,
    parts,
    thumbnailUploadUrl,
  };
};

export const completeDirectMultipartUpload = async ({ key, r2UploadId, parts }) => {
  const { bucket } = getR2Config();
  const client = getR2Client();
  const sorted = [...parts].sort((a, b) => a.PartNumber - b.PartNumber);

  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: r2UploadId,
      MultipartUpload: {
        Parts: sorted.map((p) => ({
          ETag: p.ETag,
          PartNumber: p.PartNumber,
        })),
      },
    })
  );

  const publicPlaybackUrl = buildPublicUrl(key);
  return {
    provider: 'r2',
    publicId: key,
    url: publicPlaybackUrl || (await createPresignedUrl(key)),
  };
};

export const abortDirectMultipartUpload = async (key, r2UploadId) => {
  if (!key || !r2UploadId) return;
  const { bucket } = getR2Config();
  const client = getR2Client();
  try {
    await client.send(
      new AbortMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: r2UploadId,
      })
    );
  } catch {
    // ignore
  }
};

export const uploadVideo = async (file) => {
  const { bucket } = getR2Config();
  const client = getR2Client();
  const { videoKey, thumbnailKey } = buildObjectKeys(file.originalname);
  let thumbnailPath = null;

  try {
    const metadata = await extractVideoMetadata(file.path);
    thumbnailPath = metadata.thumbnailPath;

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: videoKey,
        Body: fs.createReadStream(file.path),
        ContentType: file.mimetype,
        ContentLength: file.size,
      })
    );

    let thumbnailPublicId = null;
    if (thumbnailPath) {
      const thumbBuffer = await fsPromises.readFile(thumbnailPath);
      await uploadBufferToR2(thumbnailKey, thumbBuffer, 'image/jpeg');
      thumbnailPublicId = thumbnailKey;
    }

    const publicPlaybackUrl = buildPublicUrl(videoKey);
    return {
      provider: 'r2',
      publicId: videoKey,
      url: publicPlaybackUrl || (await createPresignedUrl(videoKey)),
      thumbnailPublicId,
      duration: metadata.duration,
      bytes: file.size,
      format: path.extname(file.originalname).slice(1).toLowerCase() || null,
    };
  } finally {
    await safeUnlink(file.path);
    await safeUnlink(thumbnailPath);
  }
};

/**
 * Delete video + thumbnail objects from R2.
 * Always attempts both keys. Missing objects are treated as success (idempotent).
 */
export const deleteVideo = async (publicId, thumbnailPublicId = null) => {
  const { bucket } = getR2Config();
  const client = getR2Client();

  if (!publicId) {
    const err = new Error('publicId is required to delete a video from R2');
    err.code = 'STORAGE_DELETE_FAILED';
    throw err;
  }

  const keys = new Set([String(publicId).trim()].filter(Boolean));

  if (thumbnailPublicId) {
    keys.add(String(thumbnailPublicId).trim());
  }

  // Also try derived thumbnail path (covers older/auto thumbs)
  const derivedThumb = String(publicId)
    .replace(/^videos\//, 'thumbnails/')
    .replace(/\.[^.]+$/, '.jpg');
  if (derivedThumb && derivedThumb !== publicId) {
    keys.add(derivedThumb);
  }

  const Objects = [...keys].filter(Boolean).map((Key) => ({ Key }));
  if (Objects.length === 0) {
    const err = new Error('No R2 keys to delete');
    err.code = 'STORAGE_DELETE_FAILED';
    throw err;
  }

  try {
    // Prefer batch delete
    const batch = await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects,
          Quiet: false,
        },
      })
    );

    const errors = Array.isArray(batch?.Errors) ? batch.Errors : [];
    // Ignore not-found; fail on access/permission/etc.
    const hardErrors = errors.filter(
      (e) => e?.Code && !['NoSuchKey', 'NotFound'].includes(String(e.Code))
    );
    if (hardErrors.length) {
      const msg = hardErrors.map((e) => `${e.Key}: ${e.Code} ${e.Message || ''}`).join('; ');
      const err = new Error(`R2 deletion failed: ${msg}`);
      err.code = 'STORAGE_DELETE_FAILED';
      throw err;
    }

    console.log(
      `[r2] deleted keys=${Objects.map((o) => o.Key).join(', ')} deleted=${(batch?.Deleted || []).length}`
    );
    return {
      result: 'ok',
      deletedKeys: (batch?.Deleted || []).map((d) => d.Key).filter(Boolean),
      requestedKeys: Objects.map((o) => o.Key),
    };
  } catch (err) {
    if (err?.code === 'STORAGE_DELETE_FAILED') throw err;

    // Fallback: delete one-by-one if batch unsupported
    const deletedKeys = [];
    const failures = [];
    for (const { Key } of Objects) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key }));
        deletedKeys.push(Key);
      } catch (oneErr) {
        const status = oneErr?.$metadata?.httpStatusCode;
        if (status === 404 || oneErr?.name === 'NoSuchKey' || oneErr?.Code === 'NoSuchKey') {
          deletedKeys.push(Key);
          continue;
        }
        failures.push(`${Key}: ${oneErr.message}`);
      }
    }

    if (failures.length) {
      const error = new Error(`R2 deletion failed: ${failures.join('; ')}`);
      error.code = 'STORAGE_DELETE_FAILED';
      error.details = err;
      throw error;
    }

    console.log(`[r2] deleted (fallback) keys=${deletedKeys.join(', ')}`);
    return { result: 'ok', deletedKeys, requestedKeys: Objects.map((o) => o.Key) };
  }
};

export const getVideoUrl = async (publicId, storedUrl) => {
  if (!publicId) return '';
  const publicPlaybackUrl = buildPublicUrl(publicId);
  if (publicPlaybackUrl && storedUrl && !isPrivateR2Endpoint(storedUrl)) {
    return storedUrl;
  }
  if (publicPlaybackUrl) return publicPlaybackUrl;
  return createPresignedUrl(publicId);
};

export const getThumbnailUrl = async (thumbnailPublicId, videoPublicId) => {
  const key =
    thumbnailPublicId ||
    (videoPublicId
      ? videoPublicId.replace(/^videos\//, 'thumbnails/').replace(/\.[^.]+$/, '.jpg')
      : null);
  if (!key) return null;
  const publicThumbUrl = buildPublicUrl(key);
  if (publicThumbUrl) return publicThumbUrl;
  try {
    return await createPresignedUrl(key, THUMBNAIL_URL_EXPIRY_SECONDS);
  } catch {
    return null;
  }
};
