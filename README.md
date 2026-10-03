<p align="center">
  <img src="public/assets/images/mico/mico-app-icon-512.png" alt="MicoMusic 米可应用图标" width="128">
</p>

# MicoMusic

**以米可（Mico）为角色主题的二次元音乐播放器。**

MicoMusic 基于 [MoeKoeMusic](https://github.com/MoeKoeMusic/MoeKoeMusic) 独立维护，使用 Electron 桌面框架和 Vue 页面框架，保留上游音乐功能并持续跟进上游源码更新。角色视觉以已经确认的米可素材为基准：黑长直、蓝紫色眼睛、黑白主体服装、金属 M 标识，以及温柔安静的陪伴感。

当前完成 **Phase 1 — 品牌初始化**和 **Phase 2 — 插件系统审计与 Liquid Glass 可行性验证**。独立视觉插件的 CSS 注入、实时开关和设置持久化已验证；正式 Liquid Glass（液态玻璃视觉效果）插件在阶段三实现，先处理审计确认的插件生命周期缺陷。

## 当前使用方式

MicoMusic 暂未发布自己的安装包。目前通过源码开发或本地构建使用。仓库保留的 `1.7.0` 是当前代码版本；它不代表已经发布 MicoMusic 1.7.0。

- [快速开始与按键说明](QUICK_START.md)
- [贡献与开发说明](CONTRIBUTING.md)
- [应用身份、数据目录和上游关系](UPSTREAM.md)
- [品牌素材与引用位置](BRAND_ASSETS.md)
- [阶段二插件能力地图](docs/phase2/MicoMusic-Phase2-插件能力地图.md)
- [阶段二完成报告与验证边界](docs/phase2/MicoMusic-Phase2-完成报告-2026-10-03.md)
- [问题反馈](https://github.com/yifulin114514143/MicoMusic/issues)

## 项目能力

代码中保留了酷狗登录、在线搜索、首页推荐、歌单和收藏、本地音乐、云盘、歌词、MV、主题设置、新手引导及扩展管理等入口。在线内容与账号权限以音乐服务实际返回结果为准。

本阶段的品牌改造包括：

- MicoMusic 展示名称、应用图标、M 字母标识和托盘图标。
- Q 版米可新手引导，以及首页、发现页、音乐库、本地音乐和云盘的角色插图。
- 默认头像、缺省封面、关于信息和安装侧栏。
- 独立安装标识 `io.github.yifulin114514143.micomusic` 和应用链接 `micomusic://`。
- 与 MoeKoe Music 分开的本地数据目录；不自动迁移原版数据。
- 更新检查指向本仓库；没有发布包时显示尚未发布。
- 分享按钮暂时复制推荐文字，组队分享复制邀请码；不生成旧网站链接。

## 源码开发

需要 Node.js 20 或更新版本及 Git。`api/` 是独立的酷狗 API 子模块，需要初始化并安装它自己的依赖。

```sh
git clone --recurse-submodules https://github.com/yifulin114514143/MicoMusic.git
cd MicoMusic
npm run install-all
```

开发时在三个终端分别运行：

```sh
npm run api
npm run serve
npm run electron:serve
```

API 开发服务使用 `6521`，前端开发服务使用 `8080`。如果原版应用占用了 `6521`，先退出原版再启动上述开发服务。打包后的 MicoMusic 自动分配独立 API 端口，支持与原版同时运行。

## 验证与本地构建

```sh
npm run test:identity
npm run build
```

已有适合当前平台的 `api/bin` 可执行文件时，可构建 Apple Silicon 测试应用：

```sh
npm run electron:build -- --dir --mac --arm64 --publish never
```

输出位于 `dist_electron/mac-arm64/MicoMusic.app`。完整平台构建脚本见 `package.json`，执行前需要核对 API 二进制的架构。当前 macOS 配置未签名，在线安装更新和多平台安装体验需在正式发布前验证。

GitHub 工作流目前只提供手动构建和测试产物保存，不自动发布安装包。

## 项目目录

| 技术路径 | 中文用途 |
| --- | --- |
| `src/` | Vue 页面、公共组件和播放器逻辑 |
| `electron/` | 桌面主进程、预加载脚本和系统服务 |
| `public/assets/images/mico/` | 已接入页面的米可素材与应用图标 |
| `build/` | 应用图标及安装器资源 |
| `api/` | KuGouMusicApi 子模块，保持独立来源 |
| `plugins/extensions/` | 开发时的扩展目录 |
| `tests/` | 安装身份、链接、API 隔离测试及阶段二视觉验证探针 |
| `docs/phase2/` | 插件能力地图、完成报告、复现方法和隔离验证证据 |
| `docs/README_*.md` | 多语言项目介绍入口 |

已有规划文档保存在 `/Users/mico/MicoMusic/规划文档`，角色母版和制作记录保存在 `/Users/mico/MicoMusic/看板娘`。本次阶段二按照当前用户指令，将新增文件保存在 `/Users/mico/AI 事物/MicoMusic-阶段二` 工作树中；原规划目录仅同步已有总纲和索引。

## 来源与许可

MicoMusic 的基础代码来自 MoeKoeMusic，保留原项目历史、作者信息和版权说明。酷狗 API 来自 [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi)。

主项目沿用 [GPL-2.0 许可证](LICENSE)。第三方依赖、音乐内容与其他素材的权利说明以各自来源为准。原版使用文档可作为功能参考，MicoMusic 的名称、数据目录、更新入口和分享状态以本仓库文档为准。

MicoMusic 是第三方客户端，并非酷狗官方客户端。
