# Cloudflare R2 — required for browser chunked uploads (direct PUT to R2)

## CORS rules (Cloudflare dashboard → R2 → your bucket → Settings → CORS)

```json
[
  {
    "AllowedOrigins": [
      "https://mastplayer.in",
      "https://www.mastplayer.in",
      "http://localhost:5173"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "etag"],
    "MaxAgeSeconds": 3600
  }
]
```

Without **ExposeHeaders: ETag**, chunked upload will fail after parts upload
(browser cannot read ETag for CompleteMultipartUpload).

## Why 413 happened

Uploading the whole file to `https://api.mastplayer.in/...` is blocked by the
reverse proxy (nginx / Cloudflare / host) with **413 Request Entity Too Large**.
Chunked upload sends small parts **directly to R2**, so the API never receives
the video body.

## Optional nginx (only if you still use legacy /api/videos/upload)

```nginx
client_max_body_size 2048m;
```

## Playback “in chunks”

Players already use HTTP Range requests against R2 presigned URLs, so video
buffers/plays in segments. Full HLS/DASH adaptive streaming can be added later.
