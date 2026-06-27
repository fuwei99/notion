#!/usr/bin/env bash
set -e

APP_DIR="/app"
cd "$APP_DIR"

# 生成 .env（优先使用挂载的，否则用环境变量拼装）
if [ ! -f .env ]; then
  {
    echo "NOTION_COOKIE=\"${NOTION_COOKIE:-}\""
    echo "PROXY_AUTH_TOKEN=\"${PROXY_AUTH_TOKEN:-default_token}\""
    echo "PROXY_URL=\"${PROXY_URL:-}\""
    echo "USE_NATIVE_PROXY_POOL=${USE_NATIVE_PROXY_POOL:-false}"
    echo "PROXY_COUNTRY=\"${PROXY_COUNTRY:-us}\""
    echo "PROXY_SERVER_PLATFORM=linux"
    echo "PROXY_SERVER_PORT=${PROXY_SERVER_PORT:-10655}"
    echo "PROXY_SERVER_LOG_PATH=/app/data/proxy_server.log"
    echo "ENABLE_PROXY_SERVER=${ENABLE_PROXY_SERVER:-true}"
    echo "ADMIN_USERNAME=\"${ADMIN_USERNAME:-admin}\""
    echo "ADMIN_PASSWORD=\"${ADMIN_PASSWORD:-admin123}\""
    echo "PORT=${PORT:-7860}"
    [ -n "$COOKIE_FILE" ] && echo "COOKIE_FILE=\"$COOKIE_FILE\""
  } > .env
  echo "[start.sh] 已根据环境变量生成 .env"
fi

# 默认 cookie 文件指向挂载目录
export COOKIE_FILE="${COOKIE_FILE:-/app/data/cookies.txt}"

echo "[start.sh] 启动 Notion2API 服务，端口 ${PORT:-7860}"
exec node src/app.js
