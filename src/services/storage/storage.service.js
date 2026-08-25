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

const storage = {
  uploadVideo,
  deleteVideo,
  getVideoUrl,
  getThumbnailUrl,
};

export default storage;
