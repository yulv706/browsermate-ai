const DEFAULT_SETTINGS = {
  endpoint: "",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.3,
  agentPermissionMode: "default",
  systemPrompt:
    "你是一个网页 AI 助手。回答必须优先基于用户当前浏览器视口中可见的网页内容；如果用户选中了文本，则选中文本优先级最高。整页正文只作为补充背景，不能覆盖当前可见内容。若可见内容不足以回答，请明确说明缺少哪些信息。回答要准确、简洁，并在有帮助时引用网页中的关键信息。",
};

const AI_REQUEST_TIMEOUT_MS = 90000;
const TAB_SESSION_TTL_MS = 30 * 60 * 1000;
const TAB_SESSION_KEY_PREFIX = "browsermate-tab-session:";
const tabSessionFallback = new Map();

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabSession(tabId).catch((error) => {
    console.warn("BrowserMate AI failed to clear tab session:", error);
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle-sidebar") return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && isSupportedPage(tab.url)) {
      await toggleAssistant(tab.id);
    }
  } catch (error) {
    console.warn("BrowserMate AI shortcut failed:", error);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BROWSERMATE_GET_PANEL_STATE") {
    getTabSession(sender.tab?.id)
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BROWSERMATE_PANEL_STATE") {
    updateTabSession(sender.tab?.id, message.payload)
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BROWSERMATE_AI_REQUEST") {
    completeWithAI(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BROWSERMATE_ACTION_PLAN") {
    planPageActions(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BROWSERMATE_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "BROWSERMATE_TOGGLE_TAB") {
    toggleAssistant(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BROWSERMATE_ASK_TAB") {
    askAssistant(message.tabId, message.question, { agentMode: Boolean(message.agentMode) })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "BROWSERMATE_AI_STREAM") return;

  let abortController = null;
  let isActive = false;

  port.onMessage.addListener((message) => {
    if (message?.type === "START") {
      if (isActive) {
        port.postMessage({ type: "ERROR", error: "上一条回复仍在生成中。" });
        return;
      }

      abortController = new AbortController();
      isActive = true;
      streamWithAI(message.payload, {
        signal: abortController.signal,
        onDelta: (delta) => port.postMessage({ type: "DELTA", delta }),
      })
        .then((result) => port.postMessage({ type: "DONE", result }))
        .catch((error) => {
          if (abortController?.signal.aborted) return;
          port.postMessage({ type: "ERROR", error: error.message });
        })
        .finally(() => {
          isActive = false;
        });
    }

    if (message?.type === "ABORT") {
      abortController?.abort();
      isActive = false;
      port.postMessage({ type: "ABORTED" });
    }
  });

  port.onDisconnect.addListener(() => {
    abortController?.abort();
  });
});

async function getSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getTabSession(tabId) {
  if (!tabId) return {};

  const key = getTabSessionKey(tabId);
  const session = await readTabSession(key);
  if (!session?.updatedAt || Date.now() - session.updatedAt > TAB_SESSION_TTL_MS) {
    await removeTabSession(tabId);
    return {};
  }

  return session;
}

async function updateTabSession(tabId, payload = {}) {
  if (!tabId) return {};

  const current = await getTabSession(tabId).catch(() => ({}));
  const next = {
    ...current,
    ...normalizeTabSessionPayload(payload),
    updatedAt: Date.now(),
  };

  await writeTabSession(getTabSessionKey(tabId), next);
  return next;
}

async function removeTabSession(tabId) {
  if (!tabId) return;

  const key = getTabSessionKey(tabId);
  tabSessionFallback.delete(key);
  if (chrome.storage?.session) {
    await chrome.storage.session.remove(key);
  }
}

function normalizeTabSessionPayload(payload = {}) {
  const normalized = {};

  if ("panelOpen" in payload) normalized.panelOpen = Boolean(payload.panelOpen);
  if ("agentMode" in payload) normalized.agentMode = Boolean(payload.agentMode);
  if ("actionActive" in payload) normalized.actionActive = Boolean(payload.actionActive);
  if ("restoreUntil" in payload) normalized.restoreUntil = Math.max(0, Number(payload.restoreUntil) || 0);
  if ("lastKnownUrl" in payload) normalized.lastKnownUrl = String(payload.lastKnownUrl || "").slice(0, 1000);
  if ("lastActionSummary" in payload) normalized.lastActionSummary = String(payload.lastActionSummary || "").slice(0, 240);
  if ("refreshReason" in payload) normalized.refreshReason = String(payload.refreshReason || "").slice(0, 80);
  if ("pendingFollowUp" in payload) normalized.pendingFollowUp = String(payload.pendingFollowUp || "").slice(0, 1000);
  if ("pendingFollowUpCreatedAt" in payload) {
    normalized.pendingFollowUpCreatedAt = Math.max(0, Number(payload.pendingFollowUpCreatedAt) || 0);
  }
  if ("pendingFollowUpSourceUrl" in payload) {
    normalized.pendingFollowUpSourceUrl = String(payload.pendingFollowUpSourceUrl || "").slice(0, 1000);
  }

  return normalized;
}

async function readTabSession(key) {
  if (chrome.storage?.session) {
    const data = await chrome.storage.session.get(key);
    return data[key] || {};
  }

  return tabSessionFallback.get(key) || {};
}

async function writeTabSession(key, session) {
  tabSessionFallback.set(key, session);
  if (chrome.storage?.session) {
    await chrome.storage.session.set({ [key]: session });
  }
}

function getTabSessionKey(tabId) {
  return `${TAB_SESSION_KEY_PREFIX}${tabId}`;
}

async function completeWithAI(payload) {
  const settings = await getSettings();
  const endpoint = normalizeEndpoint(settings.endpoint);

  if (!endpoint || !settings.apiKey) {
    throw new Error("请先在扩展选项页配置 AI 接口地址和 API Key。");
  }

  const messages = [
    { role: "system", content: settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt },
    ...buildContextMessages(payload),
  ];
  const request = buildChatRequest(settings, messages, false);

  const response = await fetchWithTimeout(endpoint, request);

  if (!response.ok) {
    throw new Error(await describeHttpError(response));
  }

  const data = await safeJson(response);
  const content = extractMessageContent(data);

  if (!content) {
    throw new Error("AI 接口没有返回可读内容，请检查中转站是否兼容 Chat Completions。");
  }

  return content.trim();
}

async function streamWithAI(payload, options = {}) {
  const settings = await getSettings();
  const endpoint = normalizeEndpoint(settings.endpoint);

  if (!endpoint || !settings.apiKey) {
    throw new Error("请先在扩展选项页配置 AI 接口地址和 API Key。");
  }

  const messages = [
    { role: "system", content: settings.systemPrompt || DEFAULT_SETTINGS.systemPrompt },
    ...buildContextMessages(payload),
  ];
  const request = buildChatRequest(settings, messages, true, options.signal);

  const response = await fetchWithTimeout(endpoint, request, AI_REQUEST_TIMEOUT_MS, options.signal);

  if (!response.ok) {
    throw new Error(await describeHttpError(response));
  }

  if (!response.body) {
    const content = extractMessageContent(await safeJson(response));
    if (content) return content.trim();
    throw new Error("AI 接口没有返回可读取的数据流。");
  }

  let fullText = "";
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let rawText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    rawText += chunk;
    buffer += chunk;
    const parts = buffer.split(/\n\n+/);
    buffer = parts.pop() || "";

    for (const part of parts) {
      const delta = parseSsePart(part);
      if (!delta) continue;
      fullText += delta;
      options.onDelta?.(delta);
    }
  }

  const tailChunk = decoder.decode();
  rawText += tailChunk;
  buffer += tailChunk;
  const tail = parseSsePart(buffer);
  if (tail) {
    fullText += tail;
    options.onDelta?.(tail);
  }

  if (!fullText.trim()) {
    const fallback = extractMessageContentFromText(rawText);
    if (fallback) return fallback.trim();
    throw new Error("AI 接口没有返回可读内容。");
  }

  return fullText.trim();
}

async function planPageActions(payload = {}) {
  const settings = await getSettings();
  const endpoint = normalizeEndpoint(settings.endpoint);

  if (!endpoint || !settings.apiKey) {
    throw new Error("请先在扩展选项页配置 AI 接口地址和 API Key。");
  }

  const messages = buildActionPlanMessages(payload);
  const request = buildChatRequest(settings, messages, false);
  const response = await fetchWithTimeout(endpoint, request);

  if (!response.ok) {
    throw new Error(await describeHttpError(response));
  }

  const content = extractMessageContent(await safeJson(response));
  if (!content) {
    throw new Error("AI 没有返回可执行的页面操作计划。");
  }

  return normalizeActionPlan(content);
}

function buildChatRequest(settings, messages, stream, signal) {
  return {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || DEFAULT_SETTINGS.model,
      messages,
      temperature: normalizeTemperature(settings.temperature),
      stream,
    }),
  };
}

function normalizeTemperature(value) {
  const number = Number(value ?? DEFAULT_SETTINGS.temperature);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.temperature;
  return Math.min(2, Math.max(0, number));
}

async function fetchWithTimeout(url, init = {}, timeoutMs = AI_REQUEST_TIMEOUT_MS, externalSignal) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort("timeout"), timeoutMs);
  const signals = [init.signal, externalSignal, timeoutController.signal].filter(Boolean);
  const signal = mergeAbortSignals(signals);

  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error("AI 接口响应超时，请稍后再试或检查中转站状态。");
    }
    if (error?.name === "AbortError") {
      throw new Error("请求已停止。");
    }
    throw new Error(`无法连接 AI 接口：${error?.message || "网络请求失败"}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function mergeAbortSignals(signals) {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function describeHttpError(response) {
  const body = await response.text().catch(() => "");
  const detail = extractErrorMessage(body) || trimForError(body);
  return `AI 接口请求失败：${response.status}${detail ? ` ${detail}` : ""}`;
}

function extractErrorMessage(body) {
  try {
    const data = JSON.parse(body);
    return data?.error?.message || data?.message || data?.detail || "";
  } catch {
    return "";
  }
}

function extractMessageContent(data) {
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;

  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  }

  return String(content || choice?.text || data?.output_text || "").trim();
}

function extractMessageContentFromText(text) {
  try {
    return extractMessageContent(JSON.parse(text));
  } catch {
    return "";
  }
}

function buildContextMessages(payload = {}) {
  const lines = [];

  if (payload.pageTitle) lines.push(`网页标题：${payload.pageTitle}`);
  if (payload.pageUrl) lines.push(`网页地址：${payload.pageUrl}`);
  if (payload.selectedText) lines.push(`用户选中的网页内容：\n${payload.selectedText}`);
  if (payload.relevantText) lines.push(`与用户问题匹配度较高的页面片段：\n${payload.relevantText}`);
  if (payload.viewportText) lines.push(`当前浏览器视口中可见的网页内容（优先使用）：\n${payload.viewportText}`);
  if (payload.pageText) lines.push(`整页正文补充（仅在可见内容不足时参考）：\n${payload.pageText}`);

  const context = lines.length
    ? `以下是从当前网页提取的上下文。优先级从高到低为：用户选中文本、与问题相关的页面片段、当前可见内容、整页正文补充。\n\n${lines.join("\n\n")}`
    : "";
  const question = payload.question?.trim() || "请根据当前网页内容回答。";

  return [
    {
      role: "user",
      content: context || "当前网页没有提取到可用正文。",
    },
    ...normalizeHistory(payload.history),
    {
      role: "user",
      content: `用户问题：${question}`,
    },
  ];
}

function buildActionPlanMessages(payload = {}) {
  const instruction = String(payload.instruction || "").trim();
  const elements = Array.isArray(payload.elements) ? payload.elements.slice(0, 80).map(toPlannerElement) : [];
  const pageInfo = {
    title: payload.pageTitle || "",
    url: payload.pageUrl || "",
    visibleText: String(payload.viewportText || "").slice(0, 3000),
    relevantText: String(payload.relevantText || "").slice(0, 1800),
    selectedText: String(payload.selectedText || "").slice(0, 1200),
    permissionMode: payload.permissionMode || "default",
    elements,
  };

  return [
    {
      role: "system",
      content:
        "你是 BrowserMate AI 的浏览器 Agent 操作规划器。你只能根据用户指令和给定的可操作元素列表生成安全、有限、可执行的页面操作计划。只返回 JSON，不要返回 Markdown、解释文本或代码块。JSON 格式必须为：{\"summary\":\"一句话概括计划\",\"steps\":[{\"action\":\"click|type|select|check|uncheck|scroll|wait\",\"targetId\":\"元素 id，可为空\",\"value\":\"输入值、选择值、滚动方向或等待毫秒，可为空\",\"reason\":\"为什么执行这一步\"}],\"followUpQuestion\":\"操作完成后需要基于新页面继续回答/分析的问题，可为空\",\"notes\":[\"必要的提醒\"]}。只能使用元素列表中存在的 targetId。不要臆造用户没有提供的姓名、邮箱、地址、密码、支付信息或其他个人信息。不要规划支付、购买、下单、转账、删除、注销、提交订单、上传文件、输入密码等高风险动作；遇到这类请求时返回空 steps 并在 notes 说明需要用户手动完成。若用户要求打开、进入、跳转、切换页面后继续分析、总结、解释、读取或回答，steps 只负责完成页面操作，并把后续阅读任务写入 followUpQuestion。若页面元素不足以完成任务，也返回空 steps 并说明缺少什么。permissionMode 只表示执行阶段权限，不允许你因此规划高风险动作。",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          instruction,
          page: pageInfo,
        },
        null,
        2,
      ),
    },
  ];
}

function toPlannerElement(element = {}) {
  return {
    id: String(element.id || ""),
    tag: String(element.tag || ""),
    type: String(element.type || ""),
    label: String(element.label || "").slice(0, 140),
    value: String(element.value || "").slice(0, 120),
    placeholder: String(element.placeholder || "").slice(0, 100),
    options: Array.isArray(element.options) ? element.options.slice(0, 30) : [],
    disabled: Boolean(element.disabled),
    visible: Boolean(element.visible),
    x: Number.isFinite(element.x) ? element.x : 0,
    y: Number.isFinite(element.y) ? element.y : 0,
  };
}

function normalizeActionPlan(content) {
  const parsed = parseJsonObject(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI 返回的页面操作计划不是有效 JSON。");
  }

  const allowedActions = new Set(["click", "type", "select", "check", "uncheck", "scroll", "wait"]);
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps
        .map((step) => ({
          action: String(step?.action || "").trim().toLowerCase(),
          targetId: String(step?.targetId || step?.target || "").trim(),
          value: String(step?.value ?? "").slice(0, 500),
          reason: String(step?.reason || "").slice(0, 240),
        }))
        .filter((step) => allowedActions.has(step.action))
        .slice(0, 10)
    : [];

  return {
    summary: String(parsed.summary || "页面操作计划").slice(0, 240),
    steps,
    followUpQuestion: String(parsed.followUpQuestion || parsed.followUp || "").slice(0, 500),
    notes: Array.isArray(parsed.notes) ? parsed.notes.map((note) => String(note).slice(0, 240)).slice(0, 5) : [],
  };
}

function parseJsonObject(content) {
  const text = String(content || "").trim();
  const withoutFence = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeHistory(history = []) {
  if (!Array.isArray(history) || history.length === 0) return [];

  const safeHistory = history
    .filter((item) => item && ["user", "assistant"].includes(item.role) && item.content)
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: String(item.content).slice(0, 1200),
    }));

  return safeHistory.length
    ? [
        {
          role: "system",
          content: "以下是本次侧边栏内最近几轮对话，仅用于理解用户追问；网页上下文仍然优先。",
        },
        ...safeHistory,
      ]
    : [];
}

function normalizeEndpoint(endpoint) {
  const value = String(endpoint || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return `${value}/v1/chat/completions`;
}

function trimForError(body) {
  return String(body || "").replace(/\s+/g, " ").slice(0, 300);
}

function parseSsePart(part) {
  const lines = String(part || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));
  let text = "";

  for (const line of lines) {
    const data = line.replace(/^data:\s*/, "");
    if (!data || data === "[DONE]") continue;

    try {
      const json = JSON.parse(data);
      const choice = json?.choices?.[0];
      text += extractDeltaContent(choice?.delta?.content) || choice?.text || json?.response || "";
    } catch {
      // Ignore malformed keepalive or vendor-specific event lines.
    }
  }

  return text;
}

function extractDeltaContent(content) {
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return content || "";
}

function isSupportedPage(url = "") {
  return /^https?:\/\//i.test(url);
}

async function toggleAssistant(tabId) {
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, { type: "BROWSERMATE_TOGGLE" });
}

async function askAssistant(tabId, question, options = {}) {
  await ensureContentScript(tabId);
  await chrome.tabs.sendMessage(tabId, {
    type: "BROWSERMATE_ASK",
    question,
    agentMode: Boolean(options.agentMode),
  });
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "BROWSERMATE_PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/contentScript.js"],
    });
  }
}
