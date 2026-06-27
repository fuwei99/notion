import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import { config } from '../config/index.js';
import {
  NotionTranscriptConfigValue,
  NotionTranscriptContextValue,
  NotionTranscriptItem,
  NotionDebugOverrides,
  NotionRequestBody,
  NotionTranscriptItemByuser,
  ChoiceDelta,
  Choice,
  ChatCompletionChunk,
  generateCustomId
} from '../models.js';
import { proxyPool } from '../ProxyPool.js';
import { cookieManager } from '../CookieManager.js';
import { streamManager } from './StreamManager.js';
import { modelManager } from './ModelManager.js';

const logger = createLogger('NotionClient');

/**
 * Notion API 客户端
 * 封装与Notion API的所有交互逻辑
 */
export class NotionClient {
  constructor() {
    this.currentCookieData = null;
    this.initialized = false;
  }

  get cookieManager() {
    return cookieManager;
  }

  /**
   * 初始化客户端
   */
  async initialize() {
    logger.info('初始化Notion客户端...');
    
    // 初始化cookie管理器
    let initResult = false;
    
    if (config.cookie.filePath) {
      logger.info(`检测到COOKIE_FILE配置: ${config.cookie.filePath}`);
      initResult = await cookieManager.loadFromFile(config.cookie.filePath);
      
      if (!initResult) {
        logger.error('从文件加载cookie失败，尝试使用环境变量中的NOTION_COOKIE');
      }
    }
    
    if (!initResult) {
      if (!config.cookie.envCookies) {
        throw new Error('未设置NOTION_COOKIE环境变量或COOKIE_FILE路径');
      }
      
      logger.info('正在从环境变量初始化cookie管理器...');
      initResult = await cookieManager.initialize(config.cookie.envCookies);
      
      if (!initResult) {
        throw new Error('初始化cookie管理器失败');
      }
    }
    
    // 获取第一个可用的cookie数据
    this.currentCookieData = cookieManager.getNext();
    if (!this.currentCookieData) {
      throw new Error('没有可用的cookie');
    }
    
    logger.success(`成功初始化cookie管理器，共有 ${cookieManager.getValidCount()} 个有效cookie`);
    logger.info(`当前使用的cookie对应的用户ID: ${this.currentCookieData.userId}`);
    logger.info(`当前使用的cookie对应的空间ID: ${this.currentCookieData.spaceId}`);
    
    this.initialized = true;
  }
  
  /**
   * 构建Notion请求
   * @param {Object} requestData - OpenAI格式的请求数据
   * @returns {NotionRequestBody} Notion格式的请求体
   */
  buildRequest(requestData) {
    // 确保有当前的cookie数据
    if (!this.currentCookieData) {
      this.currentCookieData = cookieManager.getNext();
      if (!this.currentCookieData) {
        throw new Error('没有可用的cookie');
      }
    }
    
    const userId = this.currentCookieData.userId;
    const spaceId = this.currentCookieData.spaceId;
    const spaceViewId = this.currentCookieData.spaceViewId || randomUUID();
    const userName = this.currentCookieData.userName || `User${Math.floor(Math.random() * 900) + 100}`;
    const userEmail = this.currentCookieData.userEmail || null;
    const spaceName = this.currentCookieData.spaceName || `Workspace ${Math.floor(Math.random() * 99) + 1}`;
    
    const now = new Date();
    const isoString = now.toISOString();
    
    const transcript = [];
    
    // 添加配置项
    // 通过 ModelManager 解析模型 id -> Notion 内部 codename
    const modelName = modelManager.resolveCodename(requestData.model) || requestData.model;
    
    const configId = generateCustomId(userId, spaceId);
    transcript.push(new NotionTranscriptItem({
      id: configId,
      type: "config",
      value: new NotionTranscriptConfigValue({ model: modelName })
    }));
    
    // 添加上下文项
    const contextId = generateCustomId(userId, spaceId);
    transcript.push(new NotionTranscriptItem({
      id: contextId,
      type: "context",
      value: new NotionTranscriptContextValue({
        timezone: "Asia/Shanghai",
        userName: userName,
        userId: userId,
        userEmail: userEmail,
        spaceName: spaceName,
        spaceId: spaceId,
        spaceViewId: spaceViewId,
        currentDatetime: isoString,
        surface: "ai_module"
      })
    }));
    
    // 组合所有消息生成符合新版格式要求的 transcript
    for (const message of requestData.messages) {
      let content = this.normalizeMessageContent(message.content);
      
      const messageId = generateCustomId(userId, spaceId);
      if (message.role === "system" || message.role === "user") {
        transcript.push(new NotionTranscriptItemByuser({
          id: messageId,
          type: "user",
          value: [[content]],
          userId: userId,
          createdAt: message.createdAt || isoString
        }));
      } else if (message.role === "assistant") {
        transcript.push(new NotionTranscriptItem({
          id: messageId,
          type: "markdown-chat",
          value: content,
          traceId: message.traceId || randomUUID(),
          createdAt: message.createdAt || isoString
        }));
      }
    }
    
    // 生成动态 UUID 时，如果是最后一个用户消息（即当前请求的 prompt 节点），
    // 强制它使用与 threadId 强绑定的生成方式，或者严格使用 generateCustomId
    // 网页抓包中 config 节点的 id 为：38bf0ee7-496e-804d-90d4-00aaee68b789，与用户ID/空间ID部分对齐
    
    // 构建基本请求体
    const requestBodyData = {
      spaceId: spaceId,
      transcript: transcript,
      createThread: false,
      traceId: randomUUID(),
      threadParentPointer: {
        table: "space",
        id: spaceId,
        spaceId: spaceId
      },
      debugOverrides: new NotionDebugOverrides({
        emitAgentSearchExtractedResults: true,
        cachedInferences: {},
        annotationInferences: {},
        emitInferences: false
      }),
      generateTitle: true,
      saveAllThreadOperations: true,
      setUnreadState: true,
      createdSource: "ai_module",
      threadType: "workflow",
      isPartialTranscript: false,
      asPatchResponse: true,
      patchResponseVersion: 2,
      isUserInAnySalesAssistedSpace: false,
      isSpaceSalesAssisted: false
    };

    // 每次请求都新建一个符合规范的 threadId 并 createThread=true，
    // 避免复用本地生成但服务端不存在的旧 threadId 导致 0 字节空流软拦截
    const newThreadId = generateCustomId(userId, spaceId);
    requestBodyData.threadId = newThreadId;
    requestBodyData.createThread = true;
    this.currentCookieData.threadId = newThreadId;
    const entry = cookieManager.cookieEntries.find(e => e.userId === userId);
    if (entry) {
      entry.threadId = newThreadId;
      cookieManager.saveCookieData();
    }
    
    return new NotionRequestBody(requestBodyData);
  }
  
  /**
   * 标准化消息内容
   * @param {string|Array} content - 消息内容
   * @returns {string} 标准化后的字符串内容
   */
  normalizeMessageContent(content) {
    if (Array.isArray(content)) {
      let textContent = "";
      for (const part of content) {
        if (part && typeof part === 'object' && part.type === 'text') {
          if (typeof part.text === 'string') {
            textContent += part.text;
          }
        }
      }
      return textContent || "";
    } else if (typeof content !== 'string') {
      return "";
    }
    return content;
  }
  
  /**
   * 创建流式响应
   * @param {NotionRequestBody} notionRequestBody - Notion请求体
   * @returns {Promise<Stream>} 响应流
   */
  async createStream(notionRequestBody) {
    // 确保有当前的cookie数据
    if (!this.currentCookieData) {
      this.currentCookieData = cookieManager.getNext();
      if (!this.currentCookieData) {
        throw new Error('没有可用的cookie');
      }
    }
    
    // 创建流
    const stream = streamManager.createStream();
    
    // 添加初始数据，确保连接建立
    stream.write(':\n\n');
    
    // 设置HTTP头
    const headers = this.buildHeaders();
    
    // 设置超时处理
    const timeoutId = setTimeout(() => {
      if (stream.isClosed()) return;
      
      logger.warning('请求超时，30秒内未收到响应');
      this.sendErrorToStream(stream, '请求超时，未收到Notion响应。', 'timeout');
    }, config.timeout.request);
    
    // 启动fetch处理
    this.fetchAndStream(
      stream,
      notionRequestBody,
      headers,
      this.currentCookieData.cookie,
      timeoutId
    ).catch((error) => {
      if (stream.isClosed()) return;
      
      logger.error(`流处理出错: ${error.message}`, error);
      clearTimeout(timeoutId);
      this.sendErrorToStream(stream, `处理请求时出错: ${error.message}`, 'error');
    });
    
    return stream;
  }
  
  /**
   * 构建请求头
   * @returns {Object} HTTP请求头
   */
  buildHeaders() {
    const sentryTraceId = randomUUID().replace(/-/g, '');
    const sentrySpanId = randomUUID().replace(/-/g, '').substring(0, 16);
    const sentrySampleRand = Math.random().toFixed(16);
    
    return {
      'Content-Type': 'application/json',
      'accept': 'application/x-ndjson',
      'accept-language': 'zh-CN,zh;q=0.9',
      'baggage': `sentry-environment=production,sentry-release=23.13.20260625.1537,sentry-public_key=704fe3b1898d4ccda1d05fe1ee79a1f7,sentry-trace_id=${sentryTraceId},sentry-org_id=324374,sentry-sampled=false,sentry-sample_rand=${sentrySampleRand},sentry-sample_rate=0.00001`,
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'sentry-trace': `${sentryTraceId}-${sentrySpanId}-0`,
      'notion-audit-log-platform': 'web',
      'notion-client-version': config.notion.clientVersion,
      'origin': config.notion.origin,
      'referer': config.notion.referer,
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'x-notion-active-user-header': this.currentCookieData.userId,
      'x-notion-space-id': this.currentCookieData.spaceId
    };
  }
  
  /**
   * 发送错误消息到流
   * @param {Stream} stream - 目标流
   * @param {string} message - 错误消息
   * @param {string} finishReason - 结束原因
   */
  sendErrorToStream(stream, message, finishReason) {
    try {
      const errorChunk = new ChatCompletionChunk({
        choices: [
          new Choice({
            delta: new ChoiceDelta({ content: message }),
            finish_reason: finishReason
          })
        ]
      });
      streamManager.safeWrite(stream, `data: ${JSON.stringify(errorChunk)}\n\n`);
      streamManager.safeWrite(stream, 'data: [DONE]\n\n');
    } catch (e) {
      logger.error(`发送错误消息时出错: ${e.message}`);
    } finally {
      if (!stream.isClosed()) stream.end();
    }
  }
  
  /**
   * 执行fetch请求并处理流式响应
   */
  async fetchAndStream(stream, notionRequestBody, headers, notionCookie, timeoutId) {
    let responseReceived = false;
    let dom = null;
    
    try {
      // 创建JSDOM实例
      dom = this.createDOMEnvironment();
      
      // 设置cookie
      dom.window.document.cookie = notionCookie;
      
      // 创建fetch选项
      const fetchOptions = await this.buildFetchOptions(headers, notionCookie, notionRequestBody);
      
      // 发送请求
      const response = await this.executeRequest(fetchOptions);
      
      // 处理401错误
      if (response.status === 401) {
        await this.handle401Error(stream, notionRequestBody, headers, timeoutId);
        return;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // 处理流式响应
      await this.processStreamResponse(response, stream, responseReceived, timeoutId);
      
    } catch (error) {
      logger.error(`Notion API请求失败: ${error.message}`, error);
      if (timeoutId) clearTimeout(timeoutId);
      
      if (!responseReceived && !stream.isClosed()) {
        this.sendErrorToStream(stream, `Notion API请求失败: ${error.message}`, 'error');
      }
      
      throw error;
    } finally {
      // 清理DOM环境
      this.cleanupDOMEnvironment();
      if (dom) dom.window.close();
    }
  }
  
  /**
   * 创建DOM环境
   */
  createDOMEnvironment() {
    const userAgentStr = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";
    const dom = new JSDOM("", {
      url: "https://www.notion.so",
      referrer: "https://www.notion.so/chat",
      contentType: "text/html",
      includeNodeLocations: true,
      storageQuota: 10000000,
      pretendToBeVisual: true,
      userAgent: userAgentStr
    });
    
    const { window } = dom;
    
    // 显式为 window.navigator 定义 userAgent 属性
    try {
      Object.defineProperty(window.navigator, 'userAgent', {
        value: userAgentStr,
        writable: true,
        configurable: true
      });
    } catch (e) {
      // Ignore
    }
    
    // 安全设置全局对象
    try {
      global.window = window;
      global.document = window.document;
      Object.defineProperty(global, 'navigator', {
        value: window.navigator,
        writable: true,
        configurable: true
      });
    } catch (error) {
      logger.warning(`设置全局对象时出错: ${error.message}`);
    }
    
    return dom;
  }
  
  /**
   * 清理DOM环境
   */
  cleanupDOMEnvironment() {
    try {
      if (global.window) delete global.window;
      if (global.document) delete global.document;
      if (global.navigator) {
        try {
          delete global.navigator;
        } catch (error) {
          Object.defineProperty(global, 'navigator', {
            value: undefined,
            writable: true,
            configurable: true
          });
        }
      }
    } catch (error) {
      logger.warning(`清理全局对象时出错: ${error.message}`);
    }
  }
  
  /**
   * 构建fetch选项
   */
  async buildFetchOptions(headers, notionCookie, notionRequestBody) {
    const fetchOptions = {
      method: 'POST',
      headers: {
        ...headers,
        'Cookie': notionCookie
      },
      body: JSON.stringify(notionRequestBody),
    };
    
    logger.info('--- 发送的 Notion 请求头 ---');
    logger.info(JSON.stringify(fetchOptions.headers, null, 2));
    logger.info('--- 发送的 Notion 请求体 ---');
    logger.info(fetchOptions.body);
    
    // 添加代理配置
    if (config.proxy.useNativePool && !config.proxy.url) {
      const proxy = proxyPool.getProxy();
      if (proxy) {
        logger.info(`使用代理: ${proxy.full}`);
        if (!config.proxy.enableServer) {
          const { HttpsProxyAgent } = await import('https-proxy-agent');
          fetchOptions.agent = new HttpsProxyAgent(proxy.full);
        }
        fetchOptions.proxy = proxy;
      }
    } else if (config.proxy.url) {
      logger.info(`使用代理: ${config.proxy.url}`);
      if (!config.proxy.enableServer) {
        const { HttpsProxyAgent } = await import('https-proxy-agent');
        fetchOptions.agent = new HttpsProxyAgent(config.proxy.url);
      }
      fetchOptions.proxyUrl = config.proxy.url;
    }
    
    return fetchOptions;
  }
  
  /**
   * 执行请求
   */
  async executeRequest(fetchOptions) {
    if (config.proxy.enableServer) {
      const proxyRequest = {
        method: 'POST',
        url: config.notion.apiUrl,
        headers: fetchOptions.headers,
        body: fetchOptions.body,
        stream: true
      };
      
      if (fetchOptions.proxy) {
        proxyRequest.proxy = fetchOptions.proxy.full;
      } else if (fetchOptions.proxyUrl) {
        proxyRequest.proxy = fetchOptions.proxyUrl;
      }
      
      return await fetch(`http://127.0.0.1:${config.proxy.serverPort}/proxy`, {
        method: 'POST',
        body: JSON.stringify(proxyRequest)
      });
    }
    
    return await fetch(config.notion.apiUrl, fetchOptions);
  }
  
  /**
   * 处理401错误
   */
  async handle401Error(stream, notionRequestBody, headers, timeoutId) {
    logger.error('收到401未授权错误，cookie可能已失效');
    cookieManager.markAsInvalid(this.currentCookieData.userId);
    
    this.currentCookieData = cookieManager.getNext();
    if (!this.currentCookieData) {
      throw new Error('所有cookie均已失效，无法继续请求');
    }
    
    // 重新构建请求并重试
    const newHeaders = {
      ...headers,
      'x-notion-active-user-header': this.currentCookieData.userId,
      'x-notion-space-id': this.currentCookieData.spaceId
    };
    
    return this.fetchAndStream(
      stream,
      notionRequestBody,
      newHeaders,
      this.currentCookieData.cookie,
      timeoutId
    );
  }
  
  /**
   * 处理流式响应
   */
  async processStreamResponse(response, stream, responseReceived, timeoutId) {
    if (!response.body) {
      throw new Error("Response body is null");
    }
    
    const reader = response.body;
    let buffer = '';
    
    reader.on('data', (chunk) => {
      if (stream.isClosed()) {
        try {
          reader.destroy();
        } catch (error) {
          logger.error(`销毁reader时出错: ${error.message}`);
        }
        return;
      }
      
      try {
        if (!responseReceived) {
          responseReceived = true;
          logger.info('已连接Notion API');
          clearTimeout(timeoutId);
        }
        
        const text = chunk.toString('utf8');
        buffer += text;
        
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const jsonData = JSON.parse(line);
            
            // 兼容新的数据包推送格式：网页返回的数据块可能在不同类型的节点上
            let content = null;
            if (jsonData?.type === "markdown-chat" && typeof jsonData?.value === "string") {
              content = jsonData.value;
            } else if (jsonData?.type === "patch") {
              // 兼容网页抓包的 {"type":"patch","v":[{"o":"x","p":"/s/6/value/0/content","v":"..."}]} 格式
              const valueOp = jsonData.v?.[0];
              if (valueOp && (valueOp.o === 'x' || valueOp.o === 'a') && typeof valueOp.v === 'string') {
                content = valueOp.v;
              }
            } else if (jsonData?.type === "agent-inference") {
              const textVal = jsonData.value?.[0];
              if (textVal && textVal.type === 'text' && typeof textVal.content === 'string') {
                content = textVal.content;
              }
            }
            
            if (content) {
              const chunk = new ChatCompletionChunk({
                choices: [
                  new Choice({
                    delta: new ChoiceDelta({ content }),
                    finish_reason: null
                  })
                ]
              });
              
              const dataStr = `data: ${JSON.stringify(chunk)}\n\n`;
              if (!streamManager.safeWrite(stream, dataStr)) {
                try {
                  reader.destroy();
                } catch (error) {
                  logger.error(`写入失败后销毁reader时出错: ${error.message}`);
                }
                return;
              }
            }
          } catch (jsonError) {
            logger.error(`解析JSON出错: ${jsonError.message}`);
          }
        }
      } catch (error) {
        logger.error(`处理数据块出错: ${error.message}`);
      }
    });
    
    reader.on('end', () => {
      try {
        logger.info('响应完成');
        
        if (cookieManager.getValidCount() > 1) {
          this.currentCookieData = cookieManager.getNext();
          logger.info(`切换到下一个cookie: ${this.currentCookieData.userId}`);
        }
        
        if (!responseReceived) {
          this.handleNoContentResponse(stream);
        }
        
        this.sendEndChunk(stream);
        
        if (timeoutId) clearTimeout(timeoutId);
        if (!stream.isClosed()) stream.end();
        
      } catch (error) {
        logger.error(`处理流结束时出错: ${error.message}`);
        if (timeoutId) clearTimeout(timeoutId);
        if (!stream.isClosed()) stream.end();
      }
    });
    
    reader.on('error', (error) => {
      logger.error(`流错误: ${error.message}`);
      if (timeoutId) clearTimeout(timeoutId);
      this.sendErrorToStream(stream, `流读取错误: ${error.message}`, 'error');
    });
  }
  
  /**
   * 处理无内容响应
   */
  handleNoContentResponse(stream) {
    if (!config.proxy.enableServer) {
      logger.warning('未从Notion收到内容响应，请尝试启用tls代理服务');
    } else if (config.proxy.useNativePool) {
      logger.warning('未从Notion收到内容响应，请重roll，或者切换cookie');
    } else {
      logger.warning('未从Notion收到内容响应,请更换ip重试');
    }
    
    const noContentChunk = new ChatCompletionChunk({
      choices: [
        new Choice({
          delta: new ChoiceDelta({ content: "未从Notion收到内容响应,请更换ip重试。" }),
          finish_reason: "no_content"
        })
      ]
    });
    streamManager.safeWrite(stream, `data: ${JSON.stringify(noContentChunk)}\n\n`);
  }
  
  /**
   * 发送结束块
   */
  sendEndChunk(stream) {
    const endChunk = new ChatCompletionChunk({
      choices: [
        new Choice({
          delta: new ChoiceDelta({ content: null }),
          finish_reason: "stop"
        })
      ]
    });
    
    streamManager.safeWrite(stream, `data: ${JSON.stringify(endChunk)}\n\n`);
    streamManager.safeWrite(stream, 'data: [DONE]\n\n');
  }
  
  /**
   * 获取状态信息
   */
  getStatus() {
    return {
      initialized: this.initialized,
      validCookies: cookieManager.getValidCount(),
      currentUserId: this.currentCookieData?.userId || null,
      currentSpaceId: this.currentCookieData?.spaceId || null
    };
  }
}

// 创建全局NotionClient实例
export const notionClient = new NotionClient();
