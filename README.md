<img src="mac/AppIcon-1024.png" width="112" align="right" alt="Stardew Desk 图标">

# Stardew Desk 🌱

![macOS](https://img.shields.io/badge/macOS-14%2B-lightgrey?logo=apple)
![Windows](https://img.shields.io/badge/Windows-10%20%2F%2011-blue?logo=windows)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

把《星露谷物语》的农场铺到电脑桌面上（Mac 和 Windows）：季节跟着真实月份走，天气是实时的，有昼夜、动物、会长大的作物、来访的村民。
桌面图标照常点、照常拖；闲置一会儿，农场铺满全屏当屏保。

*A living Stardew Valley farm as your macOS or Windows desktop wallpaper and screensaver. Real-time seasons, live weather,
day and night, animals, growing crops, visiting villagers, a pomodoro "focus farming" mode and the game's seasonal music.
It ships no game assets: on first launch it reads them from your own copy of the game. UI in Chinese.*

![Stardew Desk：把星露谷的农场铺到 Mac 桌面上](docs/preview.png)

> **这是粉丝自制的非官方小工具，和 ConcernedApe 无关。** 仓库里只有代码和几张运行截图，不含任何从游戏里取出的贴图、地图或音乐文件，
> 需要你电脑上装着正版《星露谷物语》（Steam / App Store / GOG 均可）。

<p align="center"><img src="docs/demo.gif" width="800" alt="春夏秋冬与实时天气"><br><sub>春 · 夏（下雨）· 秋（大风）· 冬夜（下雪）</sub></p>

---

## 能做什么

| | |
|---|---|
| 🗓 **四季与昼夜** | 季节跟随真实月份，光照按日出日落变化，晚上窗户和路灯会亮 |
| 🌦 **实时天气** | 取所在城市的实时天气（[Open-Meteo](https://open-meteo.com/)），晴、阴、雨、雷雨、雪、雾、大风；断网时按季节随机。城市在 天气 › 更换城市… 里自己输入，没设置时按时区自动选（中国默认杭州） |
| 🐔 **动物与小动物** | 鸡、牛白天出来吃草；蝴蝶、鸟、萤火虫、青蛙、松鼠，鼠标靠近会被惊动 |
| 🐶 **宠物** | 6 种猫、6 种狗可选；鼠标在桌面上停下时，宠物会跑过去坐在旁边 |
| 🌾 **按游戏规则长的作物** | 生长阶段、再生、季节都取自游戏数据；洒水器、稻草人按游戏的覆盖范围自动布置 |
| 🧑‍🌾 **来访村民** | 刘易斯、罗宾、皮埃尔、艾米丽、威利、莱纳斯会不时走进农场 |
| 🍅 **专注种田** | 25 / 50 分钟番茄钟：专注期间一块田从种子长到成熟，结束时收获并计入当天的出货 |
| 📋 **公告板** | 农场上的公告板贴着今日待办；填上上下班时间（和日薪）后，常驻显示「下班倒计时」和「今日已挣」，下班时发通知 |
| 📬 **新文件提醒** | 桌面或「下载」里出现新文件时，信箱上方冒出信封（只比对文件名，不读内容） |
| 🛠 **自己布置** | 拖动农舍、鸡舍、畜棚、马厩、作物田、树和小物件；新增或删除作物田；画石板路、围栏、路灯 |
| 🐴 **马厩里的「马」** | 把一个文件夹图标换成马，放进马厩的棚子里，看起来就像马站在马厩里 |
| 🖥 **屏保** | 闲置后农场铺满全屏，镜头慢慢巡游，右上角是游戏原版时钟面板 |
| 🎵 **四季配乐** | 可选，播放游戏本身的春夏秋冬配乐，和游戏里一样一首放完安静一会儿再放下一首 |

## 安装

> 下面先讲 Mac，Windows 版见 [Windows 版](#windows-版)。

### 方式一：下载做好的 App（推荐，不用碰代码）

1. 在本仓库的 [Releases](../../releases) 页面下载 `Stardew-Desk.zip`，解压。
2. 把 **Stardew Desk.app** 拖进「应用程序」。
3. 第一次打开：右键点它 →「打开」→ 再点「打开」。
   macOS 15 及以后：先双击一次（会提示无法打开），然后去 **系统设置 → 隐私与安全性**，在最下面点「仍要打开」。
   App 没有经过 Apple 公证，所以 macOS 会问这一次，以后双击就行。
4. 弹出的设置窗口会自动找到星露谷，从游戏里读取画面（约 2 MB，半分钟左右）；找不到的话按提示选一下游戏位置。
5. 勾一下要不要四季配乐，点「开始」。

### 方式二：从源码安装

不需要 Xcode、Node 或 Homebrew，只用 macOS 自带的工具（`osacompile`、`codesign`）。

1. 点本页右上角的 **Code → Download ZIP** 下载并解压，或者 `git clone`。
2. 双击 **安装或更新.command**。它会把 App 打包到 `~/Applications/Stardew Desk.app` 并启动。
   - 第一次双击如果提示「无法打开」，右键 →「打开」即可（macOS 15：去「隐私与安全性」点「仍要打开」）。
   - 如果提示没有权限执行，在「终端」里进到这个文件夹运行 `sh mac/install.sh`，效果一样。
3. 之后改了代码，再双击一次就是更新；也可以在菜单栏叶子菜单 → 更多 →「更新到最新版本」。

想发给朋友：双击 **打包分享版.command**，桌面上会出现 `Stardew-Desk.zip`，里面只有 App 和一份使用说明，不含任何游戏素材。

## Windows 版

和 Mac 版是同一个农场、同样的功能（季节、天气与城市、宠物、屏保、公告板、专注种田、四季配乐），
控制菜单在任务栏右下角的 🍃 图标里（左键右键都行；看不到的话点任务栏上的「^」）。

1. 在 [Releases](../../releases) 页面下载 `Stardew-Desk-win.zip`（约 110 MB，里面是程序本身，不含游戏素材），解压到一个固定的文件夹。
2. 双击 **Stardew Desk.exe**。第一次如果弹出蓝色的「Windows 已保护你的电脑」，点「更多信息」→「仍要运行」
   （没有买代码签名证书，只会问这一次）。
3. 设置窗口会自动在 Steam / GOG 的常见位置找到星露谷，读取画面约半分钟；找不到就点按钮选一下游戏文件夹。
4. 叶子菜单 → 天气 → 更换城市…，输入你所在的城市。

- 需要 Windows 10 / 11（64 位）和 Steam 或 GOG 版的星露谷；Xbox / 微软商店版的游戏文件被系统锁着，可能读不到。
- 画面、设置、日志在 `%APPDATA%\Stardew Desk`；叶子菜单 → 更多 →「打开日志文件夹」。
- **Windows 版刚发布，测试过的机器还不多。** 如果桌面上看不到农场或者是黑的，先试 叶子菜单 → 更多 → 桌面显示方式 →「兼容模式」；
  还不行的话欢迎在 [Issues](../../issues) 里附上日志反馈。

## 使用

农场铺在系统壁纸之上、桌面图标之下，系统壁纸本身不会被改动。🍃 是控制菜单（Mac 在菜单栏右上角，Windows 在任务栏右下角）：

```
季节 ›              跟随真实月份 / 春 / 夏 / 秋 / 冬
天气 ›              实时天气 / 晴 / 阴 / 雨 / 雷雨 / 雪 / 雾 / 大风，所在城市，更换城市…
宠物 ›              6 只猫、6 只狗、不养
屏保 ›              关闭 / 闲置 3·5·10·15 分钟后，立即预览
背景音乐 ›          关闭 / 一直播放 / 只在屏保时播放，音量，正在播放
开始专注种田 ›      25 / 50 分钟，今天的收获（专注中显示「还剩 N 分钟」）
公告板 ›            勾掉待办，今日已挣、下班倒计时，今天请假 / 调休（标题显示「还有 2:13 下班」）
暂停 / 继续
打开设置窗口…
更多 ›              画质、新文件提醒、登录时启动、重新加载场景、重新读取游戏画面…、更新到最新版本
退出
```

**设置窗口**里是同一个农场，按屏幕比例显示，改动会实时同步到桌面：

- **布置 → 调整布局**：拖动建筑、作物田、树和小物件（按格吸附，绿框能放、红框放不下并提示原因）；
  鼠标停在作物田上点右上角的 × 删除，「新增作物田」加一块 5×4 的田，「恢复默认」一键还原。
- **画**：石板路 / 围栏 / 路灯 / 橡皮，在地图上点或拖；「自动」恢复自动铺设。
- **公告板（设置窗口分成「场景 / 布置 / 公告板」三页）**：添加、勾选、删除今日待办；打开「下班倒计时」，填上下班时间、工作日，
  可选日薪（算「今日已挣」）和午休不算钱。录屏前可以关掉「显示已挣金额」。没做完的待办会留到第二天，做完的第二天自动清掉。
  桌面上的公告板会按没做完的待办数贴纸条，上方常驻一张游戏里的便签纸（带胶带）；鼠标在公告板上停一下，展开游戏里「特别订单」
  那块木板：左边是用游戏金币计数框显示的「今日已挣 xx金」和下班倒计时，右边是待办，**直接在桌面上点方框就能打勾**。
  勾掉时响一声游戏里的金币「叮」，纸条飞进出货箱、计入当天出货；下班时播放收获声（可关）。叶子菜单里可以直接「添加待办…」。
  农场上那块公告板的板面取自游戏里皮埃尔商店门口的公告栏。
- **视图**：「全图」里拖框重新选桌面上显示的范围。
- 按 `H` 隐藏面板，`G` 显示网格。

## 隐私与权限

- **只读游戏，不改游戏。** 读取出来的画面、配乐都存在本机（Mac：`~/Library/Application Support/Stardew Desk`；Windows：`%APPDATA%\Stardew Desk`），不会上传到任何地方。
- **联网只用于天气**：按你输入的城市（没输入时按时区对应的城市）的坐标请求 Open-Meteo，不读定位，不带任何个人信息，也不需要 API Key。
  国内常见城市的坐标是内置的；输入其他城市时，会把城市名发给 Open-Meteo 的地名查询换成坐标。
- **新文件提醒**需要一次「桌面」「下载」文件夹的访问授权，只比对文件名；不想要可以在 更多 里关掉。
- 光标位置程序本来就知道，宠物跟随鼠标不需要辅助功能等额外权限。
- **待办和日薪**只存在这台电脑上（App 自己的设置里），不会上传。

## 占用

- Mac 版 App 本身只有代码，约 0.6 MB；Windows 版带着 Electron 运行环境，压缩包约 110 MB。两边从游戏读取的画面约 2 MB；配乐在第一次播放某个季节时才取出来（每季约 7 MB）。
- 只加载当前季节的画面；桌面被窗口挡住大半时降到 8 fps，几乎挡满、低电量模式、锁屏或屏幕休眠时停止渲染。
- 在 M1 MacBook Air（8 GB）上日常运行；Windows 版已在 Windows 真机上跑通。

## 卸载

叶子菜单 → 更多 → 关掉「登录时启动」，退出，然后把 `Stardew Desk.app` 扔进废纸篓，
再删掉 `~/Library/Application Support/Stardew Desk`。从源码安装的也可以运行 `sh mac/uninstall.sh`。

Windows：叶子菜单 → 更多 → 关掉「开机时启动」，退出，删掉程序所在的文件夹，再删掉 `%APPDATA%\Stardew Desk`。

## 开发

**Windows 版**（`win/`）用 Electron 做宿主，场景还是同一个 `scene/`：`cd win && npm install && npm start` 运行，
`npm run dist` 打出 `win/dist/Stardew-Desk-win.zip`（在 macOS / Linux 上也能打包）。
桌面图标下面那一层用的是 WorkerW（和 Lively、Wallpaper Engine 同样的办法），Win32 调用经由 [koffi](https://koffi.dev/)。

**Mac 版**：

整个场景是一个普通网页，直接双击 `scene/index.html` 就能在浏览器里预览（先装过一次 App 读好游戏画面，再把
`~/Library/Application Support/Stardew Desk/scene/data` 复制到仓库的 `scene/data/`）。网址参数可以直接模拟：`index.html?t=18.5&w=rain&s=fall`
（`t` 小时；`w` = sunny / cloudy / rain / storm / snow / fog / windy；`s` = spring / summer / fall / winter）。

桌面宿主用 JXA（JavaScript for Automation）写成，`osacompile` 编译成 App，用 WKWebView 把网页铺在桌面图标下面一层。
调试时先在菜单里退出，再运行 `sh mac/debug.sh`，报错会直接打印在终端；日志在 `~/Library/Logs/StardewDesk.log`。

```
安装或更新.command   双击：打包到 ~/Applications 并启动
打包分享版.command   双击：在桌面生成发给别人的 Stardew-Desk.zip
mac/
  host.js           桌面宿主（JXA）：窗口层级、菜单、屏保、天气、信箱、专注、音乐、首次设置
  musicx.js         从游戏音乐包里取出配乐（XACT ADPCM → AAC）
  build.sh          编译 App；install / package / uninstall / debug.sh
  AppIcon.icns      App 图标（原创像素画，源图 AppIcon-1024.png）
  使用说明.txt       分享版附带的说明
win/
  main.js           Windows 宿主（Electron）：托盘菜单、设置窗口、屏保、天气、信箱、专注、音乐、首次设置
  winapi.js         放到桌面图标下面、判断窗口遮挡（Win32，经由 koffi）
  wavebank.js       从游戏音乐包里取出配乐；adpcm.js 在播放时解码
  使用说明.txt       Windows 分享版附带的说明
scene/
  setup.html/js     首次运行：从游戏里读取画面
  lib/              xnb.js（XNB 解包，LGPL-3.0，附许可证全文）、tbin.js（地图解析）
  config.js         构图、建筑摆放、灯光、动物
  sky.js            太阳高度与昼夜色调
  weather.js        实时天气与雨雪粒子
  animals.js        鸡和牛
  interact.js       光标交互与宠物
  decor.js          作物田、树、杂物、洒水器、稻草人
  layout.js         可拖动的建筑和物件
  paths.js          石板路、围栏、路灯与寻路
  critters.js       蝴蝶、鸟、萤火虫、青蛙、松鼠
  villagers.js      来访的村民
  focus.js          专注种田
  board.js          公告板：待办、下班倒计时、今日已挣
  saver.js          屏保巡游与时钟面板
  main.js           渲染与面板
```

**请不要把 `scene/data/`、`game-content/` 或任何解包出来的素材提交到仓库**，`.gitignore` 已经排除了它们。

## 版权与致谢

- 《星露谷物语》（Stardew Valley）及其全部美术、地图、数据和音乐 © [ConcernedApe](https://www.stardewvalley.net/)。
  本项目与 ConcernedApe 没有任何关联，也不分发任何游戏内容；请支持正版。
- XNB 解包使用 [xnb.js](https://github.com/lybell-art/xnb-js)（Lybell，LGPL-3.0，见 `scene/lib/xnb-LICENSE.txt`；LGPL 引用的 GPL-3.0 全文见 `scene/lib/xnb-GPL-3.0.txt`）。
- 天气数据来自 [Open-Meteo](https://open-meteo.com/)（CC BY 4.0）。
- 本项目自己的代码以 [MIT License](LICENSE) 发布。
