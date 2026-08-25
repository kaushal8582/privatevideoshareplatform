import { execFile } from 'child_process';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';

const execFileAsync = promisify(execFile);

const runFfprobeDuration = async (filePath) => {
  if (!ffprobePath) return null;

  try {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    const seconds = parseFloat(String(stdout).trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
};

const runFfmpegThumbnail = async (filePath, outputPath) => {
  if (!ffmpegPath) return false;

  try {
    await execFileAsync(ffmpegPath, [
      '-ss',
      '00:00:00.5',
      '-i',
      filePath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      '-y',
      outputPath,
    ]);

    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
};

/**
 * Extract duration (seconds) and a JPEG thumbnail (first frame) from a local video file.
 */
export const extractVideoMetadata = async (filePath) => {
  const duration = await runFfprobeDuration(filePath);

  const thumbPath = path.join(
    os.tmpdir(),
    `thumb-${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`
  );

  const hasThumbnail = await runFfmpegThumbnail(filePath, thumbPath);

  return {
    duration,
    thumbnailPath: hasThumbnail ? thumbPath : null,
  };
};

export const cleanupMetadataArtifacts = async ({ thumbnailPath } = {}) => {
  if (thumbnailPath) {
    await fsPromises.unlink(thumbnailPath).catch(() => undefined);
  }
};
