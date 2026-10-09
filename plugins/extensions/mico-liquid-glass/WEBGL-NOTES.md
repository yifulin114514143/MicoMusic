# 流体及光学材质实现记录

本插件的 JavaScript 与 GLSL 独立编写。研究材料包括项目内的沉浸播放器重构指南，以及 [liquid-glass-webgl](https://github.com/martin65536/liquid-glass-webgl) 在 `b4e0a6910443cea7cdd4b1bfcf7b2394e0a15e48` 的公开结构与光学操作次序。没有复制其 Apache-2.0 源文件、函数文本、截图或素材，也没有移植 LyricsBlossom 闭源实现。不能将指南中推演的数值称作 Apple 官方参数。

流体是四种真实封面采样色在值噪声域扭曲中的连续 GPU 融合，噪声时间采用 `u_time * .12`。48×48 像素量化选取主要、次要、亮、暗四色，忽略透明像素；彩色封面的强调色排除 RGB 最大最小通道差不超过 0.18 的浅色文字和灰边，黑白封面仍使用实际灰阶。首次绘制前完成提色时直接使用封面色；如果此前已绘制回退色，或随后切换封面，则以 1500ms smoothstep 插值。跨域不允许读取、坏图或纹理上传失败会明确记录 `paletteStatus` / `coverSceneError`，转入静态 CSS 回退；更换为可读取的封面可以恢复。不能将回退宣称为成功封面提色。

WebGL1 一个上下文、一个场景 framebuffer，隐藏的 GL 画布提供两个可见 2D 输出。先绘制流体，将其复制到背景画布；再按封面真实 DOMRect、圆角和 `object-fit: cover` 裁切，将实际封面纹理合入场景。玻璃从这个包含流体与封面的场景采样，透明输出复制到位于 DOM 封面上方的玻璃画布，因此菜单覆盖封面时可以折射封面内容。背景与玻璃跟随 Hero 的真实透明度，玻璃输出不接收指针事件。

玻璃形状使用圆角距离场。RGB 通道分别按 1.43、1.45、1.48 的折射率进行 Snell 折射，Schlick 反射控制曲面边缘的亮度，并按菜单与小按钮区分磨砂采样范围；这些是本实现的参数。边缘距离及法线控制曲率高光，指针影响局部高光。更多按钮和菜单在 opening/closing 的短暂阶段通过 smooth minimum 连成薄颈；其他时刻是独立表面。歌词、封面、表单、音频控制始终是宿主 DOM，未创建音频元素或音频频谱输入。

GPU DPR 上限 1.5；流体场景每 CSS 像素一采样，输出玻璃边缘以 capped DPR 抗锯齿。普通流动约 30fps，有限交互过渡约 60fps。播放暂停、减少动效、低模糊时不维持持续 RAF；可见时指针/尺寸变化允许单帧刷新，切封面和菜单展开允许有界过渡。离屏或原生隐藏时停止 RAF、删除 GPU 对象并清空三个画布的 backing store，恢复可见时重建。GPU 丢失时停止循环、显示静态 CSS，并在浏览器 context restore 后重建。禁用/卸载撤回三个画布、GPU 资源、监听、观察器与进行中的封面读取，最后主动释放自有 GL context。

诊断：背景节点 `data-mico-fluid-state` 是 JSON；销毁前 `document` 发 `mico-fluid-diagnostics` CustomEvent，detail 为同样的 JSON 字符串。`coverSceneStatus`、`coverSceneDraws` 和 `outputCanvases` 记录封面场景上传、实际合成次数及可见输出数量。计数来自真实创建/删除调用和 draw，不代替 GPU 硬件利用率。`resources` 显示当前活资源，`allocations/deletions` 可核对反复开关清理。人工对照与运行记录另外验收；本实现不宣称所有 Apple / LyricsBlossom 光学细节已完全相同。
