(() => {
  if (window.__BROWSERMATE_AI_READY__) return;
  window.__BROWSERMATE_AI_READY__ = true;

  const MAX_PAGE_TEXT = 16000;
  const MAX_VIEWPORT_TEXT = 7000;
  const MAX_SELECTION_TEXT = 4000;
  const MAX_ACTION_ELEMENTS = 80;
  const PAGE_CACHE_TTL_MS = 45000;
  const AGENT_PERMISSION_MODES = {
    default: {
      label: "默认权限",
      description: "所有操作先确认",
    },
    autoReview: {
      label: "自动审查",
      description: "低风险自动执行",
    },
    fullAccess: {
      label: "完全权限",
      description: "支持动作自动执行",
    },
  };
  const QUICK_PROMPTS = {
    summarize: "请总结当前网页的主要内容，并列出关键结论。",
    "key-points": "请提炼当前网页最重要的 5 个要点。",
    explain: "请解释我选中的这段内容，先给出一句话结论，再补充关键细节。",
    translate: "请把我选中的这段内容翻译成简体中文，并保留关键术语。",
    questions: "请基于当前网页生成 5 个值得继续追问的问题。",
  };

  const state = {
    host: null,
    root: null,
    status: null,
    messages: null,
    textarea: null,
    quote: null,
    quoteText: null,
    quoteBody: null,
    contextMeta: null,
    sendButton: null,
    stopButton: null,
    permissionBadge: null,
    settings: null,
    composeMode: "auto",
    activePlan: null,
    conversation: [],
    pendingMessage: null,
    lastRequest: null,
    streamingText: "",
    streamPort: null,
    abortRequested: false,
    renderFrame: 0,
    pageCache: null,
    viewportCache: null,
    mutationObserver: null,
    mutationRefreshTimer: 0,
  };

  init();

  function init() {
    createAssistant();
    bindRuntimeMessages();
    observeRuntimeSettings();
    observeUrlChanges();
    observePageChanges();
    refreshContext();
  }

  function createAssistant() {
    state.host = document.createElement("div");
    state.host.id = "browsermate-ai-host";
    document.documentElement.appendChild(state.host);

    const shadow = state.host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>${getStyles()}</style>
      <button class="pm-toggle" type="button" aria-label="打开 BrowserMate AI">AI</button>
      <aside class="pm-panel" aria-label="BrowserMate AI" aria-hidden="true">
        <header class="pm-header">
          <div class="pm-brand">
            <span class="pm-mark" aria-hidden="true">B</span>
            <div>
              <strong>BrowserMate AI</strong>
              <span>AI 辅助浏览当前网页</span>
            </div>
          </div>
          <div class="pm-header-actions">
            <button class="pm-icon" data-action="refresh" type="button" title="刷新页面内容" aria-label="刷新页面内容">↻</button>
            <button class="pm-icon" data-action="clear" type="button" title="清空对话" aria-label="清空对话">⌫</button>
            <button class="pm-icon" data-action="options" type="button" title="设置" aria-label="设置">⚙</button>
            <button class="pm-icon" data-action="close" type="button" title="收起" aria-label="收起">×</button>
          </div>
        </header>

        <div class="pm-page-state">
          <span class="pm-meta"></span>
          <button class="pm-permission" data-action="cycle-permission" type="button" title="切换 Agent 权限" aria-label="切换 Agent 权限"></button>
        </div>

        <section class="pm-chat" aria-label="对话内容">
          <div class="pm-messages" aria-live="polite"></div>
        </section>

        <form class="pm-form">
          <div class="pm-quick-actions" aria-label="快捷操作">
            <button class="pm-chip" data-prompt="summarize" type="button">总结网页</button>
            <button class="pm-chip" data-prompt="key-points" type="button">提炼要点</button>
            <button class="pm-chip" data-prompt="explain" type="button">解释选中</button>
            <button class="pm-chip" data-prompt="translate" type="button">翻译选中</button>
            <button class="pm-chip" data-prompt="questions" type="button">继续追问</button>
            <button class="pm-chip" data-action="agent-mode" type="button">Agent 模式</button>
          </div>
          <div class="pm-quote" hidden>
            <div>
              <span>引用选中内容</span>
              <p></p>
            </div>
            <button data-action="clear-quote" type="button" title="取消引用" aria-label="取消引用">×</button>
          </div>
          <div class="pm-composer">
            <textarea rows="1" aria-label="向 BrowserMate Agent 下达任务" placeholder="提问，或让 Agent 操作当前网页..."></textarea>
            <button class="pm-stop" data-action="abort" type="button" title="停止生成" aria-label="停止生成" hidden>■</button>
            <button class="pm-send" type="submit" title="发送" aria-label="发送">↵</button>
          </div>
          <div class="pm-status" role="status" aria-live="polite"></div>
        </form>
      </aside>
    `;

    state.root = shadow;
    state.status = shadow.querySelector(".pm-status");
    state.messages = shadow.querySelector(".pm-messages");
    state.textarea = shadow.querySelector("textarea");
    state.quote = shadow.querySelector(".pm-quote");
    state.quoteBody = shadow.querySelector(".pm-quote p");
    state.contextMeta = shadow.querySelector(".pm-meta");
    state.permissionBadge = shadow.querySelector(".pm-permission");
    state.sendButton = shadow.querySelector(".pm-send");
    state.stopButton = shadow.querySelector(".pm-stop");

    loadRuntimeSettings().catch(handleRuntimeFailure);
    addMessage("assistant", "我已读取当前页面。你可以直接提问，也可以让我作为浏览器 Agent 操作当前网页。");
    shadow.querySelector(".pm-toggle").addEventListener("click", openPanel);
    shadow.querySelector(".pm-form").addEventListener("submit", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleAgentSubmit(state.textarea.value).catch(handleRuntimeFailure);
    });
    state.textarea.addEventListener("keydown", handleComposerKeydown);
    state.textarea.addEventListener("input", resizeComposer);
    resizeComposer();
    shadow.addEventListener("click", handleClick);
    isolateAssistantEvents(shadow);
    document.addEventListener("selectionchange", debounce(refreshContext, 250));
    window.addEventListener("scroll", debounce(refreshVisibleContext, 280), { passive: true });
    window.addEventListener("resize", debounce(refreshVisibleContext, 280), { passive: true });
  }

  function isolateAssistantEvents(shadow) {
    const shadowEvents = [
      "keydown",
      "keypress",
      "keyup",
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "paste",
      "copy",
      "cut",
      "wheel",
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "dblclick",
      "contextmenu",
    ];

    shadowEvents.forEach((eventName) => {
      shadow.addEventListener(
        eventName,
        (event) => {
          if (isAssistantEvent(event)) {
            event.stopPropagation();
          }
        },
        true,
      );
    });

    ["keydown", "keypress", "keyup", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"].forEach((eventName) => {
      window.addEventListener(
        eventName,
        (event) => {
          if (isAssistantEvent(event)) {
            event.stopImmediatePropagation();
          }
        },
        true,
      );
    });
  }

  function isAssistantEvent(event) {
    return event.composedPath?.().includes(state.host);
  }

  function bindRuntimeMessages() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === "BROWSERMATE_TOGGLE") {
        togglePanel();
      }
      if (message?.type === "BROWSERMATE_PING") {
        sendResponse({ ok: true });
        return true;
      }
      if (message?.type === "BROWSERMATE_ASK") {
        openPanel();
        if (message.agentMode) {
          enterAgentComposeMode();
        } else if (message.question) {
          handleAgentSubmit(message.question).catch(handleRuntimeFailure);
        } else {
          state.textarea.focus();
        }
      }
    });
  }

  async function loadRuntimeSettings() {
    const settings = await chrome.storage.sync.get({
      agentPermissionMode: "default",
    });
    state.settings = {
      agentPermissionMode: normalizeAgentPermissionMode(settings.agentPermissionMode),
    };
    updatePermissionBadge();
  }

  function observeRuntimeSettings() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes.agentPermissionMode) return;

      const nextMode = normalizeAgentPermissionMode(changes.agentPermissionMode.newValue);
      state.settings = {
        ...(state.settings || {}),
        agentPermissionMode: nextMode,
      };
      updatePermissionBadge();
      setStatus(`Agent 权限已更新为：${AGENT_PERMISSION_MODES[nextMode].label}`);
    });
  }

  async function cyclePermissionMode() {
    const modes = ["default", "autoReview", "fullAccess"];
    const current = getAgentPermissionMode();
    const next = modes[(modes.indexOf(current) + 1) % modes.length];

    state.settings = {
      ...(state.settings || {}),
      agentPermissionMode: next,
    };
    await chrome.storage.sync.set({ agentPermissionMode: next });
    updatePermissionBadge();
    setStatus(`Agent 权限已切换为：${AGENT_PERMISSION_MODES[next].label}`);
  }

  function getAgentPermissionMode() {
    return normalizeAgentPermissionMode(state.settings?.agentPermissionMode);
  }

  function normalizeAgentPermissionMode(value) {
    return AGENT_PERMISSION_MODES[value] ? value : "default";
  }

  function updatePermissionBadge() {
    if (!state.permissionBadge) return;
    const mode = getAgentPermissionMode();
    const config = AGENT_PERMISSION_MODES[mode];
    state.permissionBadge.textContent = `${config.label} · ${config.description}`;
    state.permissionBadge.dataset.mode = mode;
  }

  function observeUrlChanges() {
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href === lastUrl) return;

      lastUrl = location.href;
      invalidatePageCache();
      clearQuote();
      setTimeout(() => refreshContext(true), 400);
    }, 1000);
  }

  function observePageChanges() {
    if (!document.body || state.mutationObserver) return;

    state.mutationObserver = new MutationObserver((mutations) => {
      if (!mutations.some(isContentMutation)) return;
      invalidatePageCache();
      clearTimeout(state.mutationRefreshTimer);
      state.mutationRefreshTimer = setTimeout(() => {
        if (state.host.classList.contains("is-open")) refreshContext();
      }, 500);
    });

    state.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function isContentMutation(mutation) {
    const target = mutation.target;
    if (target?.getRootNode?.() === state.root || state.host?.contains(target)) return false;
    if (target?.parentElement?.closest?.("script, style, noscript, template, svg, canvas")) return false;
    return true;
  }

  function invalidatePageCache() {
    state.pageCache = null;
    state.viewportCache = null;
  }

  function handleClick(event) {
    const button = event.target.closest("button");
    if (!button) return;

    const action = button.dataset.action;
    const prompt = button.dataset.prompt;

    if (action === "close") closePanel();
    if (action === "clear") clearConversation();
    if (action === "clear-quote") clearQuote();
    if (action === "refresh") refreshContext(true);
    if (action === "abort") abortStreaming();
    if (action === "options") {
      safeSendMessage({ type: "BROWSERMATE_OPEN_OPTIONS" }).catch(handleRuntimeFailure);
    }
    if (action === "cycle-permission") {
      cyclePermissionMode().catch(handleRuntimeFailure);
    }
    if (action === "agent-mode") {
      enterAgentComposeMode();
    }
    if (action === "execute-plan") {
      executeActivePlan().catch(handleRuntimeFailure);
    }
    if (action === "discard-plan") {
      discardActivePlan();
    }
    if (action === "retry" && state.lastRequest) {
      retryLastRequest().catch(handleRuntimeFailure);
    }
    if (prompt) {
      handleQuickPrompt(prompt).catch(handleRuntimeFailure);
    }
  }

  async function handleQuickPrompt(prompt) {
    const question = QUICK_PROMPTS[prompt];
    if (!question) return;

    if ((prompt === "explain" || prompt === "translate") && !state.quoteText && !getSelectedText()) {
      setStatus("请先在网页中选中一段内容。");
      state.textarea.focus();
      return;
    }

    await askPage(question);
  }

  function enterAgentComposeMode() {
    openPanel();
    state.composeMode = "agent";
    state.textarea.placeholder = "描述你想让 Agent 在当前页面完成的任务...";
    state.textarea.focus();
    setStatus(`Agent 模式 · ${AGENT_PERMISSION_MODES[getAgentPermissionMode()].label}`);
  }

  function resetComposeMode() {
    state.composeMode = "auto";
    state.textarea.placeholder = "提问，或让 Agent 操作当前网页...";
  }

  async function retryLastRequest() {
    if (state.streamPort) {
      setStatus("上一条回复仍在生成中，可先停止生成。");
      return;
    }

    const payload = state.lastRequest;
    if (!payload) return;

    state.pendingMessage = addMessage("assistant", "正在重试上一条请求...", { pending: true });
    setBusy(true);
    setStatus("AI 正在回复...");
    await streamAIResponse(payload);
  }

  function handleComposerKeydown(event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();
    event.stopPropagation();
    handleAgentSubmit(state.textarea.value).catch(handleRuntimeFailure);
  }

  function shouldPlanPageAction(input) {
    const text = normalizeText(input).toLowerCase();
    if (!text) return false;

    const actionPatterns = [
      /(agent|自动操作|帮我操作|替我操作|执行这个页面任务|控制页面|操作页面)/,
      /^(帮我|请|给我)?(点击|打开|选择|勾选|取消勾选|填写|填入|输入|搜索|滚动|切换|关闭|展开|收起|登录到|跳转到)/,
      /(点击|打开|选择|勾选|取消勾选|填写|填入|输入|搜索|滚动|切换|关闭|展开|收起).*(按钮|链接|输入框|选项|页面|网页|菜单|标签|tab)/,
      /\b(click|open|select|check|uncheck|type|fill|search|scroll|toggle|close|expand|choose)\b/,
    ];

    return actionPatterns.some((pattern) => pattern.test(text));
  }

  function resizeComposer() {
    state.textarea.style.height = "auto";
    state.textarea.style.height = `${Math.min(state.textarea.scrollHeight, 132)}px`;
  }

  async function handleAgentSubmit(input) {
    const normalizedInput = normalizeText(input);
    if (!normalizedInput) {
      setStatus("请先输入一个问题或网页操作任务。");
      state.textarea.focus();
      return;
    }

    if (state.composeMode === "agent" || shouldPlanPageAction(normalizedInput)) {
      await planPageActions(normalizedInput);
    } else {
      await askPage(normalizedInput);
    }
  }

  async function askPage(question) {
    if (state.streamPort) {
      setStatus("上一条回复仍在生成中，可先停止生成。");
      return;
    }

    const context = getPageContext();
    const normalizedQuestion = normalizeText(question);

    if (!normalizedQuestion) {
      setStatus("请先输入一个问题。");
      state.textarea.focus();
      return;
    }

    openPanel();
    const quotedText = state.quoteText || context.selectedText;
    addMessage("user", normalizedQuestion, { quote: quotedText });
    resetComposeMode();
    state.textarea.value = "";
    resizeComposer();
    clearQuote();
    state.pendingMessage = addMessage("assistant", "正在基于当前网页思考...", { pending: true });
    setBusy(true);
    setStatus("AI 正在回复...");

    const payload = {
      question: normalizedQuestion,
      pageTitle: context.title,
      pageUrl: context.url,
      selectedText: limitText(quotedText, MAX_SELECTION_TEXT),
      viewportText: limitText(context.viewportText, MAX_VIEWPORT_TEXT),
      pageText: limitText(context.pageText, MAX_PAGE_TEXT),
      history: getRecentConversation(),
    };
    state.lastRequest = payload;

    await streamAIResponse(payload);
  }

  async function planPageActions(instructionInput) {
    if (state.streamPort) {
      setStatus("上一条回复仍在生成中，可先停止生成。");
      return;
    }

    const instruction = normalizeText(instructionInput ?? state.textarea.value);
    if (!instruction) {
      setStatus("请先输入你想让 AI 帮你操作页面的目标。");
      state.textarea.focus();
      return;
    }

    openPanel();
    const context = getPageContext();
    const actionContext = collectActionContext();
    const permissionMode = getAgentPermissionMode();
    addMessage("user", `请帮我操作页面：${instruction}`);
    resetComposeMode();
    state.textarea.value = "";
    resizeComposer();
    state.pendingMessage = addMessage("assistant", "正在分析页面可操作元素...", { pending: true });
    setBusy(true);
    setStatus("AI 正在规划页面操作...");

    try {
      const response = await safeSendMessage({
        type: "BROWSERMATE_ACTION_PLAN",
        payload: {
          instruction,
          pageTitle: context.title,
          pageUrl: context.url,
          selectedText: limitText(context.selectedText, MAX_SELECTION_TEXT),
          viewportText: limitText(context.viewportText, 3000),
          permissionMode,
          elements: actionContext.elements,
        },
      });

      if (!response?.ok) {
        throw new Error(response?.error || "无法生成页面操作计划。");
      }

      state.activePlan = {
        ...response.result,
        elements: actionContext.elements,
        permissionMode,
        createdAt: Date.now(),
      };
      updatePendingActionPlan(state.activePlan);
      await maybeAutoExecutePlan(state.activePlan);
    } finally {
      setBusy(false);
    }
  }

  async function maybeAutoExecutePlan(plan) {
    if (!plan.steps?.length) {
      setStatus("没有可执行步骤。");
      return;
    }

    const decision = getPlanExecutionDecision(plan);
    if (decision.auto) {
      setStatus(decision.reason);
      await executeActivePlan({ plan, auto: true });
      return;
    }

    setStatus(decision.reason);
  }

  function getPlanExecutionDecision(plan) {
    const mode = normalizeAgentPermissionMode(plan.permissionMode || getAgentPermissionMode());
    const blockedStep = plan.steps.find((step) => isBlockedActionStep(step, plan.elements));
    if (blockedStep) {
      return {
        auto: false,
        blocked: true,
        reason: "计划包含高风险动作，需要手动处理。",
      };
    }

    if (mode === "default") {
      return {
        auto: false,
        requiresConfirmation: true,
        reason: "默认权限：操作计划已生成，确认后可执行。",
      };
    }

    if (mode === "autoReview" && plan.steps.some((step) => isSensitiveActionStep(step, plan.elements))) {
      return {
        auto: false,
        requiresConfirmation: true,
        reason: "自动审查：计划包含敏感动作，确认后可执行。",
      };
    }

    return {
      auto: true,
      requiresConfirmation: false,
      reason: mode === "fullAccess" ? "完全权限：Agent 将自动执行支持的页面动作。" : "自动审查：低风险动作将自动执行。",
    };
  }

  async function executeActivePlan(options = {}) {
    const plan = options.plan || state.activePlan;
    if (!plan?.steps?.length) {
      setStatus("当前没有可执行的操作计划。");
      return;
    }

    const unsafeStep = plan.steps.find((step) => isBlockedActionStep(step, plan.elements));
    if (unsafeStep) {
      addMessage("assistant", `已拦截高风险操作：${describeActionStep(unsafeStep, plan.elements)}。请手动完成这类操作。`, { error: true });
      setStatus("已拦截高风险操作");
      return;
    }

    setStatus("正在执行页面操作...");
    addMessage("assistant", options.auto ? "Agent 正在自动执行页面操作计划。" : "开始执行已确认的页面操作计划。");

    for (let index = 0; index < plan.steps.length; index += 1) {
      const step = plan.steps[index];
      await performActionStep(step, plan.elements);
      setStatus(`已执行 ${index + 1}/${plan.steps.length}`);
      await delay(260);
    }

    addMessage("assistant", "页面操作计划已执行完成。");
    state.activePlan = null;
    setStatus("页面操作完成");
  }

  function discardActivePlan() {
    state.activePlan = null;
    addMessage("assistant", "已取消这份页面操作计划。");
    setStatus("已取消操作计划");
  }

  function streamAIResponse(payload) {
    return new Promise((resolve, reject) => {
      let settled = false;
      state.streamingText = "";
      state.abortRequested = false;

      try {
        state.streamPort = chrome.runtime.connect({ name: "BROWSERMATE_AI_STREAM" });
      } catch (error) {
        setBusy(false);
        reject(normalizeRuntimeError(error));
        return;
      }

      state.streamPort.onMessage.addListener((message) => {
        if (message?.type === "DELTA") {
          appendPendingMessage(message.delta || "");
        }

        if (message?.type === "DONE") {
          settled = true;
          finalizePendingMessage(message.result || state.streamingText);
          setStatus("完成");
          disconnectStream();
          setBusy(false);
          resolve();
        }

        if (message?.type === "ERROR") {
          settled = true;
          disconnectStream();
          setBusy(false);
          reject(new Error(message.error || "请求失败，请稍后再试。"));
        }

        if (message?.type === "ABORTED") {
          settled = true;
          disconnectStream();
          setBusy(false);
          resolve();
        }
      });

      state.streamPort.onDisconnect.addListener(() => {
        if (state.abortRequested || !state.pendingMessage) return;
        if (!settled) {
          state.streamPort = null;
          setBusy(false);
          reject(new Error("AI 流式连接中断，请稍后再试。"));
        }
      });

      state.streamPort.postMessage({ type: "START", payload });
    });
  }

  async function safeSendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      throw normalizeRuntimeError(error);
    }
  }

  function normalizeRuntimeError(error) {
    if (String(error?.message || "").includes("Extension context invalidated")) {
      return new Error("扩展刚刚被重新加载过，请刷新当前页面后再试。");
    }
    return error;
  }

  function handleRuntimeFailure(error) {
    openPanel();
    setBusy(false);
    if (state.pendingMessage) {
      updatePendingMessage(error?.message || "扩展通信失败，请刷新当前页面后再试。", true);
    } else {
      addMessage("assistant", error?.message || "扩展通信失败，请刷新当前页面后再试。", { error: true });
    }
    setStatus("未完成");
  }

  function addMessage(role, content, options = {}) {
    const message = document.createElement("article");
    message.className = `pm-message pm-${role}${options.pending ? " is-pending" : ""}${options.error ? " is-error" : ""}`;
    message.innerHTML = `
      ${options.quote ? `<div class="pm-message-quote">${escapeHtml(limitText(options.quote, 260))}</div>` : ""}
      <div class="pm-bubble">${role === "assistant" ? renderMarkdownLite(content) : escapeHtml(content)}</div>
    `;
    state.messages.appendChild(message);
    scrollMessagesToBottom();

    if (!options.pending) {
      rememberMessage(role, content);
    }

    return message;
  }

  function updatePendingMessage(content, isError = false) {
    if (!state.pendingMessage) return;

    cancelPendingRender();
    state.pendingMessage.classList.remove("is-pending");
    state.pendingMessage.classList.toggle("is-error", isError);
    state.pendingMessage.querySelector(".pm-bubble").innerHTML = isError ? renderErrorContent(content) : renderMarkdownLite(content);
    rememberMessage("assistant", content);
    scrollMessagesToBottom();
    state.pendingMessage = null;
  }

  function updatePendingActionPlan(plan) {
    if (!state.pendingMessage) return;

    cancelPendingRender();
    state.pendingMessage.classList.remove("is-pending");
    state.pendingMessage.querySelector(".pm-bubble").innerHTML = renderActionPlan(plan);
    rememberMessage("assistant", renderActionPlanText(plan));
    scrollMessagesToBottom();
    state.pendingMessage = null;
  }

  function appendPendingMessage(delta) {
    if (!state.pendingMessage || !delta) return;

    state.streamingText += delta;
    if (state.renderFrame) return;

    state.renderFrame = requestAnimationFrame(() => {
      state.renderFrame = 0;
      if (!state.pendingMessage) return;
      state.pendingMessage.querySelector(".pm-bubble").innerHTML = renderMarkdownLite(state.streamingText);
      scrollMessagesToBottom();
    });
  }

  function finalizePendingMessage(content) {
    if (!state.pendingMessage) return;

    cancelPendingRender();
    const finalContent = content || state.streamingText || "AI 没有返回可读内容。";
    state.pendingMessage.classList.remove("is-pending");
    state.pendingMessage.querySelector(".pm-bubble").innerHTML = renderMarkdownLite(finalContent);
    rememberMessage("assistant", finalContent);
    scrollMessagesToBottom();
    state.pendingMessage = null;
    state.streamingText = "";
  }

  function cancelPendingRender() {
    if (!state.renderFrame) return;
    cancelAnimationFrame(state.renderFrame);
    state.renderFrame = 0;
  }

  function scrollMessagesToBottom() {
    state.messages.scrollTop = state.messages.scrollHeight;
  }

  function rememberMessage(role, content) {
    state.conversation.push({ role, content: limitText(content, 1200) });
    state.conversation = state.conversation.slice(-12);
  }

  function getRecentConversation() {
    return state.conversation.slice(-8);
  }

  function clearConversation() {
    abortStreaming();
    state.conversation = [];
    state.pendingMessage = null;
    state.lastRequest = null;
    state.activePlan = null;
    state.streamingText = "";
    state.messages.textContent = "";
    addMessage("assistant", "对话已清空。当前网页内容仍会作为后续问题的上下文。");
    setStatus("已清空对话");
  }

  function abortStreaming() {
    if (!state.streamPort) return;
    state.abortRequested = true;
    try {
      state.streamPort.postMessage({ type: "ABORT" });
    } catch {
      disconnectStream();
    }
    setBusy(false);
    if (state.pendingMessage) {
      updatePendingMessage(state.streamingText || "已停止生成。");
    }
    setStatus("已停止生成");
  }

  function disconnectStream() {
    cancelPendingRender();
    try {
      state.streamPort?.disconnect();
    } catch {
      // Ignore duplicate disconnect calls.
    }
    state.streamPort = null;
    state.abortRequested = false;
  }

  function setBusy(isBusy) {
    state.sendButton.disabled = isBusy;
    state.stopButton.hidden = !isBusy;
  }

  function refreshContext(showStatus = false) {
    const context = getPageContext({ forceRefresh: showStatus });
    const selected = context.selectedText ? `已选 ${context.selectedText.length} 字` : "未选择文本";
    const viewportCount = context.viewportText ? `当前可见约 ${context.viewportText.length} 字` : "当前可见内容较少";
    const pageCount = context.pageText ? `缓存正文约 ${context.pageText.length} 字` : "未提取到正文";

    state.contextMeta.textContent = `${viewportCount} · ${pageCount} · ${selected}`;
    updateQuote(context.selectedText);
    if (showStatus) setStatus("页面内容缓存已刷新");
  }

  function refreshVisibleContext() {
    if (!state.host.classList.contains("is-open")) return;
    refreshContext();
  }

  function updateQuote(text) {
    const selectedText = normalizeText(text);
    const selection = window.getSelection();
    if (!selectedText || selection?.anchorNode?.getRootNode?.() === state.root) return;

    state.quoteText = selectedText;
    state.quote.hidden = false;
    state.quoteBody.textContent = limitText(selectedText, 180);
  }

  function clearQuote() {
    state.quoteText = "";
    state.quote.hidden = true;
    state.quoteBody.textContent = "";
  }

  function getPageContext(options = {}) {
    const selectedText = getSelectedText();
    const url = location.href;
    const title = normalizeText(document.title || getMetaContent("og:title") || getMetaContent("twitter:title"));
    const cacheExpired =
      !state.pageCache || state.pageCache.url !== url || options.forceRefresh || Date.now() - state.pageCache.cachedAt > PAGE_CACHE_TTL_MS;
    const viewportText = getViewportText(options);

    if (cacheExpired) {
      state.pageCache = {
        title,
        url,
        pageText: extractMainText(),
        cachedAt: Date.now(),
      };
    } else if (title && title !== state.pageCache.title) {
      state.pageCache.title = title;
    }

    return {
      title: state.pageCache.title,
      url: state.pageCache.url,
      selectedText,
      viewportText,
      pageText: state.pageCache.pageText,
      cachedAt: state.pageCache.cachedAt,
    };
  }

  function collectActionContext() {
    const selectors = [
      "button",
      "a[href]",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])",
    ];

    const elements = [];
    const seen = new Set();
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));

    for (const element of candidates) {
      if (elements.length >= MAX_ACTION_ELEMENTS) break;
      if (seen.has(element) || !isActionableElement(element)) continue;
      seen.add(element);

      const rect = element.getBoundingClientRect();
      const tag = element.tagName.toLowerCase();
      const type = normalizeText(element.getAttribute("type") || element.getAttribute("role") || tag).toLowerCase();
      const label = getActionElementLabel(element);
      if (!label && !["input", "textarea", "select"].includes(tag)) continue;

      const id = `e${elements.length + 1}`;
      element.dataset.browsermateActionId = id;
      elements.push({
        id,
        tag,
        type,
        label: limitText(label || `${tag} ${type}`, 140),
        value: getActionElementValue(element),
        placeholder: limitText(element.getAttribute("placeholder") || "", 100),
        options: getSelectOptions(element),
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        visible: isElementInViewport(rect),
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      });
    }

    return { elements };
  }

  function isActionableElement(element) {
    if (!element || state.host?.contains(element)) return false;
    if (element.closest("#browsermate-ai-host")) return false;
    if (element.closest("[hidden], [aria-hidden='true'], [inert]")) return false;
    if (element.matches("input[type='password'], input[type='file']")) return false;

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width >= 4 &&
      rect.height >= 4 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      !element.disabled &&
      element.getAttribute("aria-disabled") !== "true"
    );
  }

  function getActionElementLabel(element) {
    const aria = element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("alt");
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.innerText || "")
          .join(" ")
      : "";
    const associatedLabel =
      element.labels?.length
        ? Array.from(element.labels)
            .map((label) => label.innerText || "")
            .join(" ")
        : findExplicitLabelText(element);
    const wrappingLabel = element.closest("label")?.innerText || "";
    const text = element.innerText || element.textContent || "";

    return normalizeText(aria || labelledText || associatedLabel || wrappingLabel || text || element.getAttribute("name") || "");
  }

  function getActionElementValue(element) {
    if (!["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return "";
    if (element.type === "password") return "";
    return limitText(element.value || "", 120);
  }

  function getSelectOptions(element) {
    if (element.tagName !== "SELECT") return [];
    return Array.from(element.options)
      .slice(0, 30)
      .map((option) => normalizeText(option.textContent || option.value))
      .filter(Boolean);
  }

  function isElementInViewport(rect) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
  }

  function renderActionPlan(plan) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const notes = Array.isArray(plan.notes) ? plan.notes : [];
    const decision = getPlanExecutionDecision(plan);
    const mode = normalizeAgentPermissionMode(plan.permissionMode || getAgentPermissionMode());
    const stepItems = steps.map((step) => `<li>${escapeHtml(describeActionStep(step, plan.elements))}</li>`).join("");
    const noteItems = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");

    return `
      <div class="pm-plan">
        <strong>${escapeHtml(plan.summary || "页面操作计划")}</strong>
        <span class="pm-plan-mode">${escapeHtml(AGENT_PERMISSION_MODES[mode].label)} · ${escapeHtml(decision.reason)}</span>
        ${
          steps.length
            ? `<ol>${stepItems}</ol>
              ${
                decision.auto
                  ? ""
                  : `<div class="pm-plan-actions">
                      ${decision.blocked ? "" : `<button class="pm-inline-action" data-action="execute-plan" type="button">执行计划</button>`}
                      <button class="pm-inline-action" data-action="discard-plan" type="button">${decision.blocked ? "知道了" : "取消"}</button>
                    </div>`
              }`
            : "<p>没有生成可执行步骤。</p>"
        }
        ${noteItems ? `<div class="pm-plan-notes"><span>注意</span><ul>${noteItems}</ul></div>` : ""}
      </div>
    `;
  }

  function renderActionPlanText(plan) {
    const steps = Array.isArray(plan.steps) ? plan.steps : [];
    const notes = Array.isArray(plan.notes) ? plan.notes : [];
    const lines = [`${plan.summary || "页面操作计划"}`];

    if (steps.length) {
      lines.push("", ...steps.map((step, index) => `${index + 1}. ${describeActionStep(step, plan.elements)}`));
    } else {
      lines.push("", "没有生成可执行步骤。");
    }

    if (notes.length) {
      lines.push("", "注意：", ...notes.map((note) => `- ${note}`));
    }

    return lines.join("\n");
  }

  function describeActionStep(step, elements = []) {
    const element = elements.find((item) => item.id === step.targetId);
    const target = element ? `${element.label || element.tag}（${element.id}）` : step.targetId || "页面";
    const value = step.value ? `：${step.value}` : "";
    const reason = step.reason ? ` - ${step.reason}` : "";
    const actionLabels = {
      click: "点击",
      type: "输入",
      select: "选择",
      check: "勾选",
      uncheck: "取消勾选",
      scroll: "滚动",
      wait: "等待",
    };
    return `${actionLabels[step.action] || step.action} ${target}${value}${reason}`;
  }

  async function performActionStep(step, elements = []) {
    if (step.action === "wait") {
      await delay(Math.min(3000, Math.max(200, Number(step.value) || 800)));
      return;
    }

    if (step.action === "scroll") {
      const value = String(step.value || "").toLowerCase();
      const amount = value.includes("up") || value.includes("上") ? -Math.round(window.innerHeight * 0.72) : Math.round(window.innerHeight * 0.72);
      window.scrollBy({ top: amount, behavior: "smooth" });
      return;
    }

    const elementMeta = elements.find((item) => item.id === step.targetId);
    const element = elementMeta ? document.querySelector(`[data-browsermate-action-id="${escapeCssIdentifier(elementMeta.id)}"]`) : null;
    if (!element || !isActionableElement(element)) {
      throw new Error(`找不到可操作元素：${step.targetId || "未指定"}`);
    }

    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    await delay(260);
    element.focus?.({ preventScroll: true });

    if (step.action === "click") {
      element.click();
      return;
    }

    if (step.action === "type") {
      setElementValue(element, step.value || "");
      return;
    }

    if (step.action === "select") {
      setSelectValue(element, step.value || "");
      return;
    }

    if (step.action === "check" || step.action === "uncheck") {
      setCheckedValue(element, step.action === "check");
    }
  }

  function setElementValue(element, value) {
    if (element.matches("input[type='password'], input[type='file']")) {
      throw new Error("出于安全原因，BrowserMate AI 不会填写密码或文件输入框。");
    }

    if (element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return;
    }

    if (!["INPUT", "TEXTAREA"].includes(element.tagName)) {
      throw new Error("目标元素不是可输入控件。");
    }

    element.value = value;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setSelectValue(element, value) {
    if (element.tagName !== "SELECT") {
      throw new Error("目标元素不是下拉选择框。");
    }

    const option = Array.from(element.options).find((item) => item.value === value || normalizeText(item.textContent) === normalizeText(value));
    if (!option) {
      throw new Error(`下拉框中找不到选项：${value}`);
    }

    element.value = option.value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setCheckedValue(element, checked) {
    if (element.matches("input[type='checkbox'], input[type='radio']")) {
      if (element.checked !== checked) element.click();
      return;
    }

    if (["checkbox", "radio", "switch"].includes(element.getAttribute("role"))) {
      const current = element.getAttribute("aria-checked") === "true";
      if (current !== checked) element.click();
      return;
    }

    throw new Error("目标元素不是可勾选控件。");
  }

  function isBlockedActionStep(step, elements = []) {
    const element = elements.find((item) => item.id === step.targetId);
    const text = normalizeText(`${step.action} ${step.value || ""} ${step.reason || ""} ${element?.label || ""} ${element?.type || ""}`).toLowerCase();
    return /password|passwd|pwd|pay|payment|purchase|buy|order|checkout|delete|remove|destroy|transfer|withdraw|place order|密码|支付|付款|购买|下单|提交订单|删除|移除|注销|转账|提现|上传|文件/.test(
      text,
    );
  }

  function isSensitiveActionStep(step, elements = []) {
    const element = elements.find((item) => item.id === step.targetId);
    const text = normalizeText(`${step.action} ${step.value || ""} ${step.reason || ""} ${element?.label || ""} ${element?.type || ""}`).toLowerCase();
    return /submit|publish|save|confirm|send|post|apply|提交|保存|发布|确认|发送|发表|申请/.test(
      text,
    );
  }

  function extractMainText() {
    const candidates = collectReadableTextCandidates();
    const ranked = rankTextCandidates(candidates);
    if (ranked.length && ranked[0].score >= 900) {
      return ranked[0].text;
    }

    const fallback = collectParagraphText(document.body);
    if (isLikelyBodyText(fallback)) return fallback;

    return readElementText(document.body);
  }

  function getViewportText(options = {}) {
    const cacheKey = [
      location.href,
      Math.round(window.scrollX),
      Math.round(window.scrollY),
      window.innerWidth,
      window.innerHeight,
    ].join("|");

    if (!options.forceRefresh && state.viewportCache?.key === cacheKey && Date.now() - state.viewportCache.cachedAt < 700) {
      return state.viewportCache.text;
    }

    const text = extractViewportText();
    state.viewportCache = {
      key: cacheKey,
      text,
      cachedAt: Date.now(),
    };
    return text;
  }

  function extractViewportText() {
    if (!document.body) return "";

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const value = normalizeText(node.nodeValue);
        if (value.length < 2) return NodeFilter.FILTER_REJECT;
        if (isIgnorableTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const lines = [];
    let node = walker.nextNode();
    while (node) {
      const entry = getVisibleTextNodeEntry(node);
      if (entry) lines.push(entry);
      if (lines.length > 700) break;
      node = walker.nextNode();
    }

    return mergeViewportTextLines(lines);
  }

  function isIgnorableTextNode(node) {
    const element = node.parentElement;
    if (!element) return true;
    if (state.host?.contains(element)) return true;
    if (element.closest("script, style, noscript, template, svg, canvas, iframe, textarea, select, option")) return true;
    if (element.closest("[aria-hidden='true'], [hidden], [inert]")) return true;
    if (element.closest("#browsermate-ai-host")) return true;

    const style = window.getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0" ||
      (style.pointerEvents === "none" && element.closest("nav, header, footer"))
    ) {
      return true;
    }

    return false;
  }

  function getVisibleTextNodeEntry(node) {
    const text = normalizeText(node.nodeValue);
    if (!text || isNoiseLine(text)) return null;

    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter(isViewportRect);
    range.detach?.();
    if (!rects.length) return null;

    const bestRect = rects.sort((a, b) => visibleRectArea(b) - visibleRectArea(a))[0];
    return {
      text,
      top: Math.round(bestRect.top),
      left: Math.round(bestRect.left),
      area: visibleRectArea(bestRect),
      blockScore: scoreVisibleTextContainer(node.parentElement),
    };
  }

  function isViewportRect(rect) {
    if (!rect || rect.width <= 1 || rect.height <= 1) return false;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const gutter = 12;
    return rect.bottom > gutter && rect.right > gutter && rect.top < viewportHeight - gutter && rect.left < viewportWidth - gutter;
  }

  function visibleRectArea(rect) {
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const width = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function scoreVisibleTextContainer(element) {
    const container = element?.closest("article, main, [role='main'], section, p, li, h1, h2, h3, h4, blockquote") || element;
    if (!container) return 0;
    const tag = container.tagName?.toLowerCase();
    const className = String(container.className || "");
    let score = 0;

    if (["article", "main", "p", "li", "blockquote"].includes(tag)) score += 60;
    if (/content|article|chapter|reader|text|main/i.test(className)) score += 50;
    if (container.closest("nav, header, footer, aside")) score -= 120;
    if (container.closest("button, input, label, a")) score -= 45;

    return score;
  }

  function mergeViewportTextLines(lines) {
    const sorted = lines
      .filter((line) => line.area > 0 && line.blockScore > -130)
      .sort((a, b) => a.top - b.top || a.left - b.left || b.blockScore - a.blockScore);

    const unique = [];
    const seen = new Set();
    let totalLength = 0;

    for (const line of sorted) {
      const text = normalizeText(line.text);
      if (!text || seen.has(text) || isNoiseLine(text)) continue;
      seen.add(text);
      unique.push(text);
      totalLength += text.length + 2;
      if (totalLength >= MAX_VIEWPORT_TEXT) break;
    }

    return unique.join("\n");
  }

  function collectReadableTextCandidates() {
    const selectors = [
      "[class*='readerChapterContent']",
      "[class*='readerChapter']",
      "[class*='chapterContent']",
      "[class*='chapter-content']",
      "[class*='readerContent']",
      "[class*='ReaderContent']",
      "[class*='content']",
      "[class*='Content']",
      "main",
      "article",
      "[role='main']",
    ];

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, array) => array.indexOf(element) === index && isVisible(element));
  }

  function scoreTextElement(element) {
    const text = readElementText(element);
    const paragraphCount = element.querySelectorAll("p, li, h1, h2, h3").length;
    const childCount = element.children.length || 0;
    const blockCount = element.querySelectorAll("p, li, h1, h2, h3, section, article").length;
    const codeCount = element.querySelectorAll("code, pre, script, style, kbd, samp, textarea").length;
    const interactiveCount = element.querySelectorAll("button, input, select, textarea, a").length;
    const navCount = element.querySelectorAll("nav, header, footer, aside").length;
    const leafBonus = childCount <= 3 ? 260 : childCount <= 8 ? 120 : 0;
    const textDensity = Math.min(text.length / Math.max(childCount, 1), 260);
    const penalty = codeCount * 500 + interactiveCount * 120 + navCount * 220;
    return text.length + paragraphCount * 140 + blockCount * 70 + leafBonus + textDensity - penalty;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 180 &&
      rect.height > 80 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function isLikelyBodyText(text) {
    const value = normalizeText(text);
    if (value.length < 200) return false;
    if (/\b(function|const|let|var|class|import|export|body\s*\{|font-family|margin:\s*0)\b/.test(value)) {
      return false;
    }
    return true;
  }

  function readElementText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll("script, style, noscript, template, svg, canvas, iframe, button, input, select, textarea").forEach((node) =>
      node.remove(),
    );
    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function collectParagraphText(root) {
    if (!root) return "";

    const blocks = Array.from(root.querySelectorAll("p, li, h1, h2, h3, h4, blockquote"))
      .filter((element) => isVisible(element))
      .map((element) => readElementText(element))
      .filter((text) => text.length >= 12 && !isNoiseLine(text));

    const unique = [];
    for (const block of blocks) {
      if (!unique.includes(block)) unique.push(block);
      if (unique.join("\n\n").length > MAX_PAGE_TEXT) break;
    }

    return unique.join("\n\n");
  }

  function isNoiseLine(text) {
    return /^(上一章|下一章|目录|返回|首页|我的书架|设置|字体|字号|夜间|白天|章节|分享|评论|点赞|收藏|关注|广告|打开 App|下载 App)$/i.test(
      normalizeText(text),
    );
  }

  function collectTextCandidates() {
    const selectors = [
      "main",
      "article",
      "[role='main']",
      "[itemprop='articleBody']",
      "[class*='reader']",
      "[class*='Reader']",
      "[class*='content']",
      "[class*='Content']",
      "[class*='post']",
      "[class*='Post']",
      "[class*='article']",
      "[class*='Article']",
      "[class*='chapter']",
      "[class*='Chapter']",
      "[class*='text']",
      "[class*='Text']",
    ];

    const preferred = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, array) => array.indexOf(element) === index && isVisible(element));

    const general = Array.from(document.querySelectorAll("section, div"))
      .filter((element) => isVisible(element))
      .sort((a, b) => scoreTextElement(b) - scoreTextElement(a))
      .slice(0, 8);

    const body = document.body ? [document.body] : [];

    return [...preferred, ...general, ...body].filter((element, index, array) => array.indexOf(element) === index);
  }

  function rankTextCandidates(elements) {
    return elements
      .map((element) => {
        const text = readElementText(element);
        const score = scoreTextContent(element, text);
        return { element, text, score };
      })
      .filter((entry) => isLikelyBodyText(entry.text))
      .sort((a, b) => b.score - a.score);
  }

  function scoreTextContent(element, text) {
    const value = normalizeText(text);
    const lineCount = value.split(/\n+/).filter(Boolean).length;
    const sentenceCount = (value.match(/[。！？!?]/g) || []).length;
    const paragraphCount = element.querySelectorAll("p, li, h1, h2, h3, h4, blockquote").length;
    const childCount = element.children.length || 0;
    const blockCount = element.querySelectorAll("p, li, h1, h2, h3, section, article").length;
    const codeCount = element.querySelectorAll("code, pre, script, style, kbd, samp, textarea").length;
    const interactiveCount = element.querySelectorAll("button, input, select, textarea, a").length;
    const navCount = element.querySelectorAll("nav, header, footer, aside").length;
    const cjkCount = (value.match(/[\u4e00-\u9fff]/g) || []).length;
    const cjkRatio = cjkCount / Math.max(value.length, 1);
    const leafBonus = childCount <= 3 ? 220 : childCount <= 8 ? 100 : 0;
    const textDensity = Math.min(value.length / Math.max(childCount, 1), 320);
    const punctuationBonus = sentenceCount * 18 + lineCount * 24 + paragraphCount * 90 + blockCount * 40;
    const languageBonus = cjkRatio > 0.35 ? 120 : 0;
    const penalty = codeCount * 600 + interactiveCount * 140 + navCount * 260 + noisePenalty(value);

    return value.length + textDensity + leafBonus + punctuationBonus + languageBonus - penalty;
  }

  function noisePenalty(text) {
    const noisePatterns = [
      /仅支持付费会员使用/,
      /下一章|上一章/,
      /我的书架|首页|书城|发现|公众号/,
      /设置|字体|目录|分享|评论|夜间|白天/,
      /CSS\/样式代码|样式代码|代码块/,
      /function\s*\(|const\s+\w+\s*=|<style|<script/,
    ];

    return noisePatterns.reduce((score, pattern) => (pattern.test(text) ? score + 500 : score), 0);
  }

  function getSelectedText() {
    return normalizeText(window.getSelection()?.toString() || "");
  }

  function getMetaContent(name) {
    return document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content || "";
  }

  function openPanel() {
    state.host.classList.add("is-open");
    state.root.querySelector(".pm-panel").setAttribute("aria-hidden", "false");
    refreshContext();
    requestAnimationFrame(() => state.textarea.focus());
  }

  function closePanel() {
    state.host.classList.remove("is-open");
    state.root.querySelector(".pm-panel").setAttribute("aria-hidden", "true");
  }

  function togglePanel() {
    if (state.host.classList.contains("is-open")) {
      closePanel();
    } else {
      openPanel();
    }
  }

  function setStatus(message) {
    state.status.textContent = message || "";
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function limitText(text, maxLength) {
    const value = String(text || "").trim();
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}\n\n[内容过长，已截断]`;
  }

  function renderMarkdownLite(text) {
    const codeBlocks = [];
    const withoutCodeBlocks = String(text || "").replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, language, code) => {
      const index = codeBlocks.length;
      codeBlocks.push({
        language: String(language || "").trim(),
        code: String(code || "").replace(/\n$/, ""),
      });
      return `\n\n@@BROWSERMATE_CODE_BLOCK_${index}@@\n\n`;
    });

    const escaped = escapeHtml(withoutCodeBlocks);
    const html = escaped
      .replace(/^### (.*)$/gm, "<h4>$1</h4>")
      .replace(/^## (.*)$/gm, "<h3>$1</h3>")
      .replace(/^# (.*)$/gm, "<h3>$1</h3>")
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/^\s*[-*]\s+(.*)$/gm, "<li>$1</li>")
      .replace(/((?:<li>.*?<\/li>\n?)+)/gs, "<ul>$1</ul>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>");

    return codeBlocks.reduce((result, block, index) => {
      const language = block.language ? `<span>${escapeHtml(block.language)}</span>` : "";
      const code = escapeHtml(block.code);
      return result.replace(
        `<p>@@BROWSERMATE_CODE_BLOCK_${index}@@</p>`,
        `<pre>${language}<code>${code}</code></pre>`,
      );
    }, html);
  }

  function renderErrorContent(message) {
    const retryButton = state.lastRequest
      ? '<button class="pm-inline-action" data-action="retry" type="button">重试</button>'
      : "";
    return `<p>${escapeHtml(message || "请求失败，请稍后再试。")}</p>${retryButton}`;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeCssIdentifier(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function findExplicitLabelText(element) {
    if (!element.id) return "";
    return Array.from(document.querySelectorAll("label"))
      .filter((label) => label.htmlFor === element.id)
      .map((label) => label.innerText || "")
      .join(" ");
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function debounce(fn, delay) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function getStyles() {
    return `
      :host {
        all: initial;
        --pm-page: #f4f0e6;
        --pm-panel: #fffdf7;
        --pm-ink: #1d2528;
        --pm-muted: #69736e;
        --pm-line: #d9d0bf;
        --pm-brand: #1f665f;
        --pm-brand-dark: #163c42;
        --pm-accent: #c96e3d;
        --pm-danger: #9b3d2b;
        color: var(--pm-ink);
        font-family: ui-sans-serif, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
        position: relative;
        z-index: 2147483647;
      }

      * {
        box-sizing: border-box;
      }

      button,
      textarea {
        font: inherit;
        letter-spacing: 0;
      }

      button {
        cursor: pointer;
      }

      button:focus-visible,
      textarea:focus-visible {
        outline: 3px solid rgba(201, 110, 61, 0.32);
        outline-offset: 2px;
      }

      button:disabled {
        cursor: wait;
        opacity: 0.65;
      }

      .pm-toggle {
        position: fixed;
        right: 22px;
        bottom: 28px;
        display: grid;
        width: 48px;
        height: 48px;
        place-items: center;
        border: 1px solid rgba(43, 111, 101, 0.38);
        border-radius: 50%;
        background: var(--pm-brand-dark);
        box-shadow: 0 14px 30px rgba(22, 60, 66, 0.24);
        color: #f8df9e;
        font-weight: 900;
        transition:
          transform 160ms ease,
          box-shadow 160ms ease,
          background-color 160ms ease;
      }

      .pm-toggle:hover {
        background: var(--pm-brand);
        box-shadow: 0 18px 34px rgba(22, 60, 66, 0.28);
        transform: translateY(-2px);
      }

      .pm-panel {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        display: flex;
        width: min(420px, calc(100vw - 18px));
        flex-direction: column;
        gap: 10px;
        padding: 14px;
        border-left: 1px solid var(--pm-line);
        background:
          linear-gradient(145deg, rgba(31, 102, 95, 0.08), transparent 34%),
          var(--pm-page);
        box-shadow: -18px 0 42px rgba(38, 31, 18, 0.18);
        transform: translateX(104%);
        transition: transform 190ms ease;
      }

      :host(.is-open) .pm-panel {
        transform: translateX(0);
      }

      :host(.is-open) .pm-toggle {
        display: none;
      }

      .pm-header {
        display: flex;
        min-height: 46px;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .pm-brand {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 10px;
      }

      .pm-mark {
        display: grid;
        width: 36px;
        height: 36px;
        flex: 0 0 auto;
        place-items: center;
        border: 1px solid rgba(43, 111, 101, 0.3);
        border-radius: 8px;
        background: var(--pm-brand-dark);
        color: #f8df9e;
        font-weight: 900;
      }

      .pm-header strong,
      .pm-header span {
        display: block;
      }

      .pm-header strong {
        color: var(--pm-ink);
        font-size: 15px;
        line-height: 1.25;
      }

      .pm-header span,
      .pm-meta,
      .pm-status {
        color: var(--pm-muted);
        font-size: 12px;
        line-height: 1.5;
      }

      .pm-header-actions {
        display: flex;
        flex: 0 0 auto;
        gap: 6px;
      }

      .pm-icon,
      .pm-chip,
      .pm-inline-action,
      .pm-send,
      .pm-stop {
        border-radius: 8px;
        transition:
          background-color 140ms ease,
          border-color 140ms ease,
          transform 140ms ease;
      }

      .pm-icon {
        width: 32px;
        height: 32px;
        border: 1px solid var(--pm-line);
        background: #fffaf0;
        color: #33413e;
      }

      .pm-icon:hover,
      .pm-chip:hover,
      .pm-inline-action:hover,
      .pm-send:hover,
      .pm-stop:hover {
        border-color: rgba(201, 110, 61, 0.65);
        transform: translateY(-1px);
      }

      .pm-page-state {
        display: flex;
        min-height: 24px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 2px;
      }

      .pm-meta {
        display: block;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pm-permission {
        flex: 0 0 auto;
        border: 1px solid var(--pm-line);
        border-radius: 999px;
        background: #fffaf0;
        color: #4d5a55;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.2;
        max-width: 178px;
        overflow: hidden;
        padding: 4px 8px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .pm-permission[data-mode="autoReview"] {
        border-color: rgba(201, 110, 61, 0.55);
        color: #8a5734;
      }

      .pm-permission[data-mode="fullAccess"] {
        border-color: rgba(155, 61, 43, 0.45);
        color: var(--pm-danger);
      }

      .pm-chat,
      .pm-form {
        border: 1px solid var(--pm-line);
        border-radius: 8px;
        background: var(--pm-panel);
      }

      .pm-chat {
        flex: 1;
        min-height: 172px;
        overflow: hidden;
        padding: 12px;
      }

      .pm-messages {
        display: flex;
        height: 100%;
        min-height: 100%;
        flex-direction: column;
        gap: 10px;
        overflow: auto;
        overscroll-behavior: contain;
        padding-right: 2px;
        scrollbar-width: thin;
      }

      .pm-message {
        display: flex;
        width: 100%;
        flex-direction: column;
      }

      .pm-message.pm-user {
        align-items: flex-end;
      }

      .pm-message.pm-assistant {
        align-items: flex-start;
      }

      .pm-bubble {
        max-width: 86%;
        overflow-wrap: anywhere;
        border-radius: 16px;
        color: var(--pm-ink);
        font-size: 13px;
        line-height: 1.65;
        padding: 9px 11px;
      }

      .pm-user .pm-bubble {
        border-bottom-right-radius: 5px;
        background: #dceee8;
        color: #173936;
      }

      .pm-assistant .pm-bubble {
        border: 1px solid #ded3bf;
        border-bottom-left-radius: 5px;
        background: #fff8ea;
      }

      .pm-message.is-pending .pm-bubble {
        color: #6c756f;
      }

      .pm-message.is-pending .pm-bubble::after {
        content: "";
        display: inline-block;
        width: 6px;
        height: 6px;
        margin-left: 6px;
        border-radius: 50%;
        background: var(--pm-accent);
        animation: pm-pulse 900ms ease-in-out infinite;
        vertical-align: middle;
      }

      .pm-message.is-error .pm-bubble {
        border-color: #e6b4a4;
        background: #fff1ea;
        color: var(--pm-danger);
      }

      .pm-inline-action {
        min-height: 28px;
        margin-top: 8px;
        border: 1px solid #d99576;
        border-radius: 8px;
        background: #fffaf0;
        color: var(--pm-danger);
        font-size: 12px;
        font-weight: 800;
        padding: 4px 10px;
      }

      .pm-plan {
        display: grid;
        gap: 8px;
      }

      .pm-plan strong {
        color: #172d2c;
        font-size: 13px;
        line-height: 1.45;
      }

      .pm-plan-mode {
        display: block;
        border: 1px solid #ded3bf;
        border-radius: 999px;
        background: #fffaf0;
        color: #66706b;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.3;
        padding: 4px 8px;
      }

      .pm-plan ol,
      .pm-plan ul {
        margin: 0;
        padding-left: 18px;
      }

      .pm-plan li {
        margin: 4px 0;
      }

      .pm-plan-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .pm-plan-notes {
        border-left: 3px solid #d99576;
        border-radius: 6px;
        background: #fff4e2;
        padding: 7px 8px;
      }

      .pm-plan-notes span {
        display: block;
        margin-bottom: 4px;
        color: #8b5736;
        font-size: 11px;
        font-weight: 800;
      }

      .pm-message-quote {
        max-width: 84%;
        margin-bottom: 5px;
        border-left: 3px solid var(--pm-accent);
        border-radius: 8px;
        background: #fff6e6;
        color: #6b5c48;
        font-size: 12px;
        line-height: 1.45;
        padding: 7px 9px;
      }

      .pm-user .pm-message-quote {
        text-align: left;
      }

      .pm-bubble p {
        margin: 0 0 10px;
      }

      .pm-bubble p:last-child {
        margin-bottom: 0;
      }

      .pm-bubble h3,
      .pm-bubble h4 {
        font-size: 14px;
        margin: 12px 0 6px;
      }

      .pm-bubble ul {
        margin: 0 0 10px;
        padding-left: 18px;
      }

      .pm-bubble code {
        border-radius: 5px;
        background: rgba(31, 37, 40, 0.08);
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        font-size: 12px;
        padding: 1px 4px;
      }

      .pm-bubble pre {
        max-width: 100%;
        overflow: auto;
        margin: 8px 0 10px;
        border-radius: 8px;
        background: #18292d;
        color: #eef7f4;
        padding: 10px;
        white-space: pre;
      }

      .pm-bubble pre span {
        display: block;
        margin-bottom: 6px;
        color: #c0d2cc;
        font-size: 11px;
        line-height: 1.4;
      }

      .pm-bubble pre code {
        display: block;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font-size: 12px;
        line-height: 1.55;
        padding: 0;
      }

      .pm-form {
        padding: 10px;
      }

      .pm-quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 8px;
      }

      .pm-chip {
        min-height: 28px;
        border: 1px solid var(--pm-line);
        background: #fffaf0;
        color: #3d4947;
        font-size: 12px;
        font-weight: 750;
        padding: 4px 10px;
      }

      .pm-quote {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 8px;
        border: 1px solid #dfd1b7;
        border-left: 3px solid var(--pm-accent);
        border-radius: 8px;
        background: #fff6e6;
        padding: 7px 8px;
      }

      .pm-quote[hidden] {
        display: none;
      }

      .pm-quote span {
        display: block;
        margin-bottom: 4px;
        color: var(--pm-accent);
        font-size: 11px;
        font-weight: 800;
        line-height: 1.2;
      }

      .pm-quote p {
        max-height: 52px;
        overflow: hidden;
        margin: 0;
        color: #625849;
        font-size: 12px;
        line-height: 1.45;
      }

      .pm-quote button {
        border: 0;
        background: transparent;
        color: #705f4a;
        font-size: 18px;
        line-height: 1;
        padding: 0 2px;
      }

      .pm-composer {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        border: 1px solid #cfc5b4;
        border-radius: 8px;
        background: #fff;
        padding: 3px;
      }

      .pm-composer:focus-within {
        border-color: var(--pm-accent);
        box-shadow: 0 0 0 3px rgba(201, 110, 61, 0.18);
      }

      textarea {
        width: 100%;
        min-height: 38px;
        max-height: 132px;
        resize: none;
        border: 0;
        background: transparent;
        color: var(--pm-ink);
        font-size: 13px;
        line-height: 1.5;
        outline: none;
        padding: 9px 8px;
      }

      textarea::placeholder {
        color: #89908b;
      }

      .pm-send,
      .pm-stop {
        flex: 0 0 auto;
        width: 34px;
        height: 34px;
        margin: 2px;
        border: 1px solid var(--pm-brand);
        background: var(--pm-brand);
        color: #fff;
        font-weight: 800;
      }

      .pm-stop {
        border-color: var(--pm-danger);
        background: var(--pm-danger);
        font-size: 10px;
      }

      .pm-stop[hidden] {
        display: none;
      }

      .pm-status {
        min-height: 18px;
        padding: 7px 2px 0;
      }

      @keyframes pm-pulse {
        0%,
        100% {
          opacity: 0.35;
          transform: translateY(0);
        }
        50% {
          opacity: 1;
          transform: translateY(-1px);
        }
      }

      @media (max-width: 640px) {
        .pm-panel {
          width: 100vw;
          padding: 12px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .pm-toggle,
        .pm-panel,
        .pm-icon,
        .pm-chip,
        .pm-inline-action,
        .pm-send,
        .pm-stop {
          transition: none;
        }

        .pm-toggle:hover,
        .pm-icon:hover,
        .pm-chip:hover,
        .pm-inline-action:hover,
        .pm-send:hover,
        .pm-stop:hover {
          transform: none;
        }

        .pm-message.is-pending .pm-bubble::after {
          animation: none;
        }
      }
    `;
  }
})();
