import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 加载环境变量
dotenv.config({ path: join(dirname(dirname(__dirname)), '.env') });

/**
 * 应用配置中心
 * 集中管理所有配置项，提供类型安全的配置访问
 */
export const config = {
  // 服务器配置
  server: {
    port: parseInt(process.env.PORT || '7860', 10),
    authToken: process.env.PROXY_AUTH_TOKEN || 'default_token',
  },
  
  // Notion API配置
  notion: {
    apiUrl: 'https://app.notion.com/api/v3/runInferenceTranscript',
    clientVersion: '23.13.20260627.1543',
    origin: 'https://app.notion.com',
    referer: 'https://app.notion.com/ai',
  },
  
  // 代理配置
  proxy: {
    useNativePool: process.env.USE_NATIVE_PROXY_POOL === 'true',
    enableServer: process.env.ENABLE_PROXY_SERVER === 'true',
    url: process.env.PROXY_URL || '',
    country: process.env.PROXY_COUNTRY || 'us',
    serverPort: 10655,
  },
  
  // Cookie配置
  cookie: {
    filePath: process.env.COOKIE_FILE,
    envCookies: process.env.NOTION_COOKIE,
  },
  
  // 请求超时配置
  timeout: {
    request: 30000, // 30秒
  },

  // 模型配置由 ModelManager 动态管理（从 Notion 拉取，本地 models.json 缓存）
};

// 验证必要的配置
export function validateConfig() {
  const errors = [];
  
  if (!config.cookie.filePath && !config.cookie.envCookies) {
    errors.push('必须设置 COOKIE_FILE 或 NOTION_COOKIE 环境变量');
  }
  
  if (config.proxy.useNativePool && !['us', 'uk', 'jp', 'de', 'fr', 'ca'].includes(config.proxy.country)) {
    errors.push('PROXY_COUNTRY 必须是以下之一: us, uk, jp, de, fr, ca');
  }
  
  return errors;
}
