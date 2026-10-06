# 阶段三交付与复现

整理日期：2026-10-07。实现和最终自动验证在 2026-10-06 完成。

- [完成报告](MicoMusic-Phase3-完成报告-2026-10-07.md)
- [插件能力与宿主契约](MicoMusic-Phase3-插件能力与宿主契约.md)
- [154 项隔离运行断言](evidence/summary.json)
- [完整 App 打包核对](evidence/package.json)
- [原生交互记录](evidence/原生交互记录.md)
- [玻璃开关演示](evidence/玻璃开关演示.mp4)及[采集数据](evidence/玻璃开关演示-录制数据.json)

## 自动复现

在本工作树根目录使用现有依赖运行：

```sh
npm run test:phase3
npm run test:identity
npm run build
MICO_PHASE3_API_BINARY='/Users/mico/MicoMusic/MoeKoeMusic/api/bin/app_macos' npm run validate:phase3
```

`MICO_PHASE3_API_BINARY` 是验证运行器新定义的环境变量，必须指向本机已经存在的 API 二进制。当前脚本只实现 macOS；其他机器先核对实际二进制路径和架构，不沿用记录中的端口、进程或扩展 ID。

[运行器](../../scripts/run-phase3-validation.mjs)将已安装的 Electron.app 复制到忽略的 `artifacts/phase3-runtime/validation-runtime`，再将受版本管理的正式插件放入复制运行时的 Resources。原始 node_modules/Electron.app 不修改。每次创建新的隔离 profile，完整执行七个进程；前四个进程复用该次 profile，三个启动故障另用新 profile。只删除本次测试安装的插件目录，不进入正常 App 数据目录。

运行使用真实 dist/Vue、扩展管理器、IPC、内置资源分发和 API；验证入口不是完整 App 主进程。技术音频由 PCM 生成，用于确认常规开关及重载不重建媒体对象、不刷新文档，不能替代酷狗歌曲播放验收。脚本检查每个进程退出码、结果错误和两种文件指纹，任何一项失败都不能作为最终通过结果。

重跑会更新本目录 JSON、截图和日志；`.log` 及运行时目录被忽略。已有阶段二脚本用于复现当时缺陷，当前行为以本阶段断言为准，详见[阶段二历史说明](../phase2/README.md)。

## 查看本地完整 App

产物为 [MicoMusic.app](../../dist_electron/mac-arm64/MicoMusic.app)。它使用正常 MicoMusic 配置，已通过原生启动和设置入口检查；隔离验证不使用该配置。入口为“头像 → 设置 → 插件 → MicoMusic 液态玻璃 → 设置”。

本次依赖软链接工作树打包使用原仓库的依赖收集入口和本工作树的 dist、electron、图标及插件资源。实际临时配置为 `artifacts/phase3-runtime/preview-build.json`，输出仍在本工作树；该文件不作为跨机器构建配置提交。已从原仓库工作目录执行：

```sh
node_modules/.bin/electron-builder --dir --mac --arm64 --publish never --config '/Users/mico/AI 事物/MicoMusic-阶段三/artifacts/phase3-runtime/preview-build.json'
```

打包核对记录 107 个文件与当前工作树字节一致，以及运行依赖、bundle ID 和架构。该产物是未签名的本地测试 App；Electron 为 arm64，内置 API 仍为 x86_64。本阶段没有推送、合并或发布。
