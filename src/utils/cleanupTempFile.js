import fsPromises from 'fs/promises';

export const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fsPromises.unlink(filePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error('Failed to remove temp file:', filePath, err.message);
    }
  }
};

export const cleanupTempUpload = async (file) => {
  if (file?.path) {
    await safeUnlink(file.path);
  }
};
