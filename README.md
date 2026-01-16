# 🚀 网页划词翻译 (Webpage AI Translator)

![Version](https://img.shields.io/github/v/tag/wanghao6736/Webpage-AI-Translator) ![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Required-green)

一款基于 Tampermonkey 的网页划词翻译脚本。支持 **DeepSeek / OpenAI / Gemini / ChatAnywhere / AIS2API** 等 AI 模型的**流式输出**，同时保留了 Google / Bing 等免费翻译服务。

![Preview](images/web-ai-translator.gif)

## ✨ 核心特性

*   **🧠 多模态 AI 支持**：
    *   **DeepSeek** (推荐): 极速、高性价比，支持流式输出。
    *   **OpenAI**: 兼容 GPT-3.5/4 等模型。
    *   **Google Gemini**: 支持原生 SSE 流式协议。
    *   **ChatAnywhere**: 多个 AI 公司的 `API Key` 提供商。
    *   **AIS2API**: 将 `AI Studio` 的请求转换为 `API` 的形式。
*   **⚡ 极致体验**：
    *   **流式输出**: 像 ChatGPT 一样实时打字，拒绝等待 loading。
    *   **解释模式**: 点击 "释" 按钮，让 AI 充当计算机专家为你深度解析术语。
*   **🛡️ 隐私安全**：
    *   **本地存储**: `API Key` 存储在浏览器本地（Tampermonkey 安全存储），不通过任何第三方中转服务器。
    *   **UI 脱敏**: 设置菜单中 Key 自动脱敏显示（如 `sk-******`），防止窥屏。
    *   **iframe 隔离**: 脚本仅在主窗口运行，防止第三方广告框架窃取数据。
*   **⚙️ 便捷配置**：
    *   UI 自带下拉菜单，一键切换翻译源。
    *   无需修改代码，通过插件菜单即可录入/修改 API Key。

## 📦 安装指南

1.  请确保你的浏览器已安装 **Tampermonkey** 扩展 ([Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd))。

2.  点击下方链接安装脚本：

    👉 **[点击安装 / 更新脚本](https://raw.githubusercontent.com/wanghao6736/Webpage-AI-Translator/main/src/web-ai-translator.user.js)**

    *(如果无法访问，请尝试使用加速链接: [jsDelivr 安装](https://cdn.jsdelivr.net/gh/wanghao6736/Webpage-AI-Translator/main/src/web-ai-translator.user.js))*

## 🛠️ 使用说明

### 1. 基础使用 & 设置 Key

安装脚本后，免费服务（Google）可直接使用，Bing翻译服务还需完善。如需使用 AI 服务：

*   **设置 Key**: 点击浏览器右上角 Tampermonkey 图标 -> 选择 **⚙️ 设置 DeepSeek API Key** -> 粘贴 Key 并保存。
*   **普通网页**: 选中文字 -> 点击 "译" (翻译) 或 "释" (解释)。
*   **切换服务**: 
    *   **方法 A**: 划词后，点击图标旁边的 **⚙️ 齿轮按钮**，在下拉菜单中选择。
    *   **方法 B**: 修改代码中的 `activeService` 配置（不推荐，建议使用 UI 切换）。

### 2. 📄 如何翻译本地 PDF (必读)
由于 Chrome 原生 PDF 阅读器的安全限制，脚本无法直接在其中运行。请使用以下 **免安装、最简单** 的方法：

1.  打开 **[Mozilla PDF.js 官方阅读器](https://mozilla.github.io/pdf.js/web/viewer.html)** (这是一个纯前端网页，无需担心隐私)。
2.  将你电脑里的 PDF 文件 **直接拖拽 (Drag & Drop)** 到该网页中。
3.  现在你可以像在普通网页一样划词翻译了！脚本完美生效。

### 3. 💡 功能解释

脚本提供两个核心功能按钮，请注意区分：

*   **"译" 按钮（翻译模式）**：
    *   功能：将选中的文本翻译为目标语言（默认：简体中文）
    *   特点：直接翻译，不添加额外解释
    *   适用场景：快速理解外文内容

*   **"释" 按钮（解释模式）**：
    *   功能：使用 AI 对选中的文本进行**深度解释**，而非简单翻译
    *   特点：AI 会以计算机专家身份，详细解释术语、概念、技术细节等
    *   适用场景：理解复杂的技术术语、概念、代码片段等
    *   ⚠️ **注意**：解释模式仅支持 AI 服务（DeepSeek/OpenAI//GeminiChatAnywhere/AIS2API），免费服务（Google/Bing）不支持此功能

*   **修改目标语言**：
    *   当前默认目标语言为**简体中文**
    *   如需修改为其他语言，请在脚本中编辑 `CONFIG.prompts` 配置：
        *   将 `translate` 和 `explain` 提示词中的 `Simplified Chinese` 替换为你需要的语言（如 `English`、`Japanese`、`Korean` 等）
        *   对于免费服务（Google/Bing），还需修改对应服务配置中的 `tl`（Google）或 `to`（Bing）参数

## 🔌 支持的服务列表

| 服务 | 类型 | 需要 Key? | 特性 | API 文档 |
| :--- | :--- | :--- | :--- | :--- |
| **DeepSeek** | AI | ✅ | **推荐**，速度快，流式丝滑 | [📖 官方文档](https://api-docs.deepseek.com/) |
| **OpenAI** | AI | ✅ | 标准兼容协议 | [📖 官方文档](https://platform.openai.com/docs/introduction) |
| **Gemini** | AI | ✅ | Google 官方流式接口 | [📖 官方文档](https://ai.google.dev/api) |
| **ChatAnywhere** | AI | ✅ | 标准兼容协议 | [📖 官方文档](https://chatanywhere.apifox.cn) |
| **AIS2API** | AI | ✅ | 标准兼容协议 | [📖 Github 文档](https://github.com/iBenzene/AIStudioToAPI) |
| **Google** | Free | ❌ | 传统的谷歌翻译接口 | [📖 官方文档](https://cloud.google.com/translate/docs/reference/api-overview) |
| **Bing** | Free | ❌ | 微软翻译接口 | [📖 官方文档](https://learn.microsoft.com/en-us/azure/ai-services/translator/) |


## ⚠️ 免责声明

*   本脚本仅为方便个人阅读使用的辅助工具。
*   **关于 API Key**: 您的 API Key 仅保存在您本地浏览器的 Tampermonkey 扩展存储中，脚本通过直连方式请求官方 API。**开发者无法获取您的 Key。**
*   请自行控制 API 使用额度，建议在 AI 服务商后台设置消费上限。
