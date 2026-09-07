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

  // Prefer frame 60 (0-based index 59). Falls back to ~2s seek if select fails.
  const attempts = [
    [
      '-i',
      filePath,
      '-vf',
      "select=eq(n\\,59)",
      '-vframes',
      '1',
      '-q:v',
      '2',
      '-y',
      outputPath,
    ],
    ['-ss', '2', '-i', filePath, '-vframes', '1', '-q:v', '2', '-y', outputPath],
    ['-ss', '0.5', '-i', filePath, '-vframes', '1', '-q:v', '2', '-y', outputPath],
  ];

  for (const args of attempts) {
    try {
      await execFileAsync(ffmpegPath, args);
      if (fs.existsSync(outputPath)) return true;
    } catch {
      /* try next */
    }
  }

  return false;
};

/**
 * Extract duration (seconds) and a JPEG thumbnail (~frame 60) from a local video file.
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
