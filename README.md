# 🏃 Keep-FIT-Generator

在地图上手绘跑步路线，一键生成带完整生理数据的 Garmin `.fit` 文件，导入 Keep 即可获得逼真的跑步记录。

## ✨ 功能

- **🗺️ 自由绘制路线** — 在高德地图上按住鼠标拖动绘制任意闭合跑步路线
- **🧬 真实生理模拟** — 自动生成心率（三阶段热身→稳定→冲刺）、踏频、功率、海拔、步幅等数据
- **🎛️ 全参数可配** — 配速范围、时间范围、圈数、体重、心率区间、海拔变化、偏移量
- **📦 批量导出** — 一次生成 1~20 份 FIT 文件，自动打包为 ZIP，日期可联动
- **📊 曲线预览** — 生成前可预览配速/心率/海拔曲线

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18

### 安装运行

```bash
# 克隆仓库（GitHub / Gitee 任选其一）
git clone https://github.com/tianshiemo7/Keep-FIT-Generator.git
# 或
git clone https://gitee.com/tesm1234/Keep-FIT-Generator.git

cd Keep-FIT-Generator

# 安装依赖
npm install

# 启动服务
npm start
```

浏览器访问 `http://localhost:3000`。

> **一键启动**：
> - **Windows**：双击 `run.cmd`
> - **Linux / macOS**：`bash run.sh`
>
> 脚本会自动检测 Node.js 环境并安装依赖。

## 📖 使用指南

### 1. 绘制路线

1. 点击 **「开始绘制」** 进入绘制模式
2. 按住鼠标左键在地图上拖动，画出跑步路线
3. 松开鼠标完成绘制，路线自动闭合

### 2. 调节参数

| 参数组 | 说明 |
|---|---|
| 运动参数 | 静息心率 / 最大心率 / 体重 |
| 路线参数 | 圈数 / 采样密度 / 随机偏移量 |
| 地形 | 基础海拔 / 海拔变化幅度 |
| 配速范围 | 最快 ~ 最慢（每份导出随机取） |
| 时间范围 | 最早 ~ 最晚（每份导出随机取） |
| 批量导出 | 份数 / 连续日期开关 |

### 3. 生成与预览

- 点击 **「预览曲线」** 查看当前参数下的配速、心率、海拔变化
- 点击 **「批量生成 FIT」** 导出文件

### 4. 导入 Keep

1. 打开 Keep App
2. 底部导航 → **「我的」**
3. 点击 **「运动记录」**
4. 点击右上角 **「运动数据导入」**
5. 选择导出的 `.fit` 文件或 `.zip` 压缩包
6. 导入成功，记录出现在运动历史中

> **提示**：批量导出多份时，选择 ZIP 文件一次性导入更方便。

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Node.js · Express |
| 前端 | Leaflet · Chart.js · JSZip |
| 地图 | 高德瓦片（GCJ-02 ⇄ WGS-84 坐标互转） |
| 路线 | Catmull-Rom 样条平滑 · 高斯扰动 |
| 编码 | Garmin FIT SDK（@garmin/fitsdk） |
| 生理模型 | 三阶段心率 · 多峰海拔 · 功率估算 |

## 📁 项目结构

```
Keep-FIT-Generator/
├── server.js          # 后端：FIT 编码 + API
├── run.cmd            # Windows 一键启动
├── run.sh             # Linux/macOS 一键启动
├── package.json       # 依赖声明 (Node ≥18, ESM)
├── .env.example       # 环境变量示例
└── public/
    ├── index.html     # 前端页面（Leaflet + Chart.js + JSZip）
    ├── main.js        # 前端逻辑（高德瓦片、GCJ-02↔WGS-84）
    └── style.css      # 暗色主题
```

## ⚠️ 免责声明

本项目仅供学习研究使用。生成的跑步数据为模拟数据，请勿用于作弊、骗取保险或任何违法违规用途。
