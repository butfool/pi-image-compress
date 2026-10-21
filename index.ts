import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ImageContent } from "@earendil-works/pi-ai";
import sharp from "sharp";

// 扩展是唯一的图片编码器：settings.json 里 images.autoResize 已关闭，
// 因此 pi 不做任何缩放与编码，原始字节直接到这里。
const MAX_WIDTH = 1536;
const MAX_HEIGHT = 2048;

// base64 长度上限。代理侧 client_max_body_size 是 10M，单幅压到这个量级
// 才能让一个会话累积几十幅截图仍然通过；压不下来就抛错，让问题暴露。
const MAX_BASE64_BYTES = 122880;

// 小图（图标、缩略图）保持原样，避免重编码反而变大。
const SMALL_BASE64_BYTES = 30720;

// 逐级下降直到落在字节上限内；截图类图片通常停在第一档。
const QUALITIES = [82, 74, 66, 58, 50];

const base64Length = (bytes: Buffer) => Math.ceil(bytes.byteLength / 3) * 4;

function fitInside(width: number, height: number) {
  let w = width;
  let h = height;
  if (w > MAX_WIDTH) {
    h = Math.round((h * MAX_WIDTH) / w);
    w = MAX_WIDTH;
  }
  if (h > MAX_HEIGHT) {
    w = Math.round((w * MAX_HEIGHT) / h);
    h = MAX_HEIGHT;
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

async function encodeWebp(input: Buffer, width: number, height: number) {
  for (const quality of QUALITIES) {
    const bytes = await sharp(input)
      .rotate()
      .resize({ width, height, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    if (base64Length(bytes) <= MAX_BASE64_BYTES) {
      return bytes;
    }
  }
  return null;
}

interface Compressed {
  block: ImageContent;
  width: number;
  height: number;
  scaledDownFrom?: { width: number; height: number };
}

/** 返回 null 表示这张图不需要改动。 */
async function compress(block: ImageContent): Promise<Compressed | null> {
  const input = Buffer.from(block.data, "base64");
  const meta = await sharp(input).metadata();
  const original = { width: meta.width ?? 0, height: meta.height ?? 0 };
  if (!original.width || !original.height) {
    throw new Error("图片尺寸无法解码");
  }

  const withinBox = original.width <= MAX_WIDTH && original.height <= MAX_HEIGHT;
  const size = base64Length(input);
  if (
    (block.mimeType === "image/webp" && withinBox && size <= MAX_BASE64_BYTES) ||
    (withinBox && size <= SMALL_BASE64_BYTES)
  ) {
    return null;
  }

  let target = fitInside(original.width, original.height);
  let bytes = await encodeWebp(input, target.width, target.height);
  while (bytes === null) {
    const nextWidth = target.width === 1 ? 1 : Math.max(1, Math.floor(target.width * 0.75));
    const nextHeight = target.height === 1 ? 1 : Math.max(1, Math.floor(target.height * 0.75));
    if (nextWidth === target.width && nextHeight === target.height) {
      break;
    }
    target = { width: nextWidth, height: nextHeight };
    bytes = await encodeWebp(input, target.width, target.height);
  }

  if (bytes === null) {
    throw new Error(
      `图片无法压进 ${MAX_BASE64_BYTES} 字节的 base64 上限（原始 ${original.width}x${original.height}）`,
    );
  }

  const encoded = bytes.toString("base64");
  if (encoded === block.data && block.mimeType === "image/webp") {
    return null;
  }

  const scaledDown = target.width < original.width || target.height < original.height;
  return {
    block: { type: "image", data: encoded, mimeType: "image/webp" },
    width: target.width,
    height: target.height,
    scaledDownFrom: scaledDown ? original : undefined,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (!event.content.some((block) => block.type === "image")) {
      return;
    }

    const content: typeof event.content = [];
    let changed = false;

    for (const block of event.content) {
      if (block.type !== "image") {
        content.push(block);
        continue;
      }

      const result = await compress(block);
      if (!result) {
        content.push(block);
        continue;
      }

      content.push(result.block);
      if (result.scaledDownFrom) {
        const original = result.scaledDownFrom;
        const scale = original.width / result.width;
        content.push({
          type: "text",
          text:
            `[Image: original ${original.width}x${original.height}, displayed at ` +
            `${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} ` +
            `to map to original image.]`,
        });
      }
      changed = true;
    }

    if (!changed) {
      return;
    }

    // read 工具会写一行 “Read image file [image/jpeg]”；转成 WebP 后要把格式改成实际值。
    const rewritten = content.map((block) =>
      block.type === "text"
        ? { ...block, text: block.text.replace(/^Read image file \[image\/[a-z]+\]/, "Read image file [image/webp]") }
        : block,
    );
    return { content: rewritten };
  });

  pi.on("input", async (event) => {
    if (!event.images || event.images.length === 0) {
      return { action: "continue" as const };
    }

    const images: ImageContent[] = [];
    let changed = false;
    for (const image of event.images) {
      const result = await compress(image);
      images.push(result?.block ?? image);
      changed ||= result !== null;
    }

    if (!changed) {
      return { action: "continue" as const };
    }
    return { action: "transform" as const, text: event.text, images };
  });
}
