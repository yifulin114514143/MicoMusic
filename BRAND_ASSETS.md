# MicoMusic 品牌素材说明

角色母版位于本地 `/Users/mico/MicoMusic/看板娘`。已经确认的脸、黑长直、蓝紫眼睛、服装、金属 M 标识、腿部比例及配饰是衍生图的设定基准。新构图可以按页面需要延展，不能改变角色身份。

## 已接入素材

| 文件或目录 | 中文用途与引用位置 |
| --- | --- |
| `build/icons/logo.png`、`icon.icns`、`icon.ico`、`linux/` | 桌面应用图标；使用已确认的放大头像和 macOS 圆角版本 |
| `public/assets/images/mico/mico-app-icon-192.png`、`mico-app-icon-512.png` | 网页应用图标、默认头像和缺省封面 |
| `public/assets/images/mico/mico-mark.svg` | 蓝紫色圆角底的 M 字母品牌标识 |
| `build/icons/mico-trayTemplate.png`、`mico-trayTemplate@2x.png` | macOS 单色模板托盘标识，随系统深浅色显示 |
| `src/assets/images/tray/mico-monogram*.png` | 页面绘制状态栏歌词时使用的 M 字母标识 |
| `public/assets/images/mico/onboarding/` | 七张 Q 版图：设定正面、欢迎、指向、搜索、播放、收藏、设置 |
| `public/assets/images/mico/mico-discover-peek.png` | 发现页看板娘与背景回退图 |
| `build/mico-installer-sidebar.bmp` | Windows 安装和卸载侧栏，163×314、24 位 BMP |
| `src/components/MicoBrandBanner.vue` | 关于信息和条款窗口的品牌横幅 |

Q 版图也用于首页推荐卡片、每日推荐入口、音乐库、本地音乐、云盘和识曲页面。音乐服务返回的封面及用户账号头像优先使用原内容，米可图标只承担缺省显示。

动态图片路径使用相对地址，适配桌面 `file://` 页面；Vue 静态图片和 CSS 图片由 Vite 的构建过程转换。

## 原始素材与制作记录

原始母版和旧项目素材保留。安装侧栏新图位于 `/Users/mico/MicoMusic/看板娘/衍生素材/安装侧栏/mico-installer-sidebar-v1.png`，由内置图片生成工具基于已确认的欢迎动作图衍生，制作提示及转换规格保存在同目录。

M 字母图标为几何矢量标识，`scripts/build-mico-tray-icons.swift` 使用 macOS AppKit 图形接口生成托盘及页面绘图需要的 PNG 尺寸，可在 macOS 仓库根目录运行：

```sh
swift scripts/build-mico-tray-icons.swift
```

旧安装侧栏、旧图标和旧看板娘图片保留在原位置；当前应用入口使用本表列出的 MicoMusic 资源。规划和验收记录统一保存在 `/Users/mico/MicoMusic/规划文档`。
