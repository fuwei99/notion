#!/usr/bin/env bash
set -e

APP_DIR="/app"
cd "$APP_DIR"

# 不生成 .env 文件，避免敏感信息（cookie/代理凭证）落盘。
# dotenv 找不到 .env 会静默失败，代码直接从 process.env 读取环境变量。

# 仅当挂载的 cookie 文件真实存在时才设 COOKIE_FILE；
# 否则留空，NotionClient 会自动回退到 NOTION_COOKIE 环境变量
DEFAULT_COOKIE_FILE="/app/data/cookies.txt"
if [ -z "$COOKIE_FILE" ] && [ -f "$DEFAULT_COOKIE_FILE" ]; then
  export COOKIE_FILE="$DEFAULT_COOKIE_FILE"
fi

echo "[start.sh] 启动 Notion2API 服务，端口 ${PORT:-7860}"
exec node src/app.js
