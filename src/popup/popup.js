const statusEl = document.querySelector("#status");
const PAGE_SUMMARY_PROMPT = "请总结当前网页的主要内容，并列出关键结论。";

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-command]");
  if (!button) return;

  const command = button.dataset.command;

  if (command === "options") {
    chrome.runtime.openOptionsPage();
    return;
  }

  setStatus(command === "toggle" ? "正在打开侧边栏..." : "正在发送到侧边栏...");
  button.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
      setStatus("请先打开一个普通网页。");
      return;
    }

    const message =
      command === "toggle"
        ? { type: "PAGEMATE_TOGGLE_TAB", tabId: tab.id }
        : {
            type: "PAGEMATE_ASK_TAB",
            tabId: tab.id,
            question: command === "summarize" ? PAGE_SUMMARY_PROMPT : "",
          };
    const response = await chrome.runtime.sendMessage(message);
    if (response?.ok) {
      window.close();
    } else {
      setStatus(response?.error || "无法在当前页面打开侧边栏。");
    }
  } catch (error) {
    setStatus(error?.message || "无法在当前页面打开侧边栏。");
  } finally {
    button.disabled = false;
  }
});

function setStatus(message) {
  statusEl.textContent = message || "";
}
