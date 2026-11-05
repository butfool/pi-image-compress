<div align="center">

<h1>pi-image-compress</h1>

<p><strong>在图片写进会话历史之前统一转成 WebP，让截图密集的会话继续通过反向代理的请求体上限。</strong></p>

<p>Pi 扩展 · Pi 1.5.0 以上 · Node.js 22.19 以上</p>

<p>
  <a href="README.md">English</a> ·
  <strong>简体中文</strong>
</p>

[![npm](https://img.shields.io/npm/v/pi-image-compress?logo=npm&logoColor=white&label=npm&color=CB3837)](https://www.npmjs.com/package/pi-image-compress) [![Pi package](https://img.shields.io/badge/Pi-package-000000)](https://pi.dev/packages/pi-image-compress) [![License](https://img.shields.io/badge/license-MIT-3DA639?logo=opensourceinitiative&logoColor=white)](LICENSE) [![Node](https://img.shields.io/badge/node-22.19%2B-5FA04E?logo=nodedotjs&logoColor=white)](https://nodejs.org)

</div>

---

## 项目简介

Pi 会把进入会话的图片全部保留在对话历史中，并且每一轮请求都重发整段历史：`read` 读到的截图、MCP 工具返回的图片、用户贴进提示词的图片，都会随请求再次上传。一张 2000×1270 的 PNG 截图编码成 base64 是 593,000 字节，攒到几十张就会超过反向代理的请求体上限，此后这个会话的每次请求都返回 413。

`pi-image-compress` 挂在图片进入上下文的两处入口，把图片重新编码为 WebP：先缩放进 1536×2048 的方框，再把质量逐级下调，直到 base64 长度不超过 120 KiB。本来就在方框内、体积又足够小的图片原样透传。安装扩展之前已经写进历史的图片不会被改写。

在一批 36 张真实界面截图上，同一个会话的图片总量从 19.50 MB 降到 2.35 MB，平均每张 64 KiB。模型对压缩后截图里的一张表格逐行转录，结果与原图一致。

## 功能

- 覆盖两类入口：任意工具结果里的图片（`read`、MCP 工具、codemode 的 `image()`），以及随提示词附加的图片（TUI 粘贴、`@file`、RPC 调用）。
- 先把图片缩放进 1536×2048，再按 82、74、66、58、50 的顺序逐级尝试 WebP 质量，直到 base64 长度不超过 120 KiB。
- 已经在方框内且不超过 30 KiB 的图片原样透传，一个字节都不改。
- 工具结果里的图片发生缩放时，追加一行原始尺寸与坐标换算倍数，让模型能把压缩图上的点击位置映射回原图。
- 把 `read` 工具写入的 `Read image file [image/png]` 改写为实际发送的格式。
- 无法压到上限以内时抛出错误，Pi 会报告扩展错误。

## 快速开始

```bash
pi install npm:pi-image-compress
```

打开 `~/.pi/agent/settings.json`，把下面这段合并进去，让 Pi 不再自行缩放图片：

```json
{
  "images": {
    "autoResize": false
  }
}
```

执行 `/reload` 或重启 Pi。此后进入会话的图片都会被压缩。

> [!IMPORTANT]
> 保持 `images.autoResize` 的默认值 `true` 时，Pi 会继续运行自己的图片处理流程。`read` 路径上的截图会先被 Pi 缩放并重新编码，随后扩展再处理一次：同一张图片被编码两次，第二次的起点经过了第一次的重采样。

## 安装

### npm

```bash
pi install npm:pi-image-compress
```

### 临时试用

```bash
pi -e npm:pi-image-compress
```

`-e` 只在本次启动加载扩展，不写入设置文件。

### 本地源码

```bash
git clone https://github.com/butfool/pi-image-compress.git
cd pi-image-compress
npm install
pi install .
```

本地包按路径直接加载，`npm install` 为这份检出安装 `sharp`。

### 更新与卸载

```bash
pi update --extensions
pi remove npm:pi-image-compress
```

`pi list` 显示当前配置的软件包。

> [!NOTE]
> 需要 Pi 1.5.0 以上与 Node.js 22.19 以上。

## 配置

扩展本身没有配置项，压缩策略固定在 `index.ts`：

| 常量 | 取值 | 作用 |
|---|---|---|
| `MAX_WIDTH` × `MAX_HEIGHT` | 1536 × 2048 | 保持长宽比缩放进方框。宽度上限保证文字可读，高度上限放宽，竖屏截图不会被压成窄条。 |
| `QUALITIES` | 82 → 74 → 66 → 58 → 50 | 在同一个尺寸下逐级尝试，落在字节上限内就停止。界面截图通常停在 82。 |
| `MAX_BASE64_BYTES` | 122880（120 KiB） | 单张图片的 base64 上限。五档质量全部放不下时，尺寸按 25% 递减后重新尝试。 |
| `SMALL_BASE64_BYTES` | 30720（30 KiB） | 在方框内且不超过这个值的图片原样透传，避免重新编码反而变大。 |

需要不同的体积上限时，可以修改常量并发布自己的一份包。`compressImage` 与这些常量都已导出，测试可以直接断言。

## 工作原理

两个钩子覆盖图片进入上下文的路径：

| 钩子 | 覆盖范围 | 具体动作 |
|---|---|---|
| `tool_result` | 工具返回的内容：`read`、MCP 工具、codemode 的 `image()` | 替换图片块的编码，为缩放过的图片追加尺寸注解，改写 `Read image file [...]` 行 |
| `input` | 随提示词附加的图片：TUI 粘贴、`@file` 参数、RPC 调用 | 替换图片块的编码并返回 `transform`，提示词正文保持不变 |

单张图片的处理：

- 本来就是 WebP、尺寸在方框内、base64 不超过 120 KiB：不改动。
- 尺寸在方框内、base64 不超过 30 KiB：不改动。
- 其余情况：缩放进方框，按质量阶梯编码；五档全部超出上限时，尺寸按 25% 递减后重新尝试。
- 输出尺寸小于原图时，在图片后面追加一个文本块：`[Image: original WxH, displayed at WxH. Multiply coordinates by N to map to original image.]`

压缩失败会抛出错误。Pi 记录一条扩展错误并保留原始图片，这次请求仍然会带着超限的图片发出。

## 为什么选择 WebP

OpenAI 与 Anthropic 的视觉接口都只接受固定的格式集合：PNG、JPEG、GIF、WebP。AVIF 的压缩率更高，上游网关会直接拒绝：

```
{"message":"... one of the supported image formats:
 ['image/jpeg', 'image/png', 'image/gif', 'image/webp']"}
```

同一张 1536×975 的界面截图，WebP q82 实测 66 KiB，AVIF q60 实测 54 KiB。12 KiB 的差距不足以承担格式被拒的代价。

## 实测数据

同一批 36 张真实截图，统计口径是会话里保存的 base64 长度：

| 处理链路 | 合计 | 平均 |
|---|---|---|
| Pi 默认（2000 像素方框，PNG/JPEG q80） | 19.50 MB | 529 KiB |
| Pi 配置为 1536 像素方框、256 KiB JPEG 上限 | 6.02 MB | 163 KiB |
| `pi-image-compress`（1536 像素方框，WebP） | 2.35 MB | 64 KiB |

单张 2000×1270 的截图从 593,000 字节降到 69,256 字节。模型对其中表格的逐行转录与原图一致。

## 失败模式

- **扩展没有加载**（`pi -ne`、安装失败）：图片按原样进入会话，单张回到几百 KB 的量级，几十张之后重新出现 413。
- **图片压不进 120 KiB**：质量 50 并反复缩小尺寸之后仍然超限时，`compressImage` 抛出错误，Pi 记录一条扩展错误，原始图片仍然进入结果。这次请求的体积不受扩展控制，扩展错误是唯一的提示。

## 开发

```bash
git clone https://github.com/butfool/pi-image-compress.git
cd pi-image-compress
npm install
npm run typecheck
npm test
```

`npm test` 用 `node --test` 运行 `tests/compress.test.mjs`，借助 Node 内置的类型剥离加载 `index.ts`。六个用例覆盖导出的 `compressImage` 与两个钩子：2400×1600 的 PNG 转成上限内的 WebP 并缩放到 1536×1024、小图原样透传、`tool_result` 钩子改写图片与注解与格式行、没有图片的结果被忽略、`input` 钩子对大图返回 `transform`、对小图返回 `continue`。

### 发布

推送到 `main` 会运行 `.github/workflows/publish.yml`：先做类型检查与测试，再查询 registry，只有 `package.json` 里的版本尚不存在时才发布。认证使用 npm trusted publishing（OIDC）与 provenance，仓库里不保存任何 token。

```bash
npm version patch --no-git-tag-version
git commit -am "release: v<version>"
git push
```

## 许可证

[MIT](LICENSE) © 2026 butfool
