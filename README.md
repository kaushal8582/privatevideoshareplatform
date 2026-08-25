# VideoShare Backend

Private video sharing API. Handles upload coordination, metadata, and share tokens. Videos are stored via an abstracted storage layer (Cloudflare R2).

## Features

- Video upload with MIME, extension, and size validation
- Cloudflare R2 storage behind a provider-agnostic storage service
- Cryptographically secure share tokens
- Paginated video listing
- Share-token lookup for public watch pages
- Delete from storage + MongoDB
- Helmet, CORS, and rate limiting

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- Cloudflare R2 (S3-compatible)
- Multer
- Helmet, CORS, express-rate-limit
- dotenv

## Folder Structure

```
Backend/
├── src/
│   ├── config/
│   │   ├── database.js
│   │   └── r2.js
│   ├── models/
│   │   └── Video.js
│   ├── controllers/
│   │   └── video.controller.js
│   ├── routes/
│   │   └── video.routes.js
│   ├── services/
│   │   └── storage/
│   │       ├── storage.service.js      # abstraction
│   │       └── r2.service.js           # Cloudflare R2 impl
│   ├── middleware/
│   ├── utils/
│   ├── middleware/
│   └── utils/
├── app.js
├── .env.example
├── package.json
└── README.md
```

## Installation

```bash
cd Backend
npm install
cp .env.example .env
# Edit .env with your values
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default `5000`) |
| `MONGODB_URI` | MongoDB connection string |
| `FRONTEND_URL` | Allowed CORS origin |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_ENDPOINT` | R2 S3 endpoint URL |
| `R2_BUCKET` | R2 bucket name |
| `R2_PUBLIC_URL` | Public URL for playback (r2.dev or custom domain) |
| `MAX_VIDEO_SIZE_MB` | Max upload size in MB |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window |
| `RATE_LIMIT_MAX_REQUESTS` | Global max requests per window |
| `UPLOAD_RATE_LIMIT_MAX` | Upload endpoint limit |
| `SHARE_RATE_LIMIT_MAX` | Share endpoint limit |
| `DELETE_RATE_LIMIT_MAX` | Delete endpoint limit |

## MongoDB Setup

1. Install and start MongoDB locally, or use MongoDB Atlas.
2. Set `MONGODB_URI` in `.env`.

Example local URI:

```
MONGODB_URI=mongodb://localhost:27017/video-share
```

## Cloudflare R2 Setup

1. Create an R2 bucket in the Cloudflare dashboard.
2. Create an R2 API token with read/write access.
3. Enable **Public access** on the bucket (r2.dev subdomain or custom domain).
4. Set in `.env`:
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
   - `R2_ENDPOINT` — `https://<account_id>.r2.cloudflarestorage.com`
   - `R2_BUCKET` — bucket name
   - `R2_PUBLIC_URL` — public playback base URL (e.g. `https://pub-xxxxx.r2.dev`)

Videos are stored under the `videos/` key prefix with random IDs (not original filenames).

Never expose R2 secrets to the frontend.

## Local Development

```bash
npm run dev
# or
npm start
```

Server: `http://localhost:5000`

## API Documentation

Base URL: `http://localhost:5000/api`

### Consistent response shape

**Success**

```json
{
  "success": true,
  "message": "...",
  "data": {}
}
```

**Error**

```json
{
  "success": false,
  "message": "...",
  "error": "ERROR_CODE"
}
```

---

### GET `/api/health`

Health check.

**Response**

```json
{
  "success": true,
  "message": "OK",
  "data": {
    "status": "healthy",
    "timestamp": "2026-08-21T12:00:00.000Z"
  }
}
```

---

### POST `/api/videos/upload`

Upload a video (`multipart/form-data`).

| Field | Type | Required |
|-------|------|----------|
| `video` | file | yes |
| `title` | string | no (derived from filename) |

**Success (201)**

```json
{
  "success": true,
  "message": "Video uploaded successfully",
  "data": {
    "id": "...",
    "title": "My Video",
    "shareToken": "Xk92Lm7QaP",
    "shareUrl": "http://localhost:5173/v/Xk92Lm7QaP",
    "videoUrl": "https://pub-xxxxx.r2.dev/videos/abc123.mp4",
    "size": 123456,
    "duration": 95.2,
    "createdAt": "..."
  }
}
```

**Errors**

- `400` Invalid / unsupported file
- `400` File too large
- `429` Rate limit
- `500` Upload or database failure

---

### GET `/api/videos`

List videos (newest first). Pagination-ready.

**Query**

| Param | Default |
|-------|---------|
| `page` | `1` |
| `limit` | `20` |

**Success (200)**

```json
{
  "success": true,
  "message": "Videos retrieved successfully",
  "data": {
    "videos": [],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "totalPages": 3
    }
  }
}
```

---

### GET `/api/videos/:id`

Get a video by MongoDB ID.

**Errors**

- `400` Invalid ID
- `404` Video not found

---

### GET `/api/videos/share/:shareToken`

Get video metadata for the public watch page.

**Success (200)**

```json
{
  "success": true,
  "data": {
    "title": "...",
    "videoUrl": "...",
    "originalName": "...",
    "size": 123456,
    "duration": 95.2,
    "createdAt": "..."
  }
}
```

**Errors**

- `400` Invalid share token
- `404` Video not found / deleted

---

### DELETE `/api/videos/:id`

Delete from storage provider, then remove the MongoDB document.

If storage deletion fails, the MongoDB record is **not** deleted and a `502` is returned.

**Errors**

- `400` Invalid ID
- `404` Video not found
- `502` Storage delete failed

---

## Storage Abstraction

```
Controllers → storage.service.js → r2.service.js → Cloudflare R2
```

To swap providers later, change the import in `storage.service.js` only.

## Production Deployment

1. Set `NODE_ENV=production`.
2. Use a managed MongoDB (Atlas) and secure R2 credentials.
3. Set `FRONTEND_URL` to your production frontend origin (not `*`).
4. Set `R2_PUBLIC_URL` to your production public bucket URL or custom domain.
5. Run behind HTTPS reverse proxy.
6. Tune rate limits for your traffic.

```bash
npm start
```

Store `storage.provider`, `storage.publicId`, and `storage.url` so deletes and playback stay provider-agnostic.
