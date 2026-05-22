const DEFAULT_SETTINGS = {
  endpoint: "",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.3,
  agentPermissionMode: "default",
  systemPrompt:
    "你是一个网页 AI 助手。回答必须优先基于用户当前浏览器视口中可见的网页内容；如果用户选中了文本，则选中文本优先级最高。整页正文只作为补充背景，不能覆盖当前可见内容。若可见内容不足以回答，请明确说明缺少哪些信息。回答要准确、简洁，并在有帮助时引用网页中的关键信息。",
};

const form = document.querySelector("#settings-form");
const statusEl = document.querySelector("#status");
const testButton = document.querySelector("#test");
const resetPromptButton = document.querySelector("#reset-prompt");
const submitButton = form.querySelector("button[type='submit']");

load();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await save();
});

testButton.addEventListener("click", async () => {
  await save({ quiet: true });
  setBusy(true);
  setStatus("正在测试连接...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "BROWSERMATE_AI_REQUEST",
      payload: {
        question: "请用一句话回复：BrowserMate AI 连接成功。",
        pageText: "这是一次设置页连接测试。",
      },
    });

    setStatus(response?.ok ? response.result : response?.error || "测试失败，请检查接口地址和 API Key。");
  } catch (error) {
    setStatus(error?.message || "测试失败，请检查接口地址和 API Key。");
  } finally {
    setBusy(false);
  }
});

resetPromptButton.addEventListener("click", () => {
  form.elements.systemPrompt.value = DEFAULT_SETTINGS.systemPrompt;
  setStatus("已恢复默认提示词，保存后生效。");
});

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  for (const [key, value] of Object.entries(settings)) {
    setFormValue(key, value);
  }
}

function setFormValue(key, value) {
  const field = form.elements[key];
  if (!field) return;

  const controls = typeof field.length === "number" && !field.tagName ? Array.from(field) : [field];
  const radio = controls.find((control) => control.type === "radio" && control.value === String(value));
  if (radio) {
    radio.checked = true;
    return;
  }

  if (field.type === "checkbox") {
    field.checked = Boolean(value);
    return;
  }

  field.value = value;
}

async function save(options = {}) {
  const data = Object.fromEntries(new FormData(form).entries());
  data.temperature = clampTemperature(data.temperature);
  data.endpoint = data.endpoint.trim();
  data.model = data.model.trim() || DEFAULT_SETTINGS.model;
  data.agentPermissionMode = normalizeAgentPermissionMode(data.agentPermissionMode);
  data.systemPrompt = data.systemPrompt.trim() || DEFAULT_SETTINGS.systemPrompt;

  await chrome.storage.sync.set(data);
  if (!options.quiet) setStatus("已保存设置。");
}

function clampTemperature(value) {
  const number = Number(value || DEFAULT_SETTINGS.temperature);
  if (!Number.isFinite(number)) return DEFAULT_SETTINGS.temperature;
  return Math.min(2, Math.max(0, number));
}

function normalizeAgentPermissionMode(value) {
  return ["default", "autoReview", "fullAccess"].includes(value) ? value : DEFAULT_SETTINGS.agentPermissionMode;
}

function setBusy(isBusy) {
  testButton.disabled = isBusy;
  resetPromptButton.disabled = isBusy;
  submitButton.disabled = isBusy;
}

function setStatus(message) {
  statusEl.textContent = message || "";
}
