# Changelog

## [1.0.1] - 2026-11-03

- Publish automatically on every push to `main` when the version is new, using npm trusted publishing with provenance.
- Document the release flow.

## [1.0.0] - 2026-11-03

- First public release on npm.
- Compress tool-result and attached images to WebP at the entries where images enter the context.
- Scale images into 1536x2048, step quality down until the base64 payload fits 120 KiB, and pass small images through untouched.
- Annotate scaled images with the original dimensions and the coordinate multiplier.
- Rewrite the `read` tool's image format line to the actual encoding.
- Fail loudly when an image cannot be compressed under the size limit.
- Export `compressImage` and the size limits so the pipeline can be tested without a running Pi session.
