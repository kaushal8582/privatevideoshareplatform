import * as r2Service from './r2.service.js';

const provider = r2Service;

export const uploadVideo = async (file) => provider.uploadVideo(file);

export const deleteVideo = async (publicId, thumbnailPublicId) =>
  provider.deleteVideo(publicId, thumbnailPublicId);

export const getVideoUrl = async (publicId, storedUrl) =>
  provider.getVideoUrl(publicId, storedUrl);

export const getThumbnailUrl = async (thumbnailPublicId, videoPublicId) => {
  if (typeof provider.getThumbnailUrl === 'function') {
    return provider.getThumbnailUrl(thumbnailPublicId, videoPublicId);
  }
  return null;
};

export const createDirectMultipartUpload = (opts) =>
  provider.createDirectMultipartUpload(opts);

export const completeDirectMultipartUpload = (opts) =>
  provider.completeDirectMultipartUpload(opts);

export const abortDirectMultipartUpload = (key, uploadId) =>
  provider.abortDirectMultipartUpload(key, uploadId);

export const MULTIPART_PART_SIZE = provider.MULTIPART_PART_SIZE;

const storage = {
  uploadVideo,
  deleteVideo,
  getVideoUrl,
  getThumbnailUrl,
  createDirectMultipartUpload,
  completeDirectMultipartUpload,
  abortDirectMultipartUpload,
  MULTIPART_PART_SIZE,
};

export default storage;
