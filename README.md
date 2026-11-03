# pi-image-compress

把进入 Pi 会话的图片在写进历史之前统一压成 WebP，让一个会话累积几十幅截图仍然能通过反向代理的请求体上限。

## 解决的问题

Pi 会把工具结果里的图片（`read` 读取的截图、MCP 工具返回的图片、codemod `image()`）原样存进会话历史，并在**每一轮请求里重发整段历史**。一张 2000×1270 的 PNG 截图编码成 base64 是 593,000 字节，三十几幅就超过反向代理的请求体上限，请求被 413 拒绝；即使没触到上限，传输体积和首字节延迟也会随会话线性增长。

这个扩展在图片进入上下文的入口把它们统一转成 WebP，并把尺寸与字节数压到模型视觉编码器实际可用的范围之内。

## 安装

```bash
pi install npm:pi-image-compress
```

安装后执行 `/reload` 或重启 Pi。

### 配套配置

必须同时关闭 Pi 自己的图片处理，否则一张图会被编码两次（Pi 先出 PNG/JPEG，扩展再出 WebP）：

```json
// ~/.pi/agent/settings.json
"images": { "autoResize": false }
```

关闭之后 Pi 不做任何缩放与编码，扩展成为唯一编码器，一张图只经历一次有损压缩。

## 行为

挂两个钩子，覆盖图片进入上下文的两条路：

| 钩子 | 覆盖对象 |
|---|---|
| `tool_result` | 任何工具结果里的图片：`read`、MCP 工具、codemod `image()` |
| `input` | 用户在 TUI 里手贴或 `@文件` 附加的图片 |

处理规则：

| 常量 | 值 | 说明 |
|---|---|---|
| `MAX_WIDTH` / `MAX_HEIGHT` | 1536 / 2048 | 等比缩放到框内；宽度决定文字可读性，高度放宽以免竖屏截图被压成窄条 |
| `QUALITIES` | 82 → 74 → 66 → 58 → 50 | 逐级下降直到落在字节上限内，截图通常停在 q82 |
| `MAX_BASE64_BYTES` | 122880（120 KiB） | 单幅 base64 上限 |
| `SMALL_BASE64_BYTES` | 30720（30 KiB） | 小于此值的图原样透传，避免重编码反而变大 |

附加处理：

- 缩放后补一行 `[Image: original WxH, displayed at WxH. Multiply coordinates by N to map to original image.]`，让模型能把点击坐标换回原图；
- 把 `read` 写入的 `Read image file [image/png]` 改写成实际的 `image/webp`；
- 压不进字节上限时抛出错误，由 Pi 报扩展错误，让问题暴露，而不是把未压缩的图片发出去。

## 为什么是 WebP

OpenAI 与 Anthropic 接受的图片格式白名单都止于 PNG、JPEG、GIF、WebP。AVIF 压缩率更低，但上游直接以 400 拒绝：

```
{"message":"... one of the supported image formats:
 ['image/jpeg', 'image/png', 'image/gif', 'image/webp']"}
```

实测同一张 1536×975 的 UI 截图：WebP q82 为 66 KiB，AVIF q60 为 54 KiB，差距不足以换取格式风险。

## 实测效果

同一批 36 张真实截图：

| 方案 | 合计 | 平均 |
|---|---|---|
| Pi 默认（2000 上限、PNG） | 19.50 MB | 529 KiB |
| Pi 的 JPEG 路径（1536 上限、256 KiB） | 6.02 MB | 163 KiB |
| 本扩展（1536 上限、WebP） | 2.35 MB | 64 KiB |

单张对比：593,000 字节 → 69,256 字节，模型对表格逐行转录的结果与原图完全一致。

## 失败模式

扩展缺席（`pi -ne`、加载失败）时图片零压缩，请求体回到 593 KiB/幅的量级，约 26 幅就会撞上反向代理的上限并被 413 拒绝。这是有意的：压缩链路一旦断掉，问题以请求被拒的形式暴露，而不是静默发送一个更大的请求体。

## 环境要求

- Pi 1.5.0 或更新版本
- Node.js 22 或更新版本

## 开发

```bash
npm install
npm run typecheck
npm test
```

`npm test` 用 `node --test` 直接运行 `tests/compress.test.mjs`，通过导出的 `compressImage` 与两个钩子的假 `ExtensionAPI` 验证：大图转 WebP 并落在字节上限内、小图原样透传、`tool_result` 的注解与格式改写、`input` 钩子的 transform 与 continue 分支。

## 发布

向 `main` 推送即触发发布。工作流使用 npm trusted publishing（OIDC）与 provenance，仓库里不保存任何 token。

只有 `package.json` 的版本在 registry 上尚不存在时才会真正发布，因此普通提交不会产生新版本：

```bash
npm version patch --no-git-tag-version
git commit -am "release: v1.0.1"
git push
```

## License

MIT
