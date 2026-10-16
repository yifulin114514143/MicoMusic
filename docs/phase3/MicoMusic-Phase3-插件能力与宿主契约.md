# 阶段三插件能力与宿主契约

日期：2026-10-07。适用于本阶段代码 `7eb3322`、Electron 39.2.4 和 Chromium 142.0.7444.177；下表描述本项目实现与本机证据，不扩大为任意 Chrome 插件兼容承诺。

## 阶段二问题的当前结果

| 历史问题 | 阶段三实现与边界 |
| --- | --- |
| 空目标可删除根目录 | [extensionLifecycle.js](../../electron/extensions/extensionLifecycle.js)拒绝空目标、根目录、越界和符号链接，限定受管理的一级安装目录，精确关联 ID 与路径 |
| 重启未等待清理 | [extensions.js](../../electron/extensions/extensions.js)等待本地进程退出、扩展卸载及 IPC 注销后初始化；清理失败停止后续重启 |
| 当前文档卸载后残留 | 正式内置视觉插件执行明确 dispose，再卸载；普通第三方内容脚本仍需自行实现清理，未声明通用任意插件 DOM 清理能力 |
| 当前文档重载不重新注入 | [visualPluginHost.js](../../electron/extensions/visualPluginHost.js)仅对精确内置插件与匹配的 App 文档重新注入扩展隔离世界；普通扩展没有被自动移植这套协议 |
| 启动先窗口后插件 | 主进程先有界准备扩展，主窗口显示前有界等待材质状态；超时返回基础 UI，迟到主题拒绝并回滚 |
| 扫描成功掩盖失败 | 统一 MV3/Native Host 清单校验，逐项 `loadResults`；管理页同时显示材质 `visualRuntime` 错误 |
| 无内置资源分发 | `extraResources` 精确包含正式主题；稳定安装路径、内容指纹、事务回滚、卸载持久选择及主动恢复 |
| 名称关联不稳定 | 管理与扫描按实际安装路径关联，不使用插件名称猜测身份；现有 Native Host 协议、自定义权限和授权键继续兼容 |

普通扩展及 Native Host 的真实加载、重启、IPC、延迟退出和卸载保护由阶段三测试覆盖；没有承诺所有第三方扩展均经过兼容性验收。

## 新定义的内置分发与状态

正式目录和 `plugin_id` 精确为 `mico-liquid-glass`，版本为 `1.0.0`。源码为 [plugins/extensions/mico-liquid-glass](../../plugins/extensions/mico-liquid-glass/README.md)。

- 打包只读资源：`process.resourcesPath/visual-plugins/mico-liquid-glass`。
- 生产稳定安装目录：`app.getPath('userData')/extensions/mico-liquid-glass`。Electron 按该实际安装路径产生扩展 ID，移动目录的存储身份没有验证。
- 开发直接加载源码目录；拒绝通过用户卸载入口删除开发源码，使用插件关闭设置。
- 新增 electron-store 键 `builtinVisualPlugins`，内层键 `mico-liquid-glass`，字段为 `removed`、`fingerprint`、`version`。这是本阶段定义，旧宿主没有这些状态。
- 更新依据资源文件名与字节的 SHA256；同版本内容变化也更新。稳定路径不变，保留 `chrome.storage.local`。拒绝未知占用目录及符号链接，不覆盖无关插件。
- 更新临时/备份目录位于 extensions 的父目录，避免参与一级扩展扫描。同一文件系统 rename 事务；元数据失败恢复旧文件，恢复失败保留明确备份路径。
- 生产卸载成功后记录 `removed:true`。后续启动先尊重这个决定，缺失新资源也不自动安装。只有用户主动恢复清除此选择并加载资源。

文件实现见[builtinVisualPluginFiles.js](../../electron/extensions/builtinVisualPluginFiles.js)和[builtinVisualPlugin.js](../../electron/extensions/builtinVisualPlugin.js)。

## 新定义的设置与生命周期

插件设置键是 `chrome.storage.local.micoLiquidGlassSettings`，默认结构：

```json
{"version":1,"enabled":true,"theme":"auto","reduceMotion":false,"lowBlur":false}
```

字段按类型逐项规范化；合法关闭保留。`auto` 跟随已有 `html.dark`，只控制样板表面，不修改全局宿主主题。插件自己的弹窗不加载宿主 preload；普通插件的已有弹窗行为保留。正式内容脚本使用 DOM、Chrome storage 和资源 URL，不访问宿主 Node/preload API。

| 契约 | 精确实现 |
| --- | --- |
| 单例 | 扩展隔离世界的 `__micoLiquidGlassRuntime`；重复注入先清理旧实例 |
| 样式 | 动态创建 `#mico-liquid-glass-style`；manifest 不声明永久 CSS |
| 材质标记 | `data-mico-liquid-glass`、`data-mico-liquid-glass-theme`、`data-mico-liquid-glass-motion`、`data-mico-liquid-glass-blur` |
| 关闭 | 移除样式和材质标记，保留被动配置及生命周期接收器，允许无刷新重新开启 |
| dispose | document 上的 `mico-visual-lifecycle`，`detail` 为 JSON 字符串 `{extensionId,action:'dispose',token}`；只接受精确扩展 ID、动作和非空 token |
| 完成反馈 | `data-mico-visual-ack` 的 `{extensionId,token,success:true}`；宿主核对并移除，清理不完整则停止卸载 |
| 就绪/失败 | `data-mico-visual-ready` 的 `{extensionId,enabled,success:true}` 或 `{extensionId,success:false,error}`；关闭材质仍有非视觉就绪信号 |
| 完整清理 | 移除自有样式/标记、storage/document/pagehide 监听、单例，取消资源读取；迟到异步回调不恢复材质；正式样板无 RAF、计时器或观察器 |

隐藏 `host-bridge.html` 无 preload、启用 sandbox。它以 `chrome.tabs.query({})` 同时核对实测 tab ID 和精确 URL，再用 `chrome.scripting.executeScript` 的 `world:'ISOLATED'` 重注入或清理；未硬编码 Electron world ID。目标只包含默认 session 的实际 `dist/index.html`，或 localhost/127.0.0.1 的 8080 开发页面。manifest 声明 storage/scripting/tabs 及 file/localhost/127.0.0.1 host 权限，实际宿主生命周期目标受上述校验进一步限定。

宿主 preload 新增 `restoreBuiltinVisualPlugin()`，调用 IPC `restore-builtin-visual-plugin`；管理结果新增 `loadResults`、`builtinVisual`、`visualRuntime`。生命周期状态用于反馈和回退，不将共享 DOM 标记当作权限认证。没有新增播放、歌词、账号或队列业务 API。

## 当前样板与后续适配

样板选择器来自现有模板：`.app-header`、`.player-container`、`.player-bar` 及其实际导航、播放、附加和音量按钮。具体规则见[glass.css](../../plugins/extensions/mico-liquid-glass/glass.css)。没有修改现有布局或头像。

侧栏、主内容、卡片、body 弹窗、歌词层和桌面歌词只保留阶段二的可覆盖性证据，阶段三正式样板未完成这些区域的设计。CSS class 兼容性仍依赖宿主模板；每次同步上游需要读取模板并重跑开关、重载和回退验证。独立歌词窗口及不同 session 的正式生命周期覆盖需单独验收。

Apple Music 和 LyricsBlossom 的资料核验与使用边界记在实施规划；本插件独立编写，未复制其实现或素材。具体平台、同尺寸对照、视觉反馈的最终尺寸和动画参数、折射、音乐响应背景和全部页面设计尚待阶段四/四点五完成。
