# MicoMusic Phase 2 — 插件能力地图与 Liquid Glass 可行性结论

日期：2026-10-03。审计基线：`da5ec4a3e38961d2a60c1287f77ef19f6ae9af6e`。本机验证版本：Electron `39.2.4`、Chromium `142.0.7444.177`、macOS。

## 结论

独立视觉插件的 **CSS 半透明、背景模糊、圆角、浅深色规则、插件自有设置和实时样式开关** 已在真实生产 Vue 页面上验证。插件可以覆盖主导航、侧栏、主内容、播放器、body 弹窗、消息提示、主窗口全屏歌词外层和独立桌面歌词窗口。

正式插件的默认安装、启动顺序、清理、重载反馈及卸载边界需要宿主适配。当前系统不能直接作为“默认启用、可完整卸载、失败自动回退”的正式 Liquid Glass 交付。阶段三应先完成本地图列出的生命周期修复，再建立正式插件。探针没有定义最终视觉设计。

## 1. 审计要求与证据

| 总纲要求 | 当前真实实现与结论 | 证据 |
| --- | --- | --- |
| 插件加载器 | 开发目录为源码 `plugins/extensions`；生产目录为 `app.getPath('userData')/extensions`。扫描一级目录并调用 `session.defaultSession.loadExtension`，开启 `allowFileAccess: true` | [加载器](../../electron/extensions/extensionManager.js)，隔离目录断言 |
| 清单与权限 | `validateManifest` 要求 `manifest_version === 3`、`name`、`version`，并校验 Native Host 声明；启动扫描只检查三个字段有值，未调用统一校验。普通 `permissions` 和 `host_permissions` 交由 Electron 处理 | [清单校验](../../electron/extensions/extensionManager.js)，[Native Host 校验](../../electron/extensions/nativeHostManager.js) |
| 内容脚本注入范围 | 由 `content_scripts.matches` 控制。探针准确使用 `file:///*` 和 `http://localhost/*`；两种地址均已注入。默认会话的独立歌词窗口也注入成功 | `capabilities.json` 中主窗口、HTTP 和歌词窗口断言 |
| CSS 注入 | `content_scripts.css` 生效，能覆盖 Vue `scoped` 样式；无需引用编译生成的 `data-v-*` 属性 | 各区域的 computed style，探针 CSS |
| 路由和 DOM 更新 | 现有 Vue Router 使用 Hash History；内容脚本可以监听 `hashchange` 和 `MutationObserver`。切换首页、发现、设置后同一文档仍只注入一次 | [真实路由](../../src/router/router.js)，路由和动态节点断言 |
| 设置持久化 | `chrome.storage.local` 的读写、弹窗与内容脚本间通知、退出并重启后的读取已验证。宿主设置与插件设置是两套存储 | `persistence.json`，弹窗开关断言 |
| 启用和禁用 | 管理页没有扩展开关；`get-extensions` 对加载项固定返回 `enabled: true`。探针自己的开关通过限定样式作用范围实现即时恢复 | [管理 IPC](../../electron/extensions/extensionIPC.js)，[管理页](../../src/components/ExtensionManager.vue)，关闭后的 computed style |
| 热重载 | 当前为用户点击刷新后调用 `reload-extensions`，先卸载再加载；没有文件监听。当前文档不重新注入，已有脚本和 CSS 没有清理。重新加载文档后才获得一次新的注入 | `observations.reload`、`removeExtension`、`loadIntoExistingDocument` |
| Electron renderer 边界 | 内容脚本的 `window.electron`、`window.electronAPI` 均为 `undefined`；宿主页面由 preload 暴露这两个对象。插件弹窗使用同一 preload，能够访问其暴露接口，但没有 `require` | `worldBoundary`、`popupBoundary` |
| 稳定扩展 API / Hook | 当前没有专用视觉生命周期、视觉区域、路由或主题扩展契约。现有 CSS class 与 DOM 可以访问，但不构成上游稳定承诺 | [布局](../../src/layouts/HomeLayout.vue)，[preload](../../electron/preload.cjs)，扩展模块与页面源码 |

Electron 官方文档规定扩展仅支持部分 Chrome API；本地图使用项目实际运行结果确定当前能力。`chrome.storage.sync` 和 `chrome.storage.managed` 不属于此版本官方支持范围。[Electron 39.2.4 扩展说明](https://github.com/electron/electron/blob/v39.2.4/docs/api/extensions.md)

探针的 Manifest V3 service worker 已成功响应测试消息；这项能力是本机运行证据，不扩大为对任意 Chrome 插件的兼容承诺。

## 2. 纯插件可以完成的视觉区域

以下 class 均逐一读取自模板，未按名称、大小写或结构推测。实测栏指本次探针覆盖，不表示正式设计验收。

| 区域 | 精确选择器 / 文件 | 覆盖证据与阶段三职责 |
| --- | --- | --- |
| 顶部导航 | `.app-header`；[Header.vue](../../src/components/Header.vue) | 实测 scoped 覆盖；处理玻璃表面、阴影、圆角、浅深色 |
| 侧栏 | `.side-navigation`、`.side-top-actions`；[SidebarNavigation.vue](../../src/components/SidebarNavigation.vue) | 从顶部模式切换后新节点仍可覆盖；处理侧栏及顶部操作表面 |
| 主内容区域 | `.app-main-scroll`、`.main-content-shell`、`.page-route-view`；[HomeLayout.vue](../../src/layouts/HomeLayout.vue) | 主滚动容器实测；兼容当前滚动、页面动画及 KeepAlive 行为 |
| 底部播放器 | `.player-container`、`.player-bar`；[PlayerControl.vue](../../src/components/PlayerControl.vue) | `.player-container` 实测；外观归插件，播放与进度逻辑保留在宿主 |
| body 独立弹窗 | `.modal-overlay`、`.modal`；[CustomModal.vue](../../src/components/CustomModal.vue)、[ModalPlugin.js](../../src/plugins/ModalPlugin.js) | 实际弹窗挂在 `body`，在 `#app` 外也覆盖成功；插件样式不能只限定在 `#app` 下 |
| 消息提示 | `.message-container`、`.message`；[MessageNotification.vue](../../src/components/MessageNotification.vue) | 动态消息的背景和模糊实测；消息创建和销毁继续由宿主负责 |
| 主窗口全屏歌词 | `.lyrics-bg`、`.lyrics-screen`；[PlayerControl.vue](../../src/components/PlayerControl.vue) | 外层实测；背景模式、文字层、封面和设置面板在阶段四继续逐层验证 |
| 独立桌面歌词 | `.lyrics-container`、`.lyrics-panel`；[Lyrics.vue](../../src/views/Lyrics.vue) | 独立默认会话窗口实测。鼠标穿透、窗口拖动、固定尺寸及音频到歌词的数据传递属于宿主职责 |
| 首页卡片 | `.recommend-card`、`.song-item`、`.playlist-item`；[HomeRecommendations.vue](../../src/components/home/HomeRecommendations.vue)、[Home.vue](../../src/views/Home.vue) | 模板已核对，卡片级设计留到页面适配；本次没有逐卡片样式验收 |
| 设置与其他页面 | `.settings-page`、`.discover-page`、`.library-page`、`.search-page`、`.detail-page` | 设置、发现、本地音乐路由已实际运行；登录后的音乐库和搜索结果没有在本次验收 |
| 上下文菜单与队列 | `.context-menu`、`.queue-popup`；[ContextMenu.vue](../../src/components/ContextMenu.vue)、[QueueList.vue](../../src/components/QueueList.vue) | 模板已核对，原生交互已展开空队列；菜单和队列的正式材质适配在阶段四完成 |

视觉插件应限定自己的样式作用范围，关闭时撤回该范围和自有 DOM 改动。当前播放器基础样式本身有模糊：探针关闭后恢复的实测值为 `blur(10px)`、`rgba(255, 255, 255, 0.7)`、圆角 `0px`。**恢复 Default UI 不等于实现高性能模式**；高性能模式须单独验证并消除不需要的基础模糊。

## 3. 必须进行的最小宿主适配

这里只定义职责和完成条件；没有把未实现的新接口名称写成现有 API。

| 优先级 | 真实问题 | 精确证据 | 后续修改范围与验收条件 |
| --- | --- | --- | --- |
| P0 | 空 `extensionDir` 导致删除整个插件根目录 | `uninstallExtension('', '')` 在隔离目录返回删除成功，另一个测试目录也被删除；`extensionManager.js:123` | 在扩展管理器拒绝空目录、根目录和非有效插件目标；仅按已加载插件的精确 ID / 安装路径处理。补目录隔离回归测试 |
| P0 | 插件系统重启没有等待清理 | `extensions.js:57` 的 `cleanupExtensions()` 未 `await`；实测返回 `{ success: true }` 后加载数量为 0 | 在同一生命周期模块等待清理完成再初始化；复测 IPC、扩展与 Native Host 的恢复 |
| P1 | 当前文档卸载后样式及监听仍存活 | 扩展数量归零，但 `hashEvents` 继续增加，播放器仍为 `blur(12px)` 且探针 CSS 标记存在 | 给视觉插件定义可调用的清理生命周期；撤回样式、标记、自有节点和监听，不能用刷新播放器文档作为常规主题开关 |
| P1 | 正常启动时先创建窗口、后异步加载扩展 | [main.js](../../electron/main.js) 中 `createWindow()` 在 `void initializeExtensions()` 前；已打开文档的重新加载扩展不增加注入次数 | 在首个目标文档导航前准备内置视觉插件；插件失败后基础 UI 仍能打开。复测第一次启动和后续启动 |
| P1 | 加载失败被总成功结果掩盖 | 无效 JSON 清单存在时 `reloadExtensions()` 仍返回成功 | 返回逐插件结果和实际失败信息；管理页能准确显示，不把“扫描结束”当作“全部加载成功” |
| P1 | 正式包没有内置插件分发路径 | [package.json](../../package.json) 的 `build.files`、`extraResources`、`extraFiles` 没有包含 `plugins/extensions`；该目录也被 Git 忽略 | 将正式视觉插件明确纳入版本管理及资源打包，定义首次安装、升级、用户设置保留及失败回退；不批量安装未知用户插件 |
| P2 | DOM 和主题扩展点缺少稳定契约 | 主框架使用普通 class、条件挂载、KeepAlive，弹窗存在多个独立 body 根节点 | 为实际需要的主框架区域提供少量语义标记及视觉生命周期；业务逻辑与具体玻璃样式继续留在各自层级 |

这几项问题在本阶段完成了定位与复现；生产宿主源码没有在阶段二修改。正式主题进入默认启用之前必须完成 P0 / P1 条目。

## 4. 不适合由视觉插件接管的业务能力

| 能力 | 真实宿主入口 | 边界 |
| --- | --- | --- |
| 音频、播放状态与进度 | [AudioController.js](../../src/components/player/AudioController.js)、[PlayerControl.vue](../../src/components/PlayerControl.vue) | 插件控制外观；不替换音频对象、不重建播放实例、不改播放状态 |
| 在线、云盘和本地播放队列 | [SongQueue.js](../../src/components/player/SongQueue.js) 及三个 `songQueue` 模块 | 不搬移队列业务，不改变 Store 数据结构 |
| 登录与权限路由 | [store.js](../../src/stores/store.js)、[router.js](../../src/router/router.js) | 保留真实账号状态及登录守卫；未登录搜索仍跳转登录页已验证 |
| 酷狗 API 与设备注册 | [request.js](../../src/utils/request.js)、[apiBaseUrl.js](../../src/utils/apiBaseUrl.js) | 使用宿主已确定的 API 地址和真实数据，不为视觉验证伪造账号或接口响应 |
| 歌词搜索、解析和逐字时间 | [LyricsHandler.js](../../src/components/player/LyricsHandler.js) | 改视觉材质时保持数据和时间同步边界 |
| 本地文件授权、扫描、缓存 | [LocalMusic.vue](../../src/views/LocalMusic.vue)、[LocalMusicQueue.js](../../src/components/player/songQueue/LocalMusicQueue.js) | 文件系统能力由宿主负责；本次只验证无文件夹时的空状态 |
| 桌面窗口、托盘和系统按钮 | [appServices.js](../../electron/appServices.js)、[main.js](../../electron/main.js) | CSS 只能改 renderer DOM；macOS 原生窗口控制按钮不属于插件 DOM。本机 `.titlebar` 未渲染，非 macOS 自定义标题栏需另验 |
| Native Host | [nativeHostManager.js](../../electron/extensions/nativeHostManager.js) | 自定义权限精确为 `moekoe:nativeHost`，授权存于 `nativeHostPermissions`；视觉插件不需要启动本地二进制程序。本次没有验证其他插件的本地程序 |

## 5. 上游同步的兼容风险清单

1. `HomeLayout.vue` 的顶部 / 侧栏条件挂载、`KeepAlive`、页面滚动容器和动画结构。
2. `Header.vue` 与 `SidebarNavigation.vue` 中的独立颜色变量；不能通过近似拼写替代精确变量。
3. `PlayerControl.vue` 的全屏歌词条件节点和内联背景、字号、对齐样式；透明外层不保证全部子层透明。
4. `ModalPlugin.js` 与 `MessagePlugin.js` 在 `body` 下创建独立 Vue 应用，以及 Settings 的 Teleport 弹窗。
5. 独立歌词窗口的默认会话、文件 URL、透明窗口配置及 preload；更换 partition 后需重新验证扩展加载。
6. `extensionIPC.js` 和 `nativeHostManager.js` 目前以 `name` 关联扫描记录与加载记录；同名插件不能被当作稳定身份规则。
7. 插件 ID 与安装路径必须保持明确；本次跨进程验证使用同一配置和同一安装路径，不证明移动目录后的存储身份不变。
8. `moekoe`、`plugin_id`、`minversion` 和 Native Host 自定义字段是现有兼容字段；不能因为品牌改名而擅自改写。

每次吸收上游后应核对真实模板和加载器，再运行插件加载、开关、路由、body 弹窗、歌词窗口及清理回归。Git 没有冲突不证明这些行为正常。

## 6. 性能证据和正式主题门槛

在当前机器上，对基础界面和 12px 验证模糊各记录 120 个 `requestAnimationFrame` 间隔：

| 样本 | 中位数 | P95 | 超过 33.4ms |
| --- | --- | --- | --- |
| 关闭验证样式 | 16.7ms | 17.3ms | 0 / 120 |
| 开启验证样式 | 16.7ms | 17.1ms | 0 / 120 |

这两个约两秒的样本没有显示帧间隔退化。`app.getAppMetrics()` 还记录进程 CPU 和工作集，`getGPUFeatureStatus()` 记录功能开关；GPU 进程 CPU 百分比 **不是硬件 GPU 利用率**，RAF 间隔也不证明每个合成帧都已显示。

阶段四必须验证实际滚动、窗口缩放、复杂封面、多层表面、动画、长期运行与高性能模式，并取得相应 GPU / 内存 / 温度证据。本阶段未把短样本升级为正式主题性能验收。

## 7. 证据入口

- [自动审计摘要：41 项断言](evidence/summary.json)
- [能力与缺陷详细记录](evidence/capabilities.json)
- [退出并重启后的存储记录](evidence/persistence.json)
- [原生交互记录](evidence/原生交互记录.md)
- [复现命令与隔离范围](README.md)

三个 `capturePage` 图片用于保留布局与注入过程。快速切换后的画面曾出现与 computed style 状态不一致的显示，因此图像不用于独立证明浅深色或最终视觉验收；原生窗口另外通过 Computer Use 读取并核对。
