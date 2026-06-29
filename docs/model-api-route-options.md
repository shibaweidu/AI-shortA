# Model API Route Options

This document describes every API route option currently supported by this project. It is intended as a portable implementation guide for another project that needs the same provider/model routing behavior.

The route list comes from `frontend/src/lib/modelApiRoutes.ts`.

## Core Routing Rules

Each model may store `apiRoutes`, an ordered list of enabled endpoints. Runtime generation uses only enabled endpoints.

Important behavior:

- Endpoint selection is strict. If an endpoint is not enabled, do not use it.
- Multiple enabled endpoints are an ordered fallback queue, not parallel requests.
- The first successful endpoint wins.
- If an endpoint fails and there is another enabled endpoint, the next enabled endpoint may be tried.
- A task polling failure such as `fail_reason`, `error`, or `message` should stop that async task immediately.
- Do not route by model name alone. Combine provider/base URL, model id, and selected endpoint.
- Save final media to your own object storage and return that permanent URL to the frontend.

## Authentication And Base URL

For OpenAI-compatible providers, build the target URL as:

```txt
{provider.baseUrl}{endpoint}
```

Most requests use:

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
Accept: application/json
```

Image edit endpoints use `multipart/form-data`.

## Supported Route Options

### Language

| Endpoint | Label | Notes |
| --- | --- | --- |
| `/chat/completions` | Chat Completions | Standard language chat endpoint. |

### Image

| Endpoint | Label | Sync/Async | Notes |
| --- | --- | --- | --- |
| `/images/generations` | Images Generations | Usually sync | OpenAI-compatible image generation. |
| `/images/edits` | Images Edits | Usually sync | Multipart image edit endpoint. |
| `/chat/completions` | Chat Completions | Depends on provider | Used by nano-banana, Maomi/New API style image models, and some image-chat compatible providers. |
| `/responses` | Responses | Usually sync | OpenAI Responses image-generation tool style. |
| `/v1/async/generations` | Unified Async Generations | Async | Unified async image/video endpoint, used by Mingyu/Qiyuan and similar providers. |
| `/v1/videos` | Newtoken Async (v1/videos) | Async | Newtoken GPT Image 2 image tasks may use the video-style async endpoint. |

### Video

| Endpoint | Label | Sync/Async | Notes |
| --- | --- | --- | --- |
| `/chat/completions` | Chat Completions | Depends on provider | Used by Maomi/New API video, GeekAI/Grok-compatible video, and chat-driven providers. |
| `/video/generations` | Video Generations | Async | Generic OpenAI-like video generation endpoint. |
| `/v1/video/create` | Yunwu Video Create | Async | Yunwu Grok video create endpoint. |
| `/videos` | Videos | Async | Sora/Veo/Zexi-style video endpoint. |
| `/v1/async/generations` | Unified Async Generations | Async | Unified async endpoint for image/video. |
| `/async/generations` | Async Generations | Async | Non-`/v1` async endpoint variant. |
| `/video/create` | LNAPI Video Create | Async | LNAPI-style create endpoint. |

## Image Endpoint Details

### `/images/generations`

Use for OpenAI-compatible text-to-image.

Request:

```json
{
  "model": "gpt-image-1",
  "prompt": "a cinematic product photo",
  "n": 1,
  "size": "1024x1024",
  "aspect_ratio": "1:1"
}
```

Provider-specific notes:

- For providers that support reference images in generations, send `reference_images`.
- For Newtoken `gpt-image-2*_sync`, force `n: 1` and use `images` for references.
- For Mingyu/Qiyuan normal image endpoints, size may be normalized to a bare ratio such as `16x9`, `9x16`, or `1x1`.
- Do not send Mingyu async-only size values such as `16x9-2k` here unless the provider explicitly supports it.

Possible response shapes:

```json
{
  "created": 1710000000,
  "data": [
    { "url": "https://example.com/image.png" }
  ]
}
```

```json
{
  "data": [
    { "b64_json": "iVBORw0KGgo..." }
  ]
}
```

### `/images/edits`

Use for image edit tasks with reference images. This endpoint is multipart.

Request:

```http
POST /images/edits
Content-Type: multipart/form-data
```

Form fields:

```txt
model=gpt-image-1
prompt=replace the background with a studio backdrop
size=1024x1024
image=@input.png
```

Implementation notes:

- Attach one or more input files as `image`.
- If the user supplied multiple reference images, append each image file.
- This project converts payload fields to form-data and appends reference images separately.

### `/responses`

Use for OpenAI Responses API image-generation tool style.

Request:

```json
{
  "model": "gpt-4.1",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "make a clean hero image" },
        { "type": "input_image", "image_url": "https://example.com/ref.png" }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation",
      "size": "1024x1024"
    }
  ]
}
```

Implementation notes:

- Reference images use `input_image` content parts.
- Size is placed inside the `image_generation` tool.
- This route is not used for Mingyu unified async behavior.

### `/chat/completions` For Images

Use for providers that expose image generation/editing through chat completions.

Text-only request:

```json
{
  "model": "nano-banana-2",
  "messages": [
    {
      "role": "user",
      "content": "a clean futuristic product poster"
    }
  ],
  "modalities": ["image", "text"],
  "n": 1,
  "size": "1024x1024",
  "aspect_ratio": "1:1"
}
```

Reference-image request:

```json
{
  "model": "nano-banana-pro",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "make this image cinematic" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
          }
        }
      ]
    }
  ],
  "size": "1024x1024",
  "aspect_ratio": "1:1"
}
```

Provider-specific notes:

- Maomi/New API image models build the model id with ratio and resolution, for example `{base}+{ratio}+{1K|2K|4K}`.
- Mingyu/Qiyuan chat image calls use Mingyu image option normalization but not the async-only `ratio-tier` size.
- Grok image providers use `aspect_ratio` plus `resolution`, not `size` for quality.

### `/v1/async/generations` For Images

Use for unified async providers such as Mingyu/Qiyuan.

Create:

```json
{
  "model": "gpt-image-2",
  "prompt": "a cinematic mountain sunrise",
  "response_format": "url",
  "size": "16x9-2k",
  "quality": "medium"
}
```

Reference images:

```json
{
  "model": "gpt-image-2",
  "mode": "image_to_image",
  "prompt": "turn this into watercolor",
  "images": [
    "data:image/png;base64,iVBORw0KGgo..."
  ],
  "response_format": "url",
  "size": "1x1-2k",
  "quality": "medium"
}
```

Implementation notes:

- This project uses the `ratio-tier` size format only for `/v1/async/generations`.
- Examples: `16x9-2k`, `9x16-2k`, `1x1-4k`.
- Reference images must use `images`.
- After create, poll `GET /v1/async/generations/{task_id}`.
- Treat non-empty `fail_reason`, `error`, or `message` as terminal failure.

### `/v1/videos` For Image Tasks

This is used by Newtoken GPT Image 2 async image models.

Create:

```json
{
  "model": "gpt-image-2",
  "prompt": "a poster design",
  "aspect_ratio": "16:9",
  "images": [
    "data:image/png;base64,iVBORw0KGgo..."
  ]
}
```

Implementation notes:

- Do not use this endpoint only because the model name is `gpt-image-2`.
- Use it only for Newtoken provider/base URL or explicit model endpoint selection.
- The image task returns a task id and is then polled like a video task.
- The polling URL is usually `GET /v1/videos/{task_id}` or `/videos/{task_id}`.

## Video Endpoint Details

### Shared Video Payload

Most video endpoints use a payload shaped like:

```json
{
  "model": "sora-v3-fast",
  "prompt": "a cinematic camera move through a neon city",
  "size": "1280x720",
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "duration": 5,
  "seconds": "5",
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "images": [
    "data:image/png;base64,iVBORw0KGgo..."
  ]
}
```

Actual accepted fields vary by provider. Keep endpoint-specific transformations isolated.

### `/video/generations`

Generic video generation endpoint.

Create:

```json
{
  "model": "grok-video-3",
  "prompt": "a fashion model walking through a studio",
  "size": "720x1280",
  "aspect_ratio": "9:16",
  "duration": 6,
  "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
}
```

Poll common candidates:

```txt
/v1/video/generations/{task_id}
/video/generations/{task_id}
/v1/video/tasks/{task_id}
/video/tasks/{task_id}
/v1/tasks/{task_id}
/tasks/{task_id}
```

### `/videos`

Used by Sora, Veo, and Zexi-style providers.

Create:

```json
{
  "model": "sora-v3-fast",
  "prompt": "a robot walking through rain",
  "size": "16x9",
  "aspect_ratio": "16:9",
  "duration": 8,
  "seconds": "8",
  "image": "data:image/png;base64,iVBORw0KGgo..."
}
```

Veo-style size:

```json
{
  "model": "veo3",
  "prompt": "a realistic ocean wave",
  "size": "16x9-720p",
  "aspect_ratio": "16:9",
  "resolution": "720p",
  "duration": 5
}
```

Poll:

```txt
/v1/videos/{task_id}
/videos/{task_id}
```

### `/v1/async/generations` For Videos

Unified async video endpoint.

Create:

```json
{
  "model": "sora-v3-fast",
  "prompt": "a cinematic aerial shot",
  "aspect_ratio": "16:9",
  "size": "1280x720",
  "seconds": "5",
  "resolution": "720p",
  "images": [
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
  ]
}
```

Poll:

```txt
/v1/async/generations/{task_id}
```

Implementation notes:

- Unified async video may also accept `video_reference` and `video_reference_duration`.
- Use `seconds` for providers that require it.
- Do not keep polling after terminal failure text appears.

### `/async/generations`

Non-`/v1` async variant.

Create:

```json
{
  "model": "sora-v3-fast",
  "prompt": "a cinematic aerial shot",
  "aspect_ratio": "16:9",
  "size": "1280x720",
  "seconds": "5",
  "resolution": "720p"
}
```

Poll:

```txt
/async/generations/{task_id}
```

### `/video/create`

LNAPI-style video creation endpoint.

Create:

```json
{
  "model": "sora-v3-fast",
  "prompt": "a cinematic aerial shot",
  "size": "1280x720",
  "aspect_ratio": "16:9",
  "duration": 5,
  "image": "data:image/png;base64,iVBORw0KGgo..."
}
```

Poll may use:

```txt
/v1/video/query?id={task_id}
/video/query?id={task_id}
```

### `/v1/video/create`

Yunwu Grok video create endpoint.

Create:

```json
{
  "model": "grok-video-3",
  "prompt": "a dynamic camera move",
  "size": "1280x720",
  "aspect_ratio": "16:9",
  "duration": 10,
  "images": [
    "data:image/png;base64,iVBORw0KGgo..."
  ]
}
```

Implementation notes:

- Yunwu Grok video prefers `images` rather than a single `image` field.
- This project clears `image` and sends `images` when using this route.

### `/chat/completions` For Videos

Used by Maomi/New API video and GeekAI/Grok-compatible chat video providers.

Generic request:

```json
{
  "model": "grok-video-3",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "make a 10 second cinematic video" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBORw0KGgo..."
          }
        }
      ]
    }
  ],
  "prompt": "make a 10 second cinematic video",
  "size": "1280x720",
  "aspect_ratio": "16:9",
  "duration": 10
}
```

Maomi/New API video request:

```json
{
  "model": "seedance-2.0+16:9+720+5",
  "prompt": "a cinematic aerial shot",
  "input_images": [
    "data:image/png;base64,iVBORw0KGgo..."
  ]
}
```

Implementation notes:

- Maomi/New API encodes ratio, resolution, and duration into the model id.
- If no images are present, Maomi/New API may use `messages` with text content instead of `input_images`.

## Polling And Result Extraction

Create responses may include one of these task id fields:

```txt
task_id
taskId
video_id
videoId
generation_id
generationId
id
```

Active statuses:

```txt
queued
processing
pending
running
submitted
in_progress
created
```

Completed statuses:

```txt
completed
succeeded
success
```

Terminal failure fields:

```txt
fail_reason
error
message
detail.fail_reason
detail.error
detail.message
```

Media URL extraction should only accept real media URLs:

- `http://...`
- `https://...`
- `/relative/path`
- `data:image/...`
- `data:video/...`
- base64 image fields such as `b64_json`, `base64`, `image_base64`

Do not accept ordinary text as a URL.

Useful result fields:

```txt
url
image_url
output_url
result_url
video_url
mp4
video
source
src
data[].url
metadata.result_urls[]
detail.data.data[].url
```

## Default Route Heuristics

When a model does not have explicit `apiRoutes`, this project suggests defaults from provider/model text.

Image defaults:

- Newtoken + GPT Image 2:
  - model contains `_sync`: `/images/generations`
  - otherwise: `/v1/videos`
- Maomi/New API or `nano-banana-2`: `/chat/completions`
- Mingyu/Qiyuan or `nano-banana`: `/v1/async/generations`, `/chat/completions`, `/images/edits`
- GPT image or GeekAI Grok image: `/images/generations`, `/images/edits`, `/responses`, `/chat/completions`
- Generic image: `/images/generations`, `/responses`, `/chat/completions`

Video defaults:

- Maomi/New API, `seedance-2.0`, `kling-video-o-3`: `/chat/completions`
- Zexi + Sora/Seedance: `/videos`
- Yunwu + Grok video: `/v1/video/create`
- Grok video: `/chat/completions`
- Sora/Veo on Mingyu/Qiyuan: `/v1/async/generations`, `/async/generations`, `/videos`, `/video/create`
- Generic Sora/Veo: `/videos`, `/v1/async/generations`, `/async/generations`, `/video/create`
- Generic video: `/video/generations`

## Provider-Specific Notes

### Mingyu/Qiyuan

- Base URL commonly: `https://mingyu.it.com`
- Prefer `/v1/async/generations`.
- Use `size` as `16x9-2k`, `9x16-2k`, `1x1-4k` only for `/v1/async/generations`.
- For normal Mingyu image endpoints, keep `size` as bare ratio or endpoint-supported pixel values.
- `gpt-image-2` supports `low` and `medium`; do not send `high`.

### Newtoken

- GPT Image 2 image tasks may use `/v1/videos`.
- `_sync` model variants use `/images/generations`.
- Async image payload uses `aspect_ratio`, not `size`.
- Provider identity matters. Do not route all `gpt-image-2` models to `/v1/videos`.

### Maomi/New API

- Image and video may use `/chat/completions`.
- Image model id may be transformed into `{base}+{ratio}+{1K|2K|4K}`.
- Video model id may be transformed into `{base}+{ratio}+{resolution}+{duration}`.
- Reference images use `input_images`.

### GeekAI/Grok

- Grok image uses `aspect_ratio` and `resolution`.
- Grok video may use `/chat/completions` or `/video/generations` depending on provider.
- Duration support varies by provider.

### Yunwu

- Grok video create uses `/v1/video/create`.
- Send multiple references in `images`.

### Zexi

- Seedance/Sora style models use `/videos`.
- Payload includes `seconds`, `duration`, `aspect_ratio`, `ratio`, and provider-specific `resolution`.

## Save And Display Results

Recommended flow:

1. Extract the upstream media URL.
2. Download the media server-side.
3. Upload the final media to your own object storage.
4. Store both:
   - `upstreamUrl`: supplier URL
   - `resultUrl`: your permanent object storage URL
5. Return `resultUrl` to the frontend.
6. Frontend should display/copy the permanent URL, falling back to local blob only if remote display fails.

