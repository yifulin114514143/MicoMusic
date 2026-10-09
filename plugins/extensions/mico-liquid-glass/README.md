# MicoMusic 液态玻璃插件

可关闭的沉浸播放器视觉插件。保留原音频控制、账号与播放队列，通过宿主已有封面和真实KRC时间提供左右布局、封面展开/收起、逐词填充与弹簧歌词。关闭插件后撤回新视图及视觉资源，恢复原全屏歌词。

流体背景由真实封面采样颜色驱动。一个WebGL上下文生成场景，再输出背景及前景玻璃两张2D画布；实际封面纹理按宿主测量位置进入折射场景，使更多菜单在覆盖封面时仍有霜化、折射、色散与边缘反射。更多按钮、退出按钮及底部工具使用同一光学管线。音频元素、按钮文字和点击命中保持为宿主DOM。实现及研究出处见 [WEBGL-NOTES.md](./WEBGL-NOTES.md)。

## 设置

`chrome.storage.local` 中的 `micoLiquidGlassSettings` 是本插件新定义的键，结构为：

```json
{"version":1,"enabled":true,"theme":"auto","reduceMotion":false,"lowBlur":false}
```

首次默认启用；读取设置前不创建材质。`theme` 为 `auto`、`light` 或 `dark`，自动模式跟随宿主实际 `html.dark` 类。减少动效和系统 `prefers-reduced-motion` 停止连续流动及歌词动效。降低模糊开销使背景保持静态，并降低基础界面模糊；仍保留播放和歌词功能。暂停时停止背景连续RAF，词填充仅在真实音频词组进行时运行，隐藏界面释放GPU对象。非法字段逐项回到明确默认值，合法 `enabled:false` 保留。设置界面复用现有插件弹窗入口。

## 生命周期契约

内容脚本在扩展隔离世界运行，使用DOM与`chrome.storage`/`chrome.runtime.getURL`。四个CSS资源由运行时读取并创建一个`#mico-liquid-glass-style`，manifest不静态注入CSS。图像安全读取或GPU失败时显示静态封面与CSS材质，诊断记录实际失败原因。

宿主在独立的隐藏`host-bridge.html`扩展页面中，按manifest的脚本顺序注入设置、提色、shader、流体引擎及内容脚本；权限限于声明的本地App页面。

- 关闭设置：移除样式及四个 `data-mico-liquid-glass*` 根属性，保留设置和清理指令监听；重新启用不增加监听器。
- 宿主发送 `document.dispatchEvent(new CustomEvent('mico-visual-lifecycle', {detail: JSON.stringify({extensionId, action:'dispose', token})}))`。只接受精确 `chrome.runtime.id`、`dispose` 与非空字符串 token。
- 完整清理撤回样式、标记、画布、观察器与监听，取消RAF及图像读取，删除GPU资源并释放WebGL上下文，删除隔离世界的`__micoLiquidGlassRuntime`。隐藏暂停与最终销毁的状态分别记录，迟到回调不能重建已销毁实例。
- 设置及资源读取成功后，`data-mico-visual-ready` 写 JSON `{extensionId,enabled,success:true}`；关闭材质仍保留此非视觉就绪信号，完整清理时移除。读取失败在撤回材质后写 `{extensionId,success:false,error}` 供宿主呈现原因。
- 清理完成在根属性 `data-mico-visual-ack` 写入 JSON `{extensionId,token,success:true}`，由宿主读取并移除。完整清理后没有遗留 resume 监听，当前文档的重新注入由宿主扩展生命周期实现负责。
- 重复执行内容脚本会先完整清理旧实例，再注册一个新实例。页面退出也执行完整清理。资源或设置读取失败时撤回插件，基础 App 界面仍保留。

## 验证

从仓库根运行`npm run test:immersive`与`npm run test:phase3`，再`npm run build`、`npm run validate:immersive`。后者在隔离macOS Electron与userData中加载实际扩展，使用loopback音频、原创封面及KRC，检查真实GPU绘制、词时序、菜单、隐藏、20次开关及重载/卸载。证据位于`docs/immersive/evidence/webgl`，说明见`docs/immersive/WebGL-原生验收说明-2026-10-09.md`。这些技术fixtures的通过不代表真实酷狗账号、跨平台或用户视觉验收。
