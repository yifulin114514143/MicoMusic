# 阶段二审计资料与复现

> 2026-10-07 更新：本目录保留阶段二历史证据及缺陷复现口径。卸载、重启、内置视觉生命周期和分发已在阶段三修复，当前行为以[阶段三交付与复现](../phase3/README.md)及其正确行为断言为准。下列阶段二运行器含历史缺陷预期，不作为修复后版本的通过要求；未改写原始证据。

- [完成报告](MicoMusic-Phase2-完成报告-2026-10-03.md)
- [插件能力地图](MicoMusic-Phase2-插件能力地图.md)
- [41 项自动断言摘要](evidence/summary.json)
- [原生交互记录](evidence/原生交互记录.md)

## 运行环境

使用本仓库已安装的 Node.js、Electron 和依赖。先从当前代码构建生产页面，再运行审计：

```sh
npm run test:identity
npm run build
MICO_PHASE2_API_BINARY='/Users/mico/MicoMusic/MoeKoeMusic/api/bin/app_macos' node scripts/run-extension-audit.mjs
```

`MICO_PHASE2_API_BINARY` 是审计脚本新定义的输入，指定当前机器上实际存在的内置 API 可执行文件；不是产品配置键。在其他机器上先核对二进制准确位置及平台，再传入该机器的路径。

运行器为每次审计创建新的 `artifacts/phase2-runtime/run-*` 隔离配置，使用系统分配的本地 API 端口；不会进入正常应用的用户数据目录。审计包括调用现有卸载函数删除**本次创建的测试扩展目录**以复现目录边界缺陷，因此不要绕过运行器把正常用户配置传给 Electron 入口。

`capabilities` 与 `persistence` 分别由两个 Electron 进程执行，复用本次隔离 profile 以检查设置持久化。运行器核对进程退出码及结果 JSON 的 `failure`，两者任一失败均不能生成通过摘要。

结果写入 `docs/phase2/evidence/`。运行日志为 `.log`，按仓库已有规则忽略；JSON 和选定图片纳入本阶段提交。每次重新运行会更新这些证据，并记录当时的准确基线、Electron 和 Chromium 版本。

## 原生交互模式

```sh
phase2_profile=$(mktemp -d "$PWD/artifacts/phase2-runtime/manual-XXXXXX")
ELECTRON_IS_DEV=0 node_modules/.bin/electron scripts/audit-extension-capabilities.mjs "$phase2_profile" manual '/Users/mico/MicoMusic/MoeKoeMusic/api/bin/app_macos'
```

该模式打开隔离主窗口及探针弹窗。可点击“关闭验证样式”“开启验证样式”核对设置，再检查实际页面。关闭测试主窗口后，入口卸载测试扩展并停止本次 API 子进程。

自动审计中的负向断言记录的是基线现存问题；阶段三修复后，应同时更新相应断言和能力地图，不把复现缺陷的通过结果当作正确行为要求。
