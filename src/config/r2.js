import { S3Client } from '@aws-sdk/client-s3';

let client = null;

const isPrivateR2Endpoint = (url = '') =>
  url.includes('.r2.cloudflarestorage.com');

export const getR2Config = () => {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT || process.env.ENDPOINT;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    throw new Error(
      'R2 configuration missing. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT (or ENDPOINT), and R2_BUCKET.'
    );
  }

  if (publicUrl && isPrivateR2Endpoint(publicUrl)) {
    throw new Error(
      'R2_PUBLIC_URL must NOT be the private S3 API endpoint (*.r2.cloudflarestorage.com). Enable public access on your bucket and use the pub-xxx.r2.dev URL or a custom domain.'
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
    publicUrl: publicUrl || null,
  };
};

export const getR2Client = () => {
  if (!client) {
    const config = getR2Config();
    client = new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  return client;
};

export { isPrivateR2Endpoint };
