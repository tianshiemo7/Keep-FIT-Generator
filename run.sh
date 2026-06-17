#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ====== Find Node.js ======
if ! command -v node &>/dev/null; then
  echo "============================================"
  echo "  Node.js 未找到！"
  echo "  请从 https://nodejs.org 下载安装 Node.js (≥18)"
  echo "  或使用包管理器:"
  echo "    Ubuntu/Debian: sudo apt install nodejs npm"
  echo "    macOS:         brew install node"
  echo "============================================"
  exit 1
fi

echo "Node.js: $(which node)"
echo "Version: $(node -v)"

# ====== Install dependencies ======
if [ ! -d node_modules ]; then
  echo ""
  echo "Installing dependencies..."
  npm install || { echo "npm install 失败"; exit 1; }
fi

# ====== Start ======
echo ""
echo "============================================"
echo "  Keep-FIT-Generator v1.0.0"
echo "  按住鼠标左键在地图上拖动绘制跑步路线"
echo "============================================"
echo ""
echo "Starting server on http://localhost:3000 ..."

# Try to open browser
if command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:3000 &>/dev/null &
elif command -v open &>/dev/null; then
  open http://localhost:3000 &>/dev/null &
fi

node server.js
