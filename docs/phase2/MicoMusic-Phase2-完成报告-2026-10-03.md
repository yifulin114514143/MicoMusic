# Phase 2 — 插件系统审计与 Liquid Glass 可行性验证完成报告

日期：2026-10-03。

## 完成结论

阶段二的源码审计、隔离运行验证和插件能力地图已完成。**独立视觉插件路线可行**：真实 renderer 页面已验证 CSS 覆盖、Vue scoped 覆盖、Hash 路由与 DOM 更新监听、插件自有实时开关、设置跨进程持久化、body 弹窗和独立歌词窗口注入。

正式 Liquid Glass 插件留在阶段三实现。阶段二的探针只用于能力验证，颜色、模糊和圆角不是正式设计。

## 已交付

| 成果 | 文件与原因 |
| --- | --- |
| 能力地图 | [MicoMusic-Phase2-插件能力地图.md](MicoMusic-Phase2-插件能力地图.md)：覆盖总纲十项审计要求、纯插件区域、最小宿主适配、业务边界、上游风险及性能门槛 |
| 可复现验证 | [运行器](../../scripts/run-extension-audit.mjs) 和 [Electron 审计入口](../../scripts/audit-extension-capabilities.mjs)：验证真实扩展管理器、IPC 与生产 Vue bundle，而不是仅检查源码文本 |
| 测试探针 | [Manifest V3 探针](../../tests/fixtures/phase2-visual-probe/manifest.json)：CSS、内容脚本、MV3 worker、设置与弹窗开关；放在测试 fixture 中，不自动安装到用户应用 |
| 隔离预加载 | [phase2-preload.cjs](../../tests/fixtures/phase2-preload.cjs)：复用实际 preload，只在测试配置内预先结束新手引导以免遮挡 |
| 原始结果 | `evidence/` 的 JSON、截图及 [原生交互记录](evidence/原生交互记录.md)；生成的 profile 和临时目录位于 `artifacts/phase2-runtime/` 并被 Git 忽略 |

本次新增文件均保存于 `/Users/mico/AI 事物/MicoMusic-阶段二`。原源码工作树和两个正在运行的原版 / MicoMusic 服务保留；测试创建自己的配置目录和 API 子进程，结束后停止自己的进程。

## 测试结果

- `npm run test:identity`：已有 7 项身份 / 协议 / API 隔离测试通过。
- `npm run build`：生产构建通过；保留已有资源包体积和浏览器兼容数据提示，未扩大到依赖升级。
- 阶段二自动审计：**41 / 41 项断言通过**，其中包含对现有缺陷的事实复现；数量不表示这些缺陷已经修复。
- Electron 退出并重启后：同一插件设置保留，关闭状态未应用探针样式。
- 原生 Computer Use：真实点击探针关闭和开启按钮，读取 `enabled: false / true` 的保存结果；主窗口实际返回首页推荐和发现内容，播放队列可展开。
- 修改文件的 JavaScript 语法、JSON、Markdown 本地链接及 Git 差异检查完成。

本次没有真实账号登录、完整音乐播放、组队、识曲、其他用户插件、多平台安装或正式主题视觉验收。隔离宿主复用真实 renderer、preload 和扩展代码，但没有实现完整播放器主进程；短期 RAF 记录不是长期性能验收。

## 阶段三前置事项

1. **先修复卸载目录边界**：空目录参数删除插件根目录的缺陷已在本次测试目录中复现。
2. **修复插件系统重启**：清理调用缺少 `await`，当前重启后没有重新加载。
3. **定义视觉清理与开关契约**：卸载后当前文档仍保留 CSS 和监听器；开关不能通过刷新播放器实现。
4. **处理首屏加载、错误反馈和内置插件分发**：当前先打开窗口再异步加载插件，部分加载失败仍报告成功，安装包没有内置主题资源路径。
5. 在以上边界闭合后建立正式插件，再进入阶段四的主框架设计和性能验证。

## Git 与范围

原工作树：`/Users/mico/MicoMusic/MoeKoeMusic`，仍为 `feature/mico-project-docs`。

阶段二工作树：`/Users/mico/AI 事物/MicoMusic-阶段二`。

阶段二分支：`feature/阶段二-插件能力审计`。中文名称为“阶段二：插件系统审计与液态玻璃可行性验证”；从 Phase 1 的 `da5ec4a` 创建，集中保留本阶段证据，便于独立审阅。完成后保留分支与工作树，不自动合并到 `main`。

本阶段提交只包含审计文档、验证脚本、测试探针和隔离输出忽略规则，未修改生产播放器、插件管理器及 API 子模块。未推送、未创建 PR、未合并或发布安装包。提交记录可通过本分支的 `git log -1` 核对。

外部开发总纲及规划索引同步阶段状态，继续保持在原规划目录，不纳入源码提交。
