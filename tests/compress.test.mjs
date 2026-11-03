import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import extension, { MAX_BASE64_BYTES, MAX_WIDTH, compressImage } from "../index.ts";

function loadHandlers() {
  const handlers = new Map();
  extension({ on: (name, handler) => handlers.set(name, handler) });
  return handlers;
}

async function screenshot(width, height) {
  const rows = Array.from({ length: 40 }, (_, index) => {
    const barWidth = Math.round(width * (0.2 + (index % 7) * 0.08));
    const fill = index % 2 === 0 ? "#333333" : "#6b7280";
    return `<rect x="40" y="${40 + index * 30}" width="${barWidth}" height="12" fill="${fill}"/>`;
  }).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect width="100%" height="100%" fill="#f5f5f5"/>` +
    `<rect x="0" y="0" width="${width}" height="24" fill="#1f2937"/>` +
    rows +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function tinyPng() {
  return sharp({ create: { width: 120, height: 80, channels: 3, background: "#3366cc" } }).png().toBuffer();
}

test("large screenshots become a capped WebP", async () => {
  const png = await screenshot(2400, 1600);
  const result = await compressImage({ type: "image", data: png.toString("base64"), mimeType: "image/png" });

  assert.ok(result, "expected the image to be recompressed");
  assert.equal(result.block.mimeType, "image/webp");
  assert.ok(result.block.data.length <= MAX_BASE64_BYTES, "base64 payload stays under the cap");
  assert.equal(result.width, MAX_WIDTH);
  assert.equal(result.height, 1024);
  assert.deepEqual(result.scaledDownFrom, { width: 2400, height: 1600 });

  const meta = await sharp(Buffer.from(result.block.data, "base64")).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, result.width);
  assert.equal(meta.height, result.height);
});

test("images inside the size limit pass through unchanged", async () => {
  const png = await tinyPng();
  const result = await compressImage({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
  assert.equal(result, null);
});

test("tool_result hook rewrites the payload, caption, and format line", async () => {
  const handlers = loadHandlers();
  const png = await screenshot(2400, 1600);

  const output = await handlers.get("tool_result")({
    content: [
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
      { type: "text", text: "Read image file [image/png]" },
    ],
  });

  assert.ok(output, "expected the hook to return new content");
  const image = output.content.find((block) => block.type === "image");
  assert.equal(image.mimeType, "image/webp");

  const caption = output.content.find((block) => block.type === "text" && block.text.startsWith("[Image: original"));
  assert.match(
    caption.text,
    /^\[Image: original 2400x1600, displayed at 1536x1024\. Multiply coordinates by 1\.56 to map to original image\.\]$/,
  );

  const readLine = output.content.find((block) => block.type === "text" && block.text.startsWith("Read image file"));
  assert.equal(readLine.text, "Read image file [image/webp]");
});

test("tool_result hook ignores results without images", async () => {
  const handlers = loadHandlers();
  const output = await handlers.get("tool_result")({
    content: [{ type: "text", text: "no images here" }],
  });
  assert.equal(output, undefined);
});

test("input hook transforms attached images", async () => {
  const handlers = loadHandlers();
  const png = await screenshot(2400, 1600);

  const output = await handlers.get("input")({
    text: "look at this",
    images: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
  });

  assert.equal(output.action, "transform");
  assert.equal(output.text, "look at this");
  assert.equal(output.images[0].mimeType, "image/webp");
});

test("input hook keeps small images untouched", async () => {
  const handlers = loadHandlers();
  const png = await tinyPng();

  const output = await handlers.get("input")({
    text: "look at this",
    images: [{ type: "image", data: png.toString("base64"), mimeType: "image/png" }],
  });

  assert.deepEqual(output, { action: "continue" });
});
