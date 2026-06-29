# Mingyu OpenAI-Compatible Image And Video API

Source: https://mingyu.it.com/openai-image-compat-examples.html

This document summarizes the Mingyu/OpenAI-compatible image and video interfaces for reuse in other projects. Use `https://mingyu.it.com` as the base URL unless your supplier gives you a different endpoint.

## Authentication

Every request must include one of these authentication headers:

```http
Authorization: Bearer YOUR_API_KEY
```

or:

```http
X-API-Key: YOUR_API_KEY
```

For JSON endpoints, also include:

```http
Content-Type: application/json
```

## Recommended Entry: Unified Async Generations

Use this endpoint first for new integrations.

Create task:

```http
POST /v1/async/generations
```

Query task:

```http
GET /v1/async/generations/{task_id}
```

Image and video tasks share the same create/query flow. The request fields depend on the model type.

### Image Text To Image

```bash
curl -X POST "https://mingyu.it.com/v1/async/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "a cinematic mountain sunrise above clouds",
    "size": "16x9-2k",
    "quality": "medium",
    "response_format": "url"
  }'
```

### Image To Image

For the unified async endpoint, image references must use the `images` field. Do not send reference aliases such as `image_urls`, `input_reference`, or `reference_images` to this endpoint.

```json
{
  "model": "gpt-image-2",
  "mode": "image_to_image",
  "prompt": "turn this image into a watercolor illustration",
  "size": "2048x2048",
  "quality": "medium",
  "images": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
  ],
  "response_format": "url"
}
```

### Video Task

```bash
curl -X POST "https://mingyu.it.com/v1/async/generations" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "sora-v3-fast",
    "prompt": "follow the motion style of the reference video and keep the character consistent",
    "aspect_ratio": "16:9",
    "seconds": 5,
    "resolution": "720p",
    "images": [
      "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
    ],
    "video_reference": "data:video/mp4;base64,AAAAIGZ0eXBtcDQy...",
    "video_reference_duration": 5
  }'
```

### Create Response

The create response usually returns an async task id:

```json
{
  "id": "task_xxx",
  "object": "async.generation",
  "model": "gpt-image-2",
  "type": "image",
  "status": "pending",
  "progress": 0,
  "created_at": 1773299484
}
```

Use `id` as `task_id` when polling.

### Query Response

Completed responses may put the result URL in more than one place. A robust client should check `url`, `result.url`, `result.image_url`, `result.video_url`, `data[].url`, `detail.data.data[].url`, and similar nested fields.

```json
{
  "id": "task_xxx",
  "object": "async.generation",
  "model": "gpt-image-2",
  "type": "image",
  "status": "completed",
  "progress": 100,
  "completed_at": 1773299693,
  "url": "https://example.com/generated/xxx.png",
  "error": null
}
```

If the response contains `fail_reason`, `error`, or `message` with a non-empty value, treat the task as failed immediately and stop polling.

Example failure:

```json
{
  "status": "completed",
  "detail": {
    "fail_reason": "No active tokens available in the pool"
  }
}
```

Do not treat failure text as a media URL.

## Image Parameters

### Public Image Models

- `nano-banana-2`
- `nano-banana-pro`
- `gpt-image-2`

### Unified Async Image Fields

| Field | Required | Notes |
| --- | --- | --- |
| `model` | yes | Image model id. |
| `prompt` | yes | Image prompt. |
| `mode` | no | `text_to_image` or `image_to_image`. If `images` is present, use `image_to_image`. |
| `size` | recommended | Use ratio-tier values such as `16x9-2k`, `1x1-4k`, or pixel values such as `2048x2048`. |
| `quality` | model-dependent | `nano-banana-*`: `1K`, `2K`, `4K`. `gpt-image-2`: `low`, `medium`; do not send `high`. |
| `images` | no | Reference images. Use data URLs or raw base64 for best reliability. |
| `response_format` | no | `url`, `b64_json`, or `base64`. Default is `url`. |

### Size Rules

For `/v1/async/generations`, image tasks should express ratio and tier through `size`.

Examples:

```txt
16:9 2K -> 16x9-2k
9:16 2K -> 9x16-2k
1:1 4K  -> 1x1-4k
```

Pixel values are also accepted:

```txt
2048x2048
2048x1136
1136x2048
```

Important project note: in this codebase, the ratio-tier format is only used for `/v1/async/generations`. Other Mingyu image endpoints keep their own parameter style.

### gpt-image-2 Size Support

`gpt-image-2` supports `1K` and `2K`. The `2K` output is based on a longest side of about 2048.

Common pixel examples:

```txt
1:1  -> 1024x1024 or 2048x2048
16:9 -> 1376x768 or 2048x1136
9:16 -> 768x1376 or 1136x2048
```

## Legacy/Compatible Image Endpoints

These are available, but new integrations should prefer `/v1/async/generations`.

### Image Generations

```http
POST /v1/images/generations
```

Example:

```json
{
  "model": "gpt-image-2",
  "prompt": "a clean product photo on a white background",
  "size": "2048x2048",
  "quality": "medium",
  "response_format": "url"
}
```

For `nano-banana-*`, you may use `aspect_ratio` plus `quality`:

```json
{
  "model": "nano-banana-pro",
  "prompt": "a cinematic mountain sunrise above clouds",
  "aspect_ratio": "16:9",
  "quality": "2K",
  "response_format": "url"
}
```

Reference image aliases may be accepted here, including `image_urls`, `input_reference`, and `reference_images`, but data URLs/base64 are still safer than public URLs.

### Image Edits

```http
POST /v1/images/edits
Content-Type: multipart/form-data
```

Only `gpt-image-2` is supported.

```bash
curl -X POST "https://mingyu.it.com/v1/images/edits" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "model=gpt-image-2" \
  -F "prompt=remove the background and keep the product sharp" \
  -F "image=@input.png" \
  -F "size=2048x2048" \
  -F "quality=medium" \
  -F "response_format=url"
```

Notes:

- `image` / `image[]` is required.
- Up to 6 input images.
- `quality` supports only `low` and `medium`.
- `high` is not supported for `gpt-image-2`.

### Chat Completions Image Call

```http
POST /v1/chat/completions
```

```json
{
  "model": "nano-banana-2",
  "messages": [
    {
      "role": "user",
      "content": "a futuristic city at sunset"
    }
  ],
  "aspect_ratio": "16:9",
  "quality": "2K"
}
```

Image-to-image:

```json
{
  "model": "nano-banana-pro",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "make this image look cinematic" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
          }
        }
      ]
    }
  ],
  "aspect_ratio": "auto",
  "quality": "2K"
}
```

## Video Parameters

### Public Video Models

- `kling-video-3.0`
- `sora2`
- `veo31-fast`
- `kling-video-o3-omni`
- `sora-v3-pro`
- `sora-v3-fast`

### Unified Async Video Fields

| Field | Required | Notes |
| --- | --- | --- |
| `model` | yes | Video model id. |
| `prompt` | yes | Video prompt. |
| `aspect_ratio` | no | Usually `16:9`, `9:16`, or model-supported ratios. |
| `size` | no | May be used as a ratio alias, such as `1280x720`, `720x1280`, `720x720`. |
| `seconds` | recommended | Video duration in seconds. Use `seconds`, not `duration`, for the unified async endpoint. |
| `resolution` | no | Usually `480p`, `720p`, or `1080p`, depending on model support. |
| `images` | no | Reference image array. Use data URLs/base64 for reliability. |
| `video_reference` | no | Supported by models such as `kling-video-o3-omni`, `sora-v3-pro`, and `sora-v3-fast`. |
| `video_reference_duration` | no | Reference video duration in seconds. |

### Video Size Aliases

```txt
1280x720, 1920x1080 -> 16:9
720x1280, 1080x1920 -> 9:16
720x720, 1080x1080   -> 1:1
```

## Direct Video Endpoint

```http
POST /v1/videos
GET /v1/videos/{task_id}
```

The direct video endpoint is async. The recommended endpoint for new projects is still `/v1/async/generations`.

Create:

```json
{
  "model": "sora2",
  "prompt": "a cinematic shot of a robot walking in rain",
  "aspect_ratio": "16:9",
  "seconds": 4,
  "resolution": "720p"
}
```

Query:

```bash
curl "https://mingyu.it.com/v1/videos/task_xxx" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

Completed response:

```json
{
  "task_id": "task_xxx",
  "model": "sora-v3-fast",
  "status": "completed",
  "progress": 100,
  "video_url": "https://example.com/generated/xxx.mp4",
  "error": null
}
```

## Error Handling

Common HTTP statuses:

| Status | Meaning |
| --- | --- |
| `400` | Invalid parameters, unsupported model, unsupported ratio/resolution/duration. |
| `401` | Missing or invalid API key. |
| `503` | Upstream temporarily unavailable, invalid token, or insufficient quota. |
| `500` | Internal service error. |

Async task error handling:

1. If task status is `pending`, `queued`, `processing`, `running`, `submitted`, `in_progress`, or `created`, keep polling.
2. If status is `completed` or `success`, extract the media URL.
3. If the payload contains a non-empty `fail_reason`, `error`, or `message`, stop polling and fail the task.
4. Do not parse ordinary failure text as an image/video URL.
5. Public media URLs can expire or be blocked; download and save generated media to your own object storage when possible.

## Implementation Notes From This Project

- Endpoint selection is supplier-specific. Do not route only by model name such as `gpt-image-2`; combine provider/base URL and the selected endpoint.
- API endpoint selection is strict. If an endpoint is not selected in model settings, do not use it as fallback.
- Multiple selected endpoints act as an ordered fallback queue, not parallel requests.
- `/v1/async/generations` uses the `images` field for reference images.
- `/v1/async/generations` image size uses `ratio-tier` values such as `16x9-2k`.
- Other Mingyu image endpoints should not automatically receive `ratio-tier` size values unless their docs say so.
- When the upstream task reports a failure, mark the local job failed immediately and stop polling.
- Save successful media to object storage and return that permanent URL to the frontend.
