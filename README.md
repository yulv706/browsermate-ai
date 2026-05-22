# PageMate AI

PageMate AI 是一个开源的 Chrome 浏览器扩展。它会在网页右下角提供一个轻量 AI 侧边栏，读取当前页面标题、地址、可见内容、选中文本和正文缓存，然后基于这些上下文回答问题。

项目目录名 `weread-mate` 来自最初的微信读书辅助场景；当前扩展已经可以用于任意 `http/https` 网页，并对 `weread.qq.com` 做了正文提取优化。

## 功能

- 在普通网页右下角显示悬浮 AI 按钮。
- 通过侧边栏基于当前网页连续追问，并保留最近几轮对话上下文。
- 自动提取当前视口可见内容，选中文本会作为最高优先级引用。
- 缓存同一页面正文，减少连续追问时的重复提取。
- 支持流式 AI 回复、停止生成、失败重试和清空对话。
- 提供“一键总结网页”“提炼要点”“解释选中”“翻译选中”“继续追问”等快捷操作。
- 支持 Popup 快速打开侧边栏、总结当前页或进入提问状态。
- 支持兼容 OpenAI Chat Completions 的第三方服务或中转站。
- 支持快捷键 `Alt+W` 打开或收起侧边栏。

## 安装使用

### 从源码加载

1. 克隆或下载本仓库。
2. 打开 Chrome 的 `chrome://extensions/`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目根目录，也就是包含 `manifest.json` 的目录。
6. 点击扩展图标进入设置页，填入 AI 接口地址、API Key 和模型名。

### 配置 AI 服务

接口需要兼容 OpenAI Chat Completions。地址可以填写：

```text
https://api.example.com
https://api.example.com/v1
https://api.example.com/v1/chat/completions
```

扩展会自动补齐到 `/v1/chat/completions`。默认模型名是 `gpt-4o-mini`，你也可以填写任何目标服务支持的模型。

## 权限说明

PageMate AI 需要读取当前网页内容并把用户选择的问题发送给你配置的 AI 服务，因此声明了以下权限：

- `storage`：保存接口地址、API Key、模型名和提示词等设置。
- `activeTab`：让 Popup 可以操作当前标签页。
- `scripting`：在需要时向当前标签页注入内容脚本。
- `http://*/*` / `https://*/*`：在普通网页中显示侧边栏并提取页面上下文，也允许连接用户自定义的 AI 接口。

更多说明见 [docs/permissions.md](docs/permissions.md) 和 [PRIVACY.md](PRIVACY.md)。

## 开发

本项目是原生 Manifest V3 扩展，没有前端构建依赖。需要 Node.js 20 或更高版本来运行校验和打包脚本。

```bash
npm run validate
npm run package
```

`npm run package` 会生成 `dist/pagemate-ai-v0.1.0.zip`，可用于 GitHub Release 或手动上传到浏览器扩展商店。

## 项目结构

```text
manifest.json
icons/
src/
  background.js
  contentScript.js
  options/
  popup/
scripts/
  generate-icons.mjs
  package-extension.mjs
  validate-extension.mjs
docs/
  permissions.md
```

## 路线图

- 更细粒度的站点权限配置。
- Firefox / Edge 兼容性验证。
- 国际化文案。
- 可选的本地模型或自托管服务预设。

## 贡献

欢迎提交 Issue 和 Pull Request。开始之前建议先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目使用 [MIT License](LICENSE) 开源。
