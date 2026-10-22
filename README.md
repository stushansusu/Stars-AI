# Stars-AI ✦ Photoshop × 本地 ComfyUI 的 AI 修图面板

在 Photoshop 里框一块、写一句话，剩下的交给你自己机器上的 ComfyUI。
结果作为新图层贴回原位，原图一个像素不动。
**全部本地算力：不联网、不上传、不需要账号。**

![面板](docs/ui-main.png)

> ## 这里只有源码
>
> - ❌ 不提供打包好的插件（没有 `.zxp` / `.zip` / `.exe`）
> - ❌ **不提供安装步骤，也不提供使用支持**
> - ❌ **不附带、也不指定任何模型**（所有模型权重与工作流都要你自己准备）
> - ❌ 不含 ComfyUI 本体、不含 Photoshop
> - ✅ 只有源码：PS 侧 ExtendScript + CEP 面板 + ComfyUI 工作流图构建 + 几个离线测试脚本
>
> 这是一个自用工具的开源版本。它不承诺「你照着做就能跑」——
> Photoshop/CEP 版本、ComfyUI 版本、模型文件名、显存，这些都要你自己对。

---

## 它做什么

一句话：**用「功能卡」代替写提示词，把 ComfyUI 变成 Photoshop 里的一个修图工具。**

点一张卡 → 模式、提示词、参数自动配好 → 生成 → 结果自动贴回画布。
不满意就换个种子再来一次，或者直接改提示词。

- **功能卡工坊**：按用途分类（画风 / 光影 / 背景场景 / 造型 / 神态 / 画质 / 局部…），可搜索
- **五种模式**：文生图 / 图生图 / 局部重绘 / 放大 / 自定义（导入任意 ComfyUI API 工作流 JSON）
- **局部重绘按真实形状合成**：套索、魔棒画出来的不规则选区不会被抹成方块；选区单独裁出来送去生成
- **写回永不删像素**：结果只作为新图层贴回，选区合成在 ComfyUI 里用 alpha 完成
- **模型从 ComfyUI 现读**：不用在面板里手填模型文件名
- **按显存自动调参**：读 `/system_stats` 拿到显存，分档给参考分辨率 / 步数 / 导出长边
- **面板内启动 ComfyUI**：桌面版优先，失败自动转无头模式

---

## 它不做什么

| 不做 | 原因 |
| --- | --- |
| 不打包、不分发 | 只有源码 |
| 不提供安装步骤 / 使用支持 | 自用工具，环境差异太大 |
| 不带、也不推荐具体模型 | 模型体积大、授权各异，自己准备 |
| 不保证跨版本兼容 | 只在作者本机的 Photoshop 2026 + CEP 12 + 本地 ComfyUI 上验过 |
| 没有批量出图 / 任务队列 | 一次一张，出图后再点一次 |
| 没有 WebSocket 逐 step 进度 | 只有计时 + 队列状态 |
| 不是通用 ComfyUI 前端 | 它只服务「在 PS 里改图」这一条链路 |

---

## 使用

自行完成 CEP 扩展的安装与加载（本仓库不提供安装器，也不写安装步骤）。

面板打开后：

1. 在顶部填本机 ComfyUI 地址（默认 `http://127.0.0.1:8188`），点「连接」
2. 点一张功能卡 → 提示词与参数自动配好
3. 需要局部重绘时，先在 PS 里框选要改的区域
4. 点「生成」，结果作为新图层贴回

---

## 目录结构

```
index.html            面板 UI
css/style.css         样式（设计 token + 组件）
js/app.js             面板主逻辑：渲染、生成流程、写回、维护
js/presets.js         功能卡与分类（纯数据，加功能只改这里）
js/workflows.js       ComfyUI API 工作流图构建
js/comfy.js           ComfyUI HTTP 客户端（上传、提交、轮询）
js/png.js             PNG 编解码 + 矩形羽化蒙版 + 白底抠图
js/bridge.js          CEP 桥：面板 ↔ ExtendScript
jsx/host.jsx          Photoshop 侧脚本：导出、裁选区、烧蒙版、放图层、精修、自检
CSXS/manifest.xml     CEP 扩展清单
tools/                离线脚本：回归测试、布局审计、预览服务器、真机探针
docs/                 截图
```

---

## 架构

```
Photoshop（ExtendScript: jsx/host.jsx）
      ↕ CEP evalScript（js/bridge.js）
CEP 面板（HTML/JS: index.html + js/*.js）
      ↕ HTTP（js/comfy.js，无 WebSocket）
本机 ComfyUI :8188
```

- **导出**：画布复制一份 → 压平 → 按长边缩放 → PNG；局部重绘额外裁出选区外扩一圈
- **蒙版**：在文档坐标里先把选区烧成黑白像素，再裁再缩（像素一定活得过裁剪）
- **合成**：`LoadImageMask(red) → InvertMask → JoinImageWithAlpha`，出图选区外 `alpha = 0`
- **写回**：临时文档里缩放/平移，再复制图层进用户文档——**用户文档内零删像素**
- **精修**：结果区下方的独立区块，走 PS 原生滤镜（不进 ComfyUI、不占显存），作用于当前图层/选区

---

## 测试

不需要打开 Photoshop 也能跑一部分：

```bash
node tools/test-workshops.js   # 面板接线 + 分类 + 蒙版链路 + 加载链路
node tools/test-rectmask.js    # 矩形羽化蒙版
node tools/test-ui.js          # 无头 Chrome 点测：搜索 / 模式锁定 / 分类
node tools/audit-layout.js     # 5 个面板宽度，量元素是否顶出父容器
```

需要本机有 Chrome 或 Edge（`test-ui` / `audit-layout` 会自己起 headless 浏览器）。
`tools/preview-server.js` 可以在浏览器里预览面板（PS 用 mock）。

---

## 已知限制

- **只在 Windows + Photoshop 2026 上跑过**，其它版本不保证
- 局部重绘的非矩形形状链路：作者机器上还没有跑完整轮真机验证
- 不同 Photoshop 版本可用的 ExtendScript API 差异很大（滤镜、混合模式枚举都可能缺），
  代码里做了多层降级，但仍然可能在某些版本上功能受限
- 一次一张，没有批量、没有队列管理
- 进度只有计时与队列状态，没有逐 step 预览

---

## 许可

MIT，见 [LICENSE](LICENSE)。

`js/CSInterface.js` 来自 Adobe CEP SDK，版权归 Adobe，按原许可随附。
