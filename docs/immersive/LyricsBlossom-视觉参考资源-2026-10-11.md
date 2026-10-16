# LyricsBlossom 视觉参考资源核对（2026-10-11）

本记录区分已保留的旧版应用、公开静态截图和实际浏览器确认的演示视频。它是参考素材清单，不是视觉一致性验收，也没有从静态画面推导动画时长、速度或物理参数。

## 当前官网与公开视频

[官网](https://lyricsblossom.theoscarshen.com/) 的网页文本读取仍显示 8.0；本任务根代理通过正常浏览器加载并点击 Liquid Glass 演示后，实际 DOM 的平台版本文字显示 **8.1**。视频使用懒加载，首次文本读取没有 `src` 不能据此判断没有视频。

以下视频 URL 来自根代理的实际浏览器 DOM `source`，不是依据文件命名推测。`v8` 是站点的资源目录名称，不能单独用它确定演示对应哪个补丁版本。

| 资源 | 已确认来源 | 精确 URL |
| --- | --- | --- |
| 首页播放器演示 | `video-hero` 的 `source` | [hero.mp4](https://lyricsblossom.theoscarshen.com/assets/video/v8/hero.mp4?v=d5b25e26a1b0) |
| Liquid Glass 材质与菜单演示 | 点击演示后 `video-glass` 的 `source` | [glass.mp4](https://lyricsblossom.theoscarshen.com/assets/video/v8/glass.mp4?v=467e5af9ce4a) |

这两条视频可在官网原生播放器中观看，用于背景流动、玻璃轮廓与菜单运动的实际对照。本记录没有下载媒体，没有提取或重新分发远程视频帧。具体运动观察由根代理在原生浏览器内继续完成。

本轮已通过官网播放器实际观看：播放器演示时长21.558333秒，材质演示时长33.45秒（浏览器video元数据）。可见背景保留封面的空间颜色并持续改变色团位置，歌词随当前行衔接；菜单使用清楚的文字前景与柔和的玻璃边缘。此次实现据这些可见行为独立调整流动、形变、模糊和内容显现，没有把截图推导或本项目自定义的参数称为参考软件原值。

同一天网页文本中的“材质、交互与运动”区块仍显示待补充，[经典 16 对照页](https://lyricsblossom.theoscarshen.com/classic-16) 四组对照片段仍显示待录制；这不能覆盖或否定上述懒加载视频已经存在的浏览器证据。

## 官网静态图片

以下精确 URL 由公开页面的图片链接取得：

| 资源 | 精确 URL | 可用于 |
| --- | --- | --- |
| 首页播放器画面 | [hero.jpg](https://lyricsblossom.theoscarshen.com/assets/video/v8/hero.jpg?v=9f78a929e567) | 当前公开首页布局与配色对照 |
| macOS 画面 | [macos-v8-lossless.webp](https://lyricsblossom.theoscarshen.com/assets/img/macos-v8-lossless.webp?v=682386438c02) | 桌面平台静态外观对照 |
| Windows 画面 | [windows-v8-lossless.webp](https://lyricsblossom.theoscarshen.com/assets/img/windows-v8-lossless.webp?v=aae8670e2f78) | Windows 静态外观对照 |

截图可以核对布局、颜色和层级；单张截图不能建立背景流动速度、菜单弹簧运动或实际帧率结论。

## 本地保留资料

本地应用为：

`/Users/mico/AI 事物/YifuMusic-保留资料/04-技术参考/LyricsBlossom/LyricsBlossom.app`

实际读取 `Contents/Info.plist`：`CFBundleShortVersionString` 为 **7.0**，`CFBundleVersion` 为 **15**。实际读取可执行文件格式为 Mach-O 64-bit arm64。此次只读核对没有启动应用、改动签名或应用资源。

本地官方仓库快照为：

`/Users/mico/AI 事物/YifuMusic-保留资料/04-技术参考/LyricsBlossom/LyricsBlossom-source`

快照提交为 `112c9fbbfcc0a4699f4e2b04ac9f280b63032370`，其中有 `screenshot-1.png` 至 `screenshot-9.png` 和 `snapshot-banner.png`。已查看 `screenshot-1.png`、`screenshot-3.png`、`screenshot-8.png`、`screenshot-9.png`，它们可以作为旧版横屏/竖屏布局、封面配色及歌词显示的静态参考。图片和该快照 README 没有注明每张截图对应的应用版本，因此不能把它们标记为 7.0 或最新 8.1 的效果证据。

## 本地录像检索范围与结果

对 `/Users/mico/AI 事物` 进行包含隐藏和被 Git 忽略文件的媒体路径检索，检查 `.mp4`、`.mov`、`.webm`、`.mkv`、`.m4v`、`.avi`、`.gif`，排除 `node_modules`。未发现 LyricsBlossom 的本地现成录屏。

检索到的 MicoMusic `11-webgl-motion.mp4`、`11-webgl-motion-unthrottled.mp4`、历史修复前录像与“玻璃开关演示.mp4”均属于本项目，不能用作 LyricsBlossom 的流动参照。其他 GIF 是宠物动画和软件运行时图标。

本轮视觉对照应使用正常浏览器内的公开 `hero.mp4` / `glass.mp4`，同时保留旧版截图的版本限制。

## REA 核对

用户补充的 [morluto/rea](https://github.com/morluto/rea) 是通用逆向分析MCP/CLI；本轮读取的package.json为6.4.0，REA本身使用[MIT许可](https://github.com/morluto/rea/blob/main/LICENSE)。它不是LyricsBlossom反代或播放器源码。

[原生调查文档](https://github.com/morluto/rea/blob/main/docs/native-investigation.md) 和实际 [NativeUiObservation.ts](https://github.com/morluto/rea/blob/main/src/native/NativeUiObservation.ts) 支持指定窗口的截图及辅助功能观察，UI操作依赖AXPress、AXIncrement、AXDecrement，自绘控件未提供接口时不能自动操作。[LldbCallTracer.ts](https://github.com/morluto/rea/blob/main/src/native/LldbCallTracer.ts) 观察自己新启动的进程入口整数寄存器，没有浮点参数、栈参数、返回值和内联调用的完整记录，因此不能单靠这个接口取得全部弹簧或GPU参数。

本轮没有安装或执行REA、修改目标签名或调试正在运行的个人应用。已用公开实际演示建立本次修复的视觉参考；后续若需要二进制研究，应另行记录目标版本、真实符号、调用及常量证据，而不能据工具名称推断能够恢复全部源码。
