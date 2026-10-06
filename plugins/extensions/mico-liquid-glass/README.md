# MicoMusic 液态玻璃插件

阶段三局部材质样板，独立编写；没有复制 Apple Music、LyricsBlossom 的源码或素材。只覆盖宿主实际存在的 `.app-header`、`.player-container`、`.player-bar` 及其导航/播放按钮，不改变尺寸、位置、账号头像或播放逻辑。背板模糊、边缘高光与透色是本阶段实现；尚未实现完整折射、封面提色或音乐响应背景。

## 设置

`chrome.storage.local` 中的 `micoLiquidGlassSettings` 是本插件新定义的键，结构为：

```json
{"version":1,"enabled":true,"theme":"auto","reduceMotion":false,"lowBlur":false}
```

首次默认启用；读取设置前不创建材质。`theme` 为 `auto`、`light` 或 `dark`，自动模式跟随宿主实际 `html.dark` 类。它只控制样板表面，不改写整个 App 主题。减少动效撤回样板按钮的缩放/过渡，CSS 同时尊重系统 `prefers-reduced-motion`。降低模糊开销将 22px 模糊改为 8px 并提高不透明度；没有将其等同于整个播放器的性能保证。非法字段逐项回到明确默认值，合法 `enabled:false` 保留。设置界面复用现有插件弹窗入口。

## 生命周期契约

内容脚本在扩展隔离世界运行，只使用 DOM 与 `chrome.storage`/`chrome.runtime.getURL`，不调用宿主 preload API。`glass.css` 由运行时读取并创建一个 `#mico-liquid-glass-style`，manifest 不静态注入 CSS。

宿主在独立的隐藏 `host-bridge.html` 扩展页面中使用 `chrome.scripting` 将 `settings.js`、`content.js` 按顺序注入原扩展隔离世界；权限限于 manifest 声明的本地 App 页面，不向业务 renderer 提供 Node 或存储能力。

- 关闭设置：移除样式及四个 `data-mico-liquid-glass*` 根属性，保留设置和清理指令监听；重新启用不增加监听器。
- 宿主发送 `document.dispatchEvent(new CustomEvent('mico-visual-lifecycle', {detail: JSON.stringify({extensionId, action:'dispose', token})}))`。只接受精确 `chrome.runtime.id`、`dispose` 与非空字符串 token。
- 完整清理撤回样式、标记、存储/文档/pagehide 监听，中止资源读取，删除隔离世界的 `__micoLiquidGlassRuntime`。样板无 DOM 观察器、计时器或 RAF。
- 设置及资源读取成功后，`data-mico-visual-ready` 写 JSON `{extensionId,enabled,success:true}`；关闭材质仍保留此非视觉就绪信号，完整清理时移除。读取失败在撤回材质后写 `{extensionId,success:false,error}` 供宿主呈现原因。
- 清理完成在根属性 `data-mico-visual-ack` 写入 JSON `{extensionId,token,success:true}`，由宿主读取并移除。完整清理后没有遗留 resume 监听，当前文档的重新注入由宿主扩展生命周期实现负责。
- 重复执行内容脚本会先完整清理旧实例，再注册一个新实例。页面退出也执行完整清理。资源或设置读取失败时撤回插件，基础 App 界面仍保留。

## 验证

从仓库根运行 `node --test tests/liquidGlassPlugin.test.js`。测试覆盖配置处理、设置关闭/开启 20 次、重复注入、完整清理、资源失败回退和清理期间异步回调。DOM 与 Chrome 契约测试不替代真实扩展、原生 App、实际播放连续性或人工视觉验收，这些由阶段三集成验收另外记录。
