import { randomUUID } from 'crypto';

// 输入模型 (OpenAI-like)
export class ChatMessage {
  constructor({
    id = generateCustomId(),
    role,
    content,
    userId = null,
    createdAt = null,
    traceId = null
  }) {
    this.id = id;
    this.role = role; // "system", "user", "assistant"
    this.content = content;
    this.userId = userId;
    this.createdAt = createdAt;
    this.traceId = traceId;
  }
}

export class ChatCompletionRequest {
  constructor({
    messages,
    model = "notion-proxy",
    stream = false,
    notion_model = "anthropic-opus-4"
  }) {
    this.messages = messages;
    this.model = model;
    this.stream = stream;
    this.notion_model = notion_model;
  }
}

// Notion 模型
export class NotionTranscriptConfigValue {
  constructor({
    type = "workflow",
    model
  }) {
    this.type = type;
    this.enableAgentAutomations = true;
    this.enableAgentIntegrations = true;
    this.enableCustomAgents = true;
    this.enableExperimentalIntegrations = false;
    this.enableAgentDiffs = true;
    this.enableCsvAttachmentSupport = true;
    this.showDatabaseAgentsDiscoverability = false;
    this.enableAgentThreadTools = false;
    this.enableCrdtOperations = false;
    this.enableAgentCardCustomization = true;
    this.enableSystemPromptAsPage = false;
    this.enableUserSessionContext = false;
    this.enableLargeToolResultComputerOffload = false;
    this.enableScriptAgentAdvanced = false;
    this.enableScriptAgent = true;
    this.enableScriptAgentSearchConnectorsInCustomAgent = false;
    this.enableScriptAgentGoogleDriveInCustomAgent = false;
    this.enableScriptAgentGoogleDriveOAuthInCustomAgent = false;
    this.enableScriptAgentSlack = true;
    this.enableScriptAgentMcpServers = false;
    this.enableScriptAgentGtm = false;
    this.enableComputer = false;
    this.enableCreateAndRunThread = true;
    this.enableSoftwareFactoryPage = false;
    this.enableAgentGenerateImage = false;
    this.enableQueryCalendar = false;
    this.enableQueryMail = false;
    this.enableMailExplicitToolCalls = true;
    this.enableMailNotificationPreferences = false;
    this.enableMailAgentMultiProviderSupport = true;
    this.useRulePrioritization = true;
    this.availableConnectors = [];
    this.searchScopes = [{ type: "everything" }];
    this.useWebSearch = true;
    this.isHipaa = false;
    this.internetAccess = false;
    this.manageWorkers = false;
    this.useReadOnlyMode = false;
    this.writerMode = false;
    this.model = model;
    this.modelFromUser = true;
    this.isCustomAgent = false;
    this.isCustomAgentBuilder = false;
    this.isAgentResearchRequest = false;
    this.useCustomAgentDraft = false;
    this.use_draft_actor_pointer = false;
    this.enableUpdatePageAutofixer = true;
    this.enableMarkdownVNext = false;
    this.enableEmbedBlocks = true;
    this.updatePageStaleViewGuardEnabled = false;
    this.enableUpdatePageOrderUpdates = true;
    this.enableAgentSupportPropertyReorder = true;
    this.enableAgentAskSurvey = true;
    this.databaseAgentConfigMode = false;
    this.isOnboardingAgent = false;
    this.isMobile = false;
    this.useContextualCoreDocsAutoLoad = false;
    this.useDocPreviewsForCoreAutoLoad = true;
  }
}


export class NotionTranscriptContextValue {
  constructor({
    timezone = "Asia/Shanghai",
    userName,
    userId,
    userEmail,
    spaceName,
    spaceId,
    spaceViewId,
    currentDatetime,
    surface = "ai_module"
  }) {
    this.timezone = timezone;
    this.userName = userName;
    this.userId = userId;
    this.userEmail = userEmail;
    this.spaceName = spaceName;
    this.spaceId = spaceId;
    this.spaceViewId = spaceViewId;
    this.currentDatetime = currentDatetime;
    this.surface = surface;
  }
}

export class NotionTranscriptItem {
  constructor({
    id = generateCustomId(),
    type,
    value = null,

  }) {
    this.id = id;
    this.type = type; // "markdown-chat", "agent-integration", "context"
    this.value = value;
  }
}

export class NotionTranscriptItemByuser {
  constructor({
    id = generateCustomId(),
    type,
    value = null,
    userId,
    createdAt

  }) {
    this.id = id;
    this.type = type; // "config", "user"
    this.value = value;
    this.userId = userId;
    this.createdAt = createdAt;
  }
}

export class NotionDebugOverrides {
  constructor({
    emitAgentSearchExtractedResults = true,
    cachedInferences = {},
    annotationInferences = {},
    emitInferences = false
  }) {
    this.emitAgentSearchExtractedResults = emitAgentSearchExtractedResults;
    this.cachedInferences = cachedInferences;
    this.annotationInferences = annotationInferences;
    this.emitInferences = emitInferences;
  }
}

export function generateCustomId(userId = null, spaceId = null) {
  // 创建固定部分
  let prefix1 = '38bf0ee7';
  let prefix2 = '496e';
  
  if (spaceId) {
    // spaceId: e.g. e4bf0ee7-496e-81e1-8d0d-00031742a0c6
    // 我们从 spaceId 中提取后段作为 prefix1 的前几位或直接用 spaceId 的一部分。
    // 观察：网页端生成的 id 为 38bf0ee7-496e-807a-a092-00a92ebf0054
    // 网页端生成的 id 前8位是 38bf0ee7，这是由用户ID的第一部分 '38' 和空间ID的第二部分 '496e' 以及 '0e' 组合而来。
    // 具体分析：
    // userId: 38ad872b-594c-818e-a140-00028c984d07 -> 前两位 '38'
    // spaceId: e4bf0ee7-496e-81e1-8d0d-00031742a0c6 -> 第二部分 '496e'，第一部分后6位为 'bf0ee7'
    // 合并：userId的前2位 '38' + spaceId第一部分第3-8位 'bf0ee7' => '38bf0ee7'
    // prefix2: spaceId的第二部分 '496e'
    const userPart = userId ? userId.substring(0, 2) : '38';
    const spacePart1 = spaceId.substring(2, 8); // 'bf0ee7'
    prefix1 = userPart + spacePart1; // '38bf0ee7'
    prefix2 = spaceId.substring(9, 13); // '496e'
  }
  
  const prefix5 = '00aa';
  
  // 生成随机十六进制字符
  function randomHex(length) {
    return Array(length).fill(0).map(() => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
  
  // 组合所有部分
  const part3 = '80' + randomHex(2);  // 8xxx
  const part4 = randomHex(4);        // xxxx
  const part5 = prefix5 + randomHex(8); // 00aaxxxxxxxx
  
  return `${prefix1}-${prefix2}-${part3}-${part4}-${part5}`;
}

export class NotionRequestBody {
  constructor({
    traceId = randomUUID(),
    spaceId,
    transcript,
    threadId,
    threadParentPointer,
    createThread = false,
    debugOverrides = new NotionDebugOverrides({}),
    generateTitle = true,
    saveAllThreadOperations = true,
    setUnreadState = true,
    createdSource = "ai_module",
    threadType = "workflow",
    isPartialTranscript = false,
    asPatchResponse = true,
    patchResponseVersion = 2,
    isUserInAnySalesAssistedSpace = false,
    isSpaceSalesAssisted = false
  }) {
    this.traceId = traceId;
    this.spaceId = spaceId;
    this.transcript = transcript;
    if (threadId !== undefined) {
      this.threadId = threadId;
    }
    if (threadParentPointer !== undefined) {
      this.threadParentPointer = threadParentPointer;
    }
    this.createThread = createThread;
    this.debugOverrides = debugOverrides;
    this.generateTitle = generateTitle;
    this.saveAllThreadOperations = saveAllThreadOperations;
    this.setUnreadState = setUnreadState;
    this.createdSource = createdSource;
    this.threadType = threadType;
    this.isPartialTranscript = isPartialTranscript;
    this.asPatchResponse = asPatchResponse;
    this.patchResponseVersion = patchResponseVersion;
    this.isUserInAnySalesAssistedSpace = isUserInAnySalesAssistedSpace;
    this.isSpaceSalesAssisted = isSpaceSalesAssisted;
  }
}

// 输出模型 (OpenAI SSE)
export class ChoiceDelta {
  constructor({
    content = null
  }) {
    this.content = content;
  }
}

export class Choice {
  constructor({
    index = 0,
    delta,
    finish_reason = null
  }) {
    this.index = index;
    this.delta = delta;
    this.finish_reason = finish_reason;
  }
}

export class ChatCompletionChunk {
  constructor({
    id = `chatcmpl-${randomUUID()}`,
    object = "chat.completion.chunk",
    created = Math.floor(Date.now() / 1000),
    model = "notion-proxy",
    choices
  }) {
    this.id = id;
    this.object = object;
    this.created = created;
    this.model = model;
    this.choices = choices;
  }
}

// 模型列表端点 /v1/models
export class Model {
  constructor({
    id,
    object = "model",
    created = Math.floor(Date.now() / 1000),
    owned_by = "notion"
  }) {
    this.id = id;
    this.object = object;
    this.created = created;
    this.owned_by = owned_by;
  }
}

export class ModelList {
  constructor({
    object = "list",
    data
  }) {
    this.object = object;
    this.data = data;
  }
}
