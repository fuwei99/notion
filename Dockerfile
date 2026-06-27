FROM node:20-slim

WORKDIR /app

# 安装运行 chrome_proxy_server 所需的最小依赖（glibc 二进制）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
    && rm -rf /var/lib/apt/lists/*

# 先拷贝依赖清单，利用缓存层
COPY package.json package-lock.json* ./

# 仅安装生产依赖
RUN npm ci --omit=dev || npm install --omit=dev

# 拷贝源码与运行时资源
COPY src ./src
COPY public ./public
COPY docs ./docs
COPY models.json ./
COPY start.sh ./

# 修复 Windows 检出导致的 CRLF 行尾，并赋予执行权限
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

# 确保 chrome_proxy_server 可执行
RUN sed -i 's/\r$//' src/proxy/chrome_proxy_server_linux_amd64 2>/dev/null || true \
    && chmod +x src/proxy/chrome_proxy_server_linux_amd64

# 运行时数据目录（cookie、日志等）
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 7860

# 使用 tini 处理子进程信号，确保 chrome_proxy_server 能被正确回收
ENTRYPOINT ["/usr/bin/tini", "--"]

# start.sh 负责加载 .env / cookies 并启动服务
CMD ["bash", "start.sh"]
