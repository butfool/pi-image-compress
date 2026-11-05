<div align="center">

<h1>pi-image-compress</h1>

<p><strong>Re-encode every image that enters a Pi session to WebP before it lands in conversation history, so a screenshot-heavy session keeps fitting through your proxy.</strong></p>

<p>Pi extension · Pi 1.5.0+ · Node.js 22.19+</p>

<p>
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

[![npm](https://img.shields.io/npm/v/pi-image-compress?logo=npm&logoColor=white&label=npm&color=CB3837)](https://www.npmjs.com/package/pi-image-compress) [![Pi package](https://img.shields.io/badge/Pi-package-000000)](https://pi.dev/packages/pi-image-compress) [![License](https://img.shields.io/badge/license-MIT-3DA639?logo=opensourceinitiative&logoColor=white)](LICENSE) [![Node](https://img.shields.io/badge/node-22.19%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)

</div>

---

## What is this

Pi keeps every image that enters a session in the conversation history and resends that history on every turn. A screenshot returned by `read`, an image from an MCP tool, a picture pasted into the prompt: each one travels again with every request. A 2000×1270 PNG screenshot is 593,000 bytes once base64-encoded, and a session that collects a few dozen of them runs past the request-body limit of a reverse proxy, after which every request in that session comes back as a 413.

`pi-image-compress` hooks the two points where images enter the context and re-encodes each one to WebP: scaled into a 1536×2048 box, quality stepped down until the base64 payload is at most 120 KiB. Images that are already small enough pass through untouched. Images already written to history stay as they are.

Across 36 real UI screenshots, the stored images dropped from 19.50 MB to 2.35 MB, 64 KiB per image on average. A model's row-by-row transcription of a table from a compressed screenshot matched the original.

## Features

- Covers both entry points: images inside any tool result (`read`, MCP tools, `image()` in codemode) and images attached to a prompt (TUI paste, `@file`, RPC).
- Fits images into 1536×2048 and tries WebP quality 82, 74, 66, 58, then 50 until the base64 payload is at most 120 KiB.
- Passes images through byte for byte when they are inside the box and at most 30 KiB.
- Adds the original dimensions and the coordinate multiplier to scaled tool-result images, so a click on the compressed image can be mapped back to the source.
- Rewrites the `read` tool's `Read image file [image/png]` line to the format actually sent.
- Throws when an image cannot be brought under the cap, so the failure shows up in Pi's extension errors.

## Quick start

```bash
pi install npm:pi-image-compress
```

Merge this into `~/.pi/agent/settings.json` so Pi stops resizing images on its own:

```json
{
  "images": {
    "autoResize": false
  }
}
```

Run `/reload` or restart Pi. Every image that enters the session from then on is compressed.

> [!IMPORTANT]
> With `images.autoResize` at its default `true`, Pi still runs its own image pipeline. On the `read` path, Pi resizes and re-encodes each screenshot before the `tool_result` hook fires, so the same image is encoded twice and the WebP pass starts from pixels Pi already resampled.

## Install

### npm

```bash
pi install npm:pi-image-compress
```

### Try it without installing

```bash
pi -e npm:pi-image-compress
```

`-e` loads the package for one invocation and leaves the settings file alone.

### From a local clone

```bash
git clone https://github.com/butfool/pi-image-compress.git
cd pi-image-compress
npm install
pi install .
```

Local packages are loaded in place, so `npm install` provides `sharp` for the checkout.

### Update and remove

```bash
pi update --extensions
pi remove npm:pi-image-compress
```

`pi list` shows the packages currently configured.

> [!NOTE]
> Requires Pi 1.5.0 or newer and Node.js 22.19 or newer.

## Configuration

The extension has no settings of its own. The compression policy is fixed in `index.ts`:

| Constant | Value | Effect |
|---|---|---|
| `MAX_WIDTH` × `MAX_HEIGHT` | 1536 × 2048 | Scales each image into the box while keeping the aspect ratio. The width bound keeps text legible; the looser height bound keeps tall screenshots from collapsing into a narrow strip. |
| `QUALITIES` | 82 → 74 → 66 → 58 → 50 | Tried in order at one size; the first WebP that fits the byte cap wins. UI screenshots usually stop at 82. |
| `MAX_BASE64_BYTES` | 122880 (120 KiB) | Cap on the base64 payload of one image. When all five qualities overflow it, the dimensions shrink by 25% and the ladder runs again. |
| `SMALL_BASE64_BYTES` | 30720 (30 KiB) | Images inside the box and at most this size are passed through, since re-encoding them can make them larger. |

`compressImage` and these constants are exported, so a fork can change the budget and assert it in tests.

## How it works

Two hooks cover the paths images take:

| Hook | Covered images | What it does |
|---|---|---|
| `tool_result` | anything a tool returns: `read`, MCP tools, `image()` in codemode | Re-encodes image blocks, appends the dimension caption to scaled images, rewrites the `Read image file [...]` line |
| `input` | images attached to a prompt: TUI paste, `@file` arguments, RPC calls | Re-encodes image blocks and returns `transform`; the prompt text is left alone |

Per image:

- Already WebP, inside the box, and at most 120 KiB: left untouched.
- Inside the box and at most 30 KiB: left untouched.
- Otherwise: scaled into the box and encoded through the quality ladder; when every quality overflows, the dimensions shrink by 25% and the ladder runs again.
- When the output is smaller than the original, a text block follows the image: `[Image: original WxH, displayed at WxH. Multiply coordinates by N to map to original image.]`

A compression failure throws. Pi logs the error against the extension and keeps the original image, so the request still goes out with the oversized payload.

## Why WebP

The vision APIs behind OpenAI and Anthropic accept a fixed set of formats: PNG, JPEG, GIF, and WebP. AVIF compresses further, and an upstream gateway rejects it outright:

```
{"message":"... one of the supported image formats:
 ['image/jpeg', 'image/png', 'image/gif', 'image/webp']"}
```

On a 1536×975 UI screenshot, WebP q82 measured 66 KiB against 54 KiB for AVIF q60. The 12 KiB gap does not cover the cost of a format the gateway may refuse.

## Measured results

A batch of 36 real screenshots, measured as the base64 payload stored in the session:

| Pipeline | Total | Average |
|---|---|---|
| Pi default (2000 px box, PNG/JPEG at q80) | 19.50 MB | 529 KiB |
| Pi with a 1536 px box and a 256 KiB JPEG cap | 6.02 MB | 163 KiB |
| `pi-image-compress` (1536 px box, WebP) | 2.35 MB | 64 KiB |

A single 2000×1270 screenshot went from 593,000 bytes to 69,256 bytes. The model's row-by-row transcription of a table in it matched the original.

## Failure modes

- **Extension not loaded** (`pi -ne`, failed install): images pass through at full size and a session returns to the 413 pattern described above after a few dozen screenshots.
- **Image cannot fit 120 KiB** at quality 50 after repeated downscaling: `compressImage` throws, Pi records an extension error, and the original image still enters the result. That request carries the full payload; the extension error is the only signal.

## Development

```bash
git clone https://github.com/butfool/pi-image-compress.git
cd pi-image-compress
npm install
npm run typecheck
npm test
```

`npm test` runs `tests/compress.test.mjs` through `node --test`, which loads `index.ts` with Node's built-in type stripping. Six cases cover the exported `compressImage` and both hooks: a 2400×1600 PNG becomes a capped WebP scaled to 1536×1024, a small PNG passes through, the `tool_result` hook rewrites the image, the caption, and the format line, results without images are ignored, and the `input` hook returns `transform` for a large image and `continue` for a small one.

### Release

Every push to `main` runs `.github/workflows/publish.yml`: typecheck, tests, then a registry check that publishes only when `package.json` names a version the registry does not have. Authentication uses npm trusted publishing (OIDC) with provenance; the repository stores no token.

```bash
npm version patch --no-git-tag-version
git commit -am "release: v<version>"
git push
```

## License

[MIT](LICENSE) © 2026 butfool
