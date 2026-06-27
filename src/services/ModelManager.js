import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logger = createLogger('ModelManager');

const MODELS_FILE = join(dirname(dirname(__dirname)), 'models.json');
const NOTION_API = 'https://app.notion.com/api/v3/getAvailableModels';

class ModelManager {
  constructor() {
    this.models = [];
    this.idToCodename = new Map();
    this.codenameToId = new Map();
    this.initialized = false;
  }

  static slugify(message) {
    return message.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9.\-]/g, '');
  }

  static generateId(model) {
    const family = (model.modelFamily || '').toLowerCase();
    const slug = ModelManager.slugify(model.modelMessage || model.model || '');
    switch (family) {
      case 'anthropic':
        return slug.startsWith('claude-') ? slug : `claude-${slug}`;
      default:
        return slug;
    }
  }

  async fetchAvailableModels(cookieEntry) {
    const headers = {
      'accept': '*/*',
      'accept-language': 'zh-CN,zh;q=0.9',
      'content-type': 'application/json',
      'notion-audit-log-platform': 'web',
      'notion-client-version': config.notion.clientVersion,
      'origin': 'https://app.notion.com',
      'referer': 'https://app.notion.com/ai',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'x-notion-active-user-header': cookieEntry.userId,
      'x-notion-space-id': cookieEntry.spaceId,
      'cookie': cookieEntry.cookie
    };

    const fetchOptions = {
      method: 'POST',
      headers,
      body: JSON.stringify({ spaceId: cookieEntry.spaceId })
    };

    if (config.proxy.enableServer) {
      const proxyReq = {
        method: 'POST',
        url: NOTION_API,
        headers,
        body: fetchOptions.body,
        stream: false
      };
      if (config.proxy.url) proxyReq.proxy = config.proxy.url;
      return await fetch(`http://127.0.0.1:${config.proxy.serverPort}/proxy`, {
        method: 'POST',
        body: JSON.stringify(proxyReq)
      });
    }

    if (config.proxy.url) {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
    }
    return await fetch(NOTION_API, fetchOptions);
  }

  buildMaps(models) {
    this.models = models;
    this.idToCodename = new Map();
    this.codenameToId = new Map();
    for (const m of models) {
      const id = ModelManager.generateId(m);
      this.idToCodename.set(id, m.model);
      this.codenameToId.set(m.model, id);
    }
  }

  async initialize(cookieManager) {
    let models = null;

    const entries = cookieManager?.cookieEntries?.filter(e => e.valid) || [];
    if (entries.length > 0) {
      try {
        logger.info('正在从 Notion 拉取可用模型列表...');
        const resp = await this.fetchAvailableModels(entries[0]);
        if (resp.ok) {
          const data = await resp.json();
          models = data.models;
          if (models && models.length > 0) {
            this.buildMaps(models);
            this.persistModels({ ...data, models });
            this.initialized = true;
            logger.success(`已从 Notion 拉取 ${models.length} 个模型并更新 models.json`);
            return true;
          }
        }
        logger.warning(`拉取模型列表返回状态 ${resp.status}，将使用本地 models.json`);
      } catch (e) {
        logger.warning(`拉取模型列表失败: ${e.message}，将使用本地 models.json`);
      }
    }

    if (!models) {
      try {
        const local = JSON.parse(fs.readFileSync(MODELS_FILE, 'utf8'));
        models = local.models;
        this.buildMaps(models);
        this.initialized = true;
        logger.info(`已从本地 models.json 加载 ${models.length} 个模型`);
        return true;
      } catch (e) {
        logger.error(`本地 models.json 加载失败: ${e.message}`);
      }
    }
    return false;
  }

  persistModels(data) {
    try {
      fs.writeFileSync(MODELS_FILE, JSON.stringify(data, null, 4), 'utf8');
    } catch (e) {
      logger.warning(`写入 models.json 失败: ${e.message}`);
    }
  }

  resolveCodename(modelInput) {
    if (!modelInput) return null;
    if (this.idToCodename.has(modelInput)) {
      return this.idToCodename.get(modelInput);
    }
    if (this.codenameToId.has(modelInput)) {
      return modelInput;
    }
    return null;
  }

  getAvailableIds() {
    return Array.from(this.idToCodename.keys());
  }
}

export const modelManager = new ModelManager();
