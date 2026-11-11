# 流星壁纸 · 交接文档

> 面向下一个接手的会话/代理。读完这一份应当能独立接手，不需要回看前面的对话。
> 最后更新：2026-11-11，对应版本 **v1.7.1**（随机星系完整版 + 退出兜底）

---

## 0. 一句话状态

v1.7 **代码完成、构建通过、离线自检全绿**（800 个种子约束校验 + Node 场景执行 +
selftest + 62.1 MB 发布包）。剩下的唯一一件事是：**等用户在自己机器上看一眼真实画面**
（本机沙箱跑不了 WebView2，详见 §5）。

v1.7.1 追加了**退出兜底**（托盘图标被 Windows 11 折进 ∧ 时怎么关掉程序，见 §4.7）。

v1.6 遗留的两项仍未验证：开机自启、`Ctrl+Alt+M` 交互模式的实机手感。

---

## 1. 这是什么

Windows 桌面星空/流星雨壁纸。不是视频壁纸，是真的 WebGL 实时渲染。

**v1.7 起每次启动随机生成一个星系**，由 `seed` 决定：

- 恒星：色温 3100–12000K（红矮→蓝巨）、半径 10.6–13.4、三层辉光随半径缩放
- 3–5 颗行星（对数空间分配的轨道间距、按间隙限制的半径、预设色板 + 色温偏移）
- 0–2 条彗星尘埃带（8% / 64% / 28%）
- 16000 颗恒星 + 42000 点银河带（随种子换朝向和色调）
- 第二个视角：贴地看流星从天而降（站在 `spec.viewpoint` 那颗行星上，46 条流星）

**v1.6 起彻底移除了行星轨道线和彗星轨道线**——用户明确说"看起来很丑"，要求一刀切，
不要开关。相关代码（`orbitLine()`、`orbitLines[]`、`orbitGuide`、`ShowOrbits`）已全部删除，
**不要好心加回来**。

v1.7 还按用户要求**去掉了参数面板**：`SettingsForm` 只剩 视角 / 旋转速度 / 开机自启；
托盘「显示」子菜单（尘埃带、行星本体）已删除。`dim` / `fps` 退化成 settings.json 里的高级项。

---

## 2. 文件位置

```
C:\Users\chishoushou\Documents\deepseek-harness\default-workspace\meteor-wallpaper\
├── src\MeteorWallpaper\          C# 宿主（.NET 8 WinForms + WebView2）
│   ├── Program.cs                入口；--capture / --selftest / --attachtest 分支
│   ├── Tray.cs                   托盘、菜单、种子、状态机、暂停策略、心跳（最核心）
│   ├── WallpaperWindow.cs        WebView2 宿主窗口；桌面层 ⇄ 前台；解析 spec 消息
│   ├── DesktopHost.cs            WorkerW 查找 + SetParent + 样式改造
│   ├── WebViewSetup.cs           浏览器启动参数、虚拟主机、Settings
│   ├── Settings.cs / SettingsForm.cs   配置（seed/keepSeed/dim/fps…）、精简设置窗
│   ├── Autostart.cs              HKCU\...\Run
│   ├── QuitSignal.cs             --quit / 二次启动 的跨进程退出信号
│   ├── HotkeyWindow.cs           Ctrl+Alt+M（带三级兜底）
│   ├── SelfTest.cs               控制台环境自检（含 galaxy.js 与 seed 行）
│   ├── AttachTest.cs             挂载/摘出/重挂 测试窗口
│   ├── CaptureMode.cs            --capture 截图（走真实 WebView2，支持 --seed）
│   └── wwwroot\                  three.js 场景
│       ├── galaxy.js             种子 → SystemSpec（纯数据，无 THREE/DOM）
│       ├── app.js                buildScene(spec) + 渲染循环 + 消息通道
│       ├── index.html            含错误上报 + 12 秒看门狗（内联脚本）
│       ├── style.css             暗角、交互提示
│       ├── three.module.js       three r160，本地
│       └── THREE-LICENSE.txt     MIT 许可（必须随包分发）
├── tools\                        开发用，不进发布包
│   ├── run-scene.mjs             Node 里跑 app.js（DOM 打桩），含两次换种子热重建
│   ├── check-galaxy.mjs          批量校验 N 个种子的构图/数值约束
│   ├── dump-spec.mjs             把 spec 导出成 JSON
│   ├── preview_spec.py           按 spec 做 CPU 近似渲染（只看构图，颜色/辉光不准）
│   ├── preview_earth.py          地球视角的 CPU 近似渲染（射线求交）
│   ├── scene-stub.mjs            DOM/WebGL 打桩（支持 MW_SEED / MW_MODE）
│   └── serve.js                  静态服务器（调试用）
├── docs\使用说明.txt              会被复制进发布包（UTF-8 **带 BOM**）
├── dist\MeteorWallpaper\         发布目录（可直接运行）
├── dist\MeteorWallpaper_v1.7.1.zip 62.1 MB
└── build.ps1                     一条命令出包（自带编码自愈，见 §3）
```

---

## 3. 构建

SDK 已装在 `meteor-wallpaper\.sdk`（8.0.428，用 dotnet-install.ps1 装在工作区内，没动系统）。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
```

**不要直接 `dotnet build`**，会失败。这台机器的沙箱禁止写用户主目录，必须先重定向这些环境变量（build.ps1 已处理）：

```powershell
$env:TMP / $env:TEMP              -> 工作区 .tmp
$env:APPDATA / $env:LOCALAPPDATA  -> 工作区 .appdata
$env:DOTNET_CLI_HOME              -> 工作区 .dhome
$env:NUGET_PACKAGES               -> 工作区 .nuget
dotnet restore --configfile NuGet.config   # 否则会去读 %APPDATA%\NuGet\NuGet.Config 被拒
```

发布方式：`dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=false`。
产物 147 MB / 262 个文件，zip 后 62.1 MB。**没有做裁剪**：WebView2 包带进来的 WPF 程序集（约 40 MB）
其实用不到，但没敢删——无法完整验证，删了可能起不来。这是一个已知的优化空间。

**踩坑：build.ps1 必须带 UTF-8 BOM。** 它里面写死了中文文件名（`关闭壁纸.bat`、`截图-太阳系.bat`、`诊断.bat`），
Windows PowerShell 5.1 会把无 BOM 的 .ps1 按 ANSI 读，中文变成乱码后
`WriteAllText` 直接抛 `Illegal characters in path`，publish 成功但 docs/zip 全没做。

v1.7.1 起脚本**自带修复**：开头一段纯 ASCII 的守卫会读自己的字节，没有 BOM 就
用 UTF-8 重写并带 BOM 重启一次（`MW_BUILD_BOM_RETRY` 防死循环）。所以现在直接跑就行，
但如果你用别的工具改了这个文件，最好还是跑一遍确认输出里有 `== docs`。

`docs\使用说明.txt` 同样必须是 UTF-8 **带 BOM**（会原样复制进发布包，用户用记事本打开）。

---

## 4. 架构与关键实现

### 4.1 桌面层：WorkerW

```
Progman --(SendMessage 0x052C)--> Explorer 创建 WorkerW
EnumWindows 找 SHELLDLL_DefView 的兄弟 WorkerW
SetParent(我们的窗口, WorkerW) + 改样式 WS_CHILD
```

**踩过的坑（已修，别改回去）**：

1. `0x052C` **不能反复发**。每发一次 Explorer 就新建一个 WorkerW，导致句柄每 2 秒变一次、无限重挂、桌面闪烁。现在 `_spawnSends < 2` 限制，且先枚举、找不到才发。
2. `SetParent` 会失败并返回错误 5（拒绝访问）。**必须校验 `GetParent(hwnd) == worker`**，否则会误报成功（v1.0 就误报过）。失败原因通常是权限：低完整性级别进程不能把自己的窗口塞进 Medium 完整性（Explorer）的窗口树。
3. 重挂要退避（8 秒）+ 最多 3 次失败，否则形成风暴。

### 4.2 Chromium 节流

挂在 WorkerW 里的窗口会被 Chromium 判为 occluded，rAF 掉到 1fps 甚至停。`WebViewSetup.BrowserArgs` 里这几个参数一个都不能少：

```
--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding
--disable-background-timer-throttling
--disable-features=CalculateNativeWinOcclusion
```

### 4.3 暂停策略（用户报过"画面不转"，元凶就在这）

`SHQueryUserNotificationState` 的 **QUNS_BUSY(2) 在大量非全屏场景下也会返回**（录屏、投屏、专注助手、游戏覆盖层）。
早期直接把它当"全屏"→ 壁纸被暂停 → 画面定格 → 用户以为程序坏了。

现行逻辑（`Tray.IsFullscreenApp`）：

```
state == 3 (D3D fullscreen) 或 7 (fullscreen app)  -> 暂停
state == 2 (busy) 或 4 (presentation)              -> 再用前台窗口矩形验证
                                                      宽高覆盖整屏才暂停
```

其它暂停来源：`SessionSwitch` 锁屏、`PowerModeChanged` 休眠。笔记本离电自动降到 20fps。

### 4.4 交互模式

`Ctrl+Alt+M`（占用时依次退到 `Ctrl+Shift+M`、`Alt+Shift+M`，托盘菜单显示实际生效的组合）：

```
同一个窗口从 WorkerW 摘出来 -> WS_POPUP + TOPMOST + 全屏
        -> 拖拽旋转 / 滚轮缩放 / Esc 返回 -> 再挂回 WorkerW
```

复用一个 WebView2 实例，场景状态不丢。注意 `ShowInteractive` 里必须 `_wv.Focus()`，否则 Esc 收不到。

### 4.5 宿主 ⇄ 页面 消息协议

C# → JS（`PostWebMessageAsJson`，`{cmd, value}`）：

| cmd | value | 说明 |
|---|---|---|
| `mode` | `"solar"` / `"earth"` | 切视角 |
| `seed` | int | **v1.7**：就地重建一套新星系（托盘「换一个星系」） |
| `dim` | 0.2–1.0 | 曝光（无 UI，settings.json 高级项） |
| `fps` | 20/30/60 | 帧率上限（无 UI，高级项） |
| `paused` | bool | 暂停渲染 |
| `interactive` | bool | 是否前台交互 |
| `stream` | bool | 显示尘埃带（保留协议，无 UI，默认 true） |
| `planets` | bool | 显示行星（保留协议，无 UI，默认 true） |
| `spin` | 0–8 | 旋转速度倍率 |
| `nudge` | — | 视角瞬转 0.9 弧度（测试渲染是否活着） |

JS → C#：`ready` / `error` / `stats`（每 5 秒 `{fps, paused}`）/ `exitInteract` / `log` /
**`spec`**（v1.7：`{seed, planets, belts, star, temp, palette, buildMs}`，状态面板用）。

种子的传递路径：启动 `?mode=...&seed=N` → 页面首帧构建；之后换星系只发 `{cmd:"seed"}`，
**不重载 WebView**。注意场景就绪前点「换一个星系」会被忽略（`Tray.NewGalaxy` 里挡了），
因为命令会丢。

### 4.6 场景结构（galaxy.js + app.js）

```
galaxy.js
  mulberry32(seed)        确定性 RNG
  makeSpec(seed)          约束随机 → 纯数据 spec
  TARGET_OUTER = 152      最外层轨道半径（= v1.6 太阳系的外缘）
  CAMERA_FOV   = 52

spec = {
  seed, palette,
  star:    { name, temp, radius, glowScale,
             core, halo, outer, light },       // 三个辉光颜色
  planets: [{ name:'P1', r, radius, color, period, phase }],
  belts:   [{ a, e, inc, node, width, count, color }],
  camera:  { distance, elevation, azimuth, fov },
  sky:     { band:[x,y,z], milky },
  viewpoint                                 // earth 视角站哪颗
}

app.js
  world / sky 两个 Group；buildScene(spec) 清空 → dispose → 重建
  stars                 Points + 自定义 shader（uTime 闪烁）
  belts[]               每条一个 Points（同一套 shader，width 控制带状厚度）
  planetMeshes[]        球体；viewpoint 那颗多一层大气 Sprite
  sunGroup              sphere + 3 层 Sprite + PointLight
  cam                   太阳系相机；camEarth 地球视角
  applyVisibility()     统一控制各层可见性（earth 模式下只留 viewpoint + 流星）
  setMode()             切视角（含行星变暗、太阳隐藏、相机归位）
  buildScene()          **v1.7 新增**：dispose 旧对象、重建、重放 mode/visibility、
                        上报 spec 和构建耗时
```

**太阳辉光是世界单位直径**，v1.6 的 `64 / 170 / 380`（不透明度 `0.95 / 0.16 / 0.035`）
是按"半径 12 的恒星、相机距离 360"调出来的。v1.7 改成 `64/170/380 × glowScale`
（`glowScale = star.radius / 12`），且相机距离跟着最外层轨道走，所以比值基本不变。
**再改相机距离或恒星半径，必须同步检查这三个值**，否则整屏糊成一片。

**构图公式**：`camera.distance = 最外层轨道 × 2.35–2.55`。
不要照 §7 旧稿里的"×1.15"——16:9 下垂直 FOV 52° 只能容下 `1.19 × outer`
（`tan(26°) × 2.45 ≈ 1.19`），乘 1.15 会把最外层轨道切出画面。v1.6 的
360 / 152 ≈ 2.37 就是实际调出来的值，现在只是让它随系统缩放。

---

### 4.7 退出兜底（v1.7.1）

用户报过「托盘里找不到程序，关不掉了」。原因有两层：

1. Windows 11 默认把新托盘图标折进任务栏的 ∧ 里，用户不会点开；
2. 上一轮测试留下的 v1.5 副本还在后台跑，**占着单实例锁**，双击新版只会弹
   「已经在运行」——用户既看不到旧图标，也开不了新版。

现在的三道出口（都不依赖托盘）：

```
双击 关闭壁纸.bat              -> MeteorWallpaper.exe --quit
再双击一次 MeteorWallpaper.exe -> 弹窗询问「要关闭它吗？」，点「是」
MeteorWallpaper.exe --quit    -> 直接发信号（给高级用户/脚本）
```

实现：`QuitSignal` 用命名事件 `Local\MeteorWallpaper.Quit`（ManualReset，避免
信号早于监听时丢失）；`TrayContext` 启动时创建事件，窗口 Show 之后起一个后台线程
`WaitOne`，收到后 `_window.BeginInvoke(Quit)` 回 UI 线程。`--quit` 的退出码：
0 = 已通知，1 = 发送失败，2 被映射成 1（没有实例在跑）。

注意：`--quit` 分支必须放在单实例 mutex **之前**，否则第二个进程会卡在弹窗上。

---

## 5. 这个环境的能力边界（非常重要）

**本机沙箱无法运行 WebView2**：`CreateCoreWebView2ControllerAsync` 直接抛 `E_UNEXPECTED`，
因为禁止进程拉起浏览器子进程（Edge 无头模式同样崩）。`SetParent` 也因低完整性级别被拒（错误 5）。
所以**不要指望在这里看到真实渲染，也不要以为代码坏了**。

可用的验证手段（都验证过，有效）：

| 手段 | 命令 | 能验什么 |
|---|---|---|
| 生成器约束 | `node tools\check-galaxy.mjs 800` | 800 个种子的行星数/轨道/大小/配色/相机全部合规、同种子可复现 |
| 场景执行 | `node tools\run-scene.mjs src\MeteorWallpaper\wwwroot .tmp\scene` | app.js 全量执行、双模式、两次换种子热重建、spec 上报 |
| 环境自检 | `.\.sdk\dotnet.exe dist\MeteorWallpaper\MeteorWallpaper.dll --selftest .tmp\st.txt` | 运行时、WebView2、WorkerW、分辨率、galaxy.js/three.js、seed |
| 构图预览 | `python tools\preview_spec.py .tmp\specs\spec-N.json shots\N.png` | CPU 近似，只能看构图/密度 |
| 挂载测试 | `... --attachtest 8` | WorkerW 挂载 / 摘出 / 重挂（会真的在桌面上显示） |

`--capture` 走真实 WebView2，在用户机器上能出真图（`诊断.bat` 就是用它），本机跑不了。

**结论：任何视觉改动都必须让用户跑一次并回传截图。** 不要凭预览图调颜色。

---

## 6. 已实现功能清单

- 托盘：开启/关闭壁纸、交互模式、视角切换、**换一个星系**、转动一下、设置、状态、打开数据目录、开机自启、退出
- **退出兜底（v1.7.1）**：`关闭壁纸.bat` / 二次启动确认 / `--quit`，托盘图标找不到也能关
- 设置：视角、旋转速度（静止/慢/正常/快）、开机自启（亮度/帧率降级为 settings.json 高级项）
- 随机星系：种子生成、启动重摇、热重建、`keepSeed` 复现、状态面板显示种子/恒星/行星数
- 省电：30fps 上限、全屏/锁屏暂停、离电降 20fps
- 健壮性：心跳每 5 秒、连续 0 帧自动重载、Explorer 重启后自动拉起（45 秒内不重复拉起防循环）、WebView2 崩溃自动 reload、场景 JS 报错弹气泡、启动失败不挂黑屏
- 绿色：配置/日志/WebView2 缓存全在程序目录 `data\`，注册表只写 HKCU 一条 Run
- 诊断：`诊断.bat` 一键产出 selftest.txt + solar.png + earth.png + meteor.log

**未验证**：开机自启（本机注册表被禁写）、交互模式实机手感、**v1.7 随机星系的真实观感**。

---

## 7. 随机星系：已完成（原需求见下方存档）

### 实现要点

| 约束 | 落地 |
|---|---|
| 轨道不重叠 | 对数空间切分 `log(span)`（span 2.2–4.4），相邻比值实测最小 1.16；行星半径 ≤ 相邻间隙 30% |
| 行星大小合理 | `半径 = 轨道 × 0.017–0.042`，clamp 1.2–5.6，再按间隙压 |
| 配色和谐 | 8 套预设色板 + 恒星色温色相偏移（`starTint`），不随机 RGB |
| 太阳与行星协调 | 恒星 6 档色温（3100–12000K）决定 tint 与三层辉光颜色 |
| 尘埃带 0–2 条 | 8% / 64% / 28%；半径 1.45–2.05 × 最外层；宽 3.5–11；每条 5000–9000 粒子（合计 ≤18000） |
| 相机构图 | `distance = 最外层 × 2.35–2.55`，elevation 0.26–0.46 |
| 粒子预算 | 星空 16000 + 银河 42000 + 尘埃带 ≤18000，与 v1.6 同量级 |

### 种子

- `settings.json` 存 `seed`；**每次启动重摇**并写回（满足"每次启动随机"）
- `keepSeed: true` 时启动沿用已有 seed（满足"同种子复现"）
- 托盘「换一个星系」= 重摇 + `{cmd:"seed"}` 热重建，场景 30–60ms 建完
- `--capture --seed N` 可出可复现的截图

### 与原方案的偏差（都是故意的，别改回去）

1. **相机距离 2.35–2.55 × 最外层**，不是原稿的 1.15：16:9 下 1.15 会切掉最外层轨道（推导见 §4.6）。
2. **行星数固定 3–5**，不做 0 颗的兜底：用户要的是"一个星系"，空系统只会显得寒酸。原稿§7 迁移陷阱 5 因此自然解决。
3. **`showStream` / `showPlanets` 没有删协议**，只是没有 UI 入口：保留它成本为零，便于以后加"高级"面板。
4. **恒星半径只给 10.6–13.4**（原想 9.8–14.2）：本机看不到真实渲染，辉光尺寸对半径敏感，先收窄变化范围降低翻车概率。

### 仍需用户确认

- 真实画面下 2 条尘埃带是否过密 / 恒星色温是否偏色
- 「换一个星系」的响应速度与观感
- 设置窗精简后是否有用户还想要的项

### 原需求存档（用户原话）

> "我希望你给我做个完整版的……我希望可以隐藏轨道，看起来很丑……"

> "如果去掉自己改参数的功能，让每次点程序自动随机生成一个星系，难度和工程量怎么样"

轨道部分 v1.6 已完成。

---

## 8. 用户偏好（读一下，能省很多来回）

- 中文交流，喜欢直接给结论和数字，不喜欢铺垫
- 明确讨厌"看起来很丑"的轨道线，喜欢**一刀切**而不是给开关
- 会追问 token 消耗和时间成本，给估算时要诚实、可修正（他记得住上一轮的报价）
- 动手能力一般：需要说清"双击哪个文件"、"图标可能藏在托盘 ∧ 里"
- 对"为什么会这样"有兴趣，但更关心"现在能不能用"

---

## 9. 历史与教训

| 版本 | 变更 |
|---|---|
| v1.0 | 首个可运行版本 |
| v1.1 | 修"画面不转"（全屏误判）、热键三级兜底、显示菜单 |
| v1.2 | 帧率心跳、托盘「转动一下」、0 帧自动重载 |
| v1.3 | Explorer 重启自动拉起 |
| v1.4 | 状态面板、`诊断.bat` |
| v1.5 | 首次运行气泡提示（用户找不到交互入口） |
| v1.6 | 彻底移除轨道线 |
| v1.7 | 随机星系（种子/热重建/复现）、设置面板精简、移除显示开关 |
| v1.7.1 | 退出兜底：关闭壁纸.bat / 二次启动确认 / `--quit`；build.ps1 编码自愈 |

教训：

1. **环境限制要早点摸清**。前几轮花了几万 token 试图在本机跑浏览器，最后只能靠 CPU 预览和 Node 打桩代替。
2. **`SetParent` 必须校验返回值**。v1.0 日志写"attached=True"其实是失败，误导了排查方向。
3. **用户的"没有旋转"不等于"没实现旋转"**，很可能是被暂停了。先加可观测性（心跳日志），再改代码。
4. **不要在没验证的情况下堆功能**。
5. **中文脚本文件一律带 BOM**：build.ps1 是 UTF-8 无 BOM 时，PowerShell 5.1 直接把它当 ANSI，
   中文文件名变乱码、`WriteAllText` 抛异常（v1.7 踩过，见 §3）。
6. **删掉过时的开发工具**：`tools/preview.py` 会画已经移除的轨道线，容易让下一个人以为还有这个功能，
   v1.7 已删，用 `preview_spec.py` 取代。
7. **测试实例会占单实例锁**：上一轮测试启动的 v1.5 副本在后台跑了 50 分钟，用户既找不到它的托盘图标，
   也无法启动新版（被 mutex 挡住）。收工前用 `Get-Process MeteorWallpaper` 确认没有残留；
   测试用的副本最好指向 `dist\MeteorWallpaper`，不要留多份旧目录。
8. **本机沙箱里 `Start-Process -Wait` 会挂住**（等 GUI 进程时），验证命令行开关请用
   `cmd /c "app.exe --quit"` 或直接 `& app.exe --quit`（GUI 子系统不会阻塞 PowerShell）。

---

## 10. 快速自检清单（接手后先跑一遍）

```powershell
cd C:\Users\chishoushou\Documents\deepseek-harness\default-workspace\meteor-wallpaper

# 1. 生成器约束（800 个种子）
node tools\check-galaxy.mjs 800

# 2. 场景脚本：执行 + 双模式 + 两次换种子热重建
node tools\run-scene.mjs src\MeteorWallpaper\wwwroot .tmp\scene

# 3. 构建 + 打包
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1

# 4. 环境与资源完整性
.\.sdk\dotnet.exe dist\MeteorWallpaper\MeteorWallpaper.dll --selftest .tmp\st.txt; cat .tmp\st.txt

# 5. 收工前确认没有残留实例（会占单实例锁，用户就开不了新版）
Get-Process MeteorWallpaper -ErrorAction SilentlyContinue

# 6. 退出信号（没有实例时应当立刻返回，不弹窗、不建托盘）
dist\MeteorWallpaper\MeteorWallpaper.exe --quit
```

五项都过 = 可以交给用户测。第 1、2 项不需要 WebView2，本机就能跑。
