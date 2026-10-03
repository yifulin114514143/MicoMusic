# MicoMusic 应用身份与上游关系

## 独立安装身份

| 项目 | MicoMusic | MoeKoe Music 原版 |
| --- | --- | --- |
| 应用标识 appId | `io.github.yifulin114514143.micomusic` | `cn.MoeKoe.Music` |
| 显示名称 | `MicoMusic` | `MoeKoe Music` |
| 应用协议 | `micomusic://` | `moekoe://` |
| macOS 数据目录 | `~/Library/Application Support/MicoMusic` | `~/Library/Application Support/moekoemusic` |
| 更新来源 | `yifulin114514143/MicoMusic` | 原版自己的发布仓库 |

`appId` 是操作系统区分应用的标识；协议是从链接启动对应应用的入口。主进程在设置、日志、插件和浏览器会话初始化前设置 MicoMusic 的独立数据目录，不读取或自动迁移原版数据。

macOS 的大小写不敏感文件系统中，`MicoMusic` 与 `micomusic` 指向同一目录；它们和 `moekoemusic` 是不同目录。保留此前本地 MicoMusic 测试产生的自身数据，不清空它。

打包应用的内置 API 使用系统分配的本机端口。子进程在 MicoMusic 自己的数据目录运行，退出应用只终止自己的子进程。可选 WebSocket 同样使用独立端口，通信消息结构保持原有格式；客户端需从设置读取当前地址。

## 应用链接格式

| 链接格式 | 用途 |
| --- | --- |
| `micomusic://open` | 打开本机应用 |
| `micomusic://share?hash=歌曲哈希` | 交给播放器处理歌曲参数 |
| `micomusic://share?listid=歌单标识` | 进入歌单详情 |
| `micomusic://team/join?code=邀请码` | 交给组队功能处理邀请码 |

参数名称保持既有 IPC（主进程和页面间通信）结构。新协议只接收上述格式；畸形地址和原版协议不会转交给播放器。冷启动时先保存链接，待页面监听器就绪后投递。歌曲、歌单和组队操作还取决于登录与服务接口状态。

分享按钮当前只复制推荐文字或邀请码，不生成网页或应用链接。协议支持与分享页面发布是不同的工作项。

## 两种更新

1. **上游源码更新**：开发者获取 MoeKoeMusic 的新代码，审核并选择合入 MicoMusic。
2. **应用安装更新**：用户下载 MicoMusic 自己的安装包。当前尚未发布，因此还不能在线升级。

独立 `appId` 不改变 Git 的远程关系，持续接收上游源码更新仍通过 `upstream` 完成。

当前本地远程配置：

```text
origin    https://github.com/yifulin114514143/MicoMusic.git
upstream  https://github.com/MoeKoeMusic/MoeKoeMusic.git
```

`origin` 是 MicoMusic 自己的仓库；`upstream` 是 MoeKoeMusic 上游源码仓库。同步前先确认当前远程和工作区状态，读取更新差异，创建独立功能分支并运行测试。未经负责人确认，不自动合并到 `main`。

## 保留兼容内容

- GPL-2.0、原作者信息、历史提交和有来源的代码说明。
- `api/` 子模块及其独立仓库来源。
- 插件 Manifest 字段，如 `moekoe`、`moekoe_permissions`、`moekoe_native_hosts` 和权限 `moekoe:nativeHost`。
- 既有状态管理、配置字段及新手引导存储键；数据目录已隔离，无需为品牌显示改名。
- 上游帮助文档和插件市场，并在项目文档中标明其来源。

正式发布前仍需验证签名、各平台安装与卸载、真实安装更新和 API 二进制架构。本阶段仅生成本地测试应用，不创建发布版本。

## 技术参考

- [Electron 应用路径](https://www.electronjs.org/docs/latest/api/app)：应用数据和会话目录。
- [Electron 应用链接](https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app)：启动 URL 和不同平台的接收事件。
- [electron-builder 构建配置](https://www.electron.build/v26/docs/configuration/)：独立标识和打包协议配置。
