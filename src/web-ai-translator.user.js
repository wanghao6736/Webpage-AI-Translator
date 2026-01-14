// ==UserScript==
// @name         网页划词翻译 (Webpage AI Translator)
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  支持流式输出、解释模式、配置分离的划词翻译脚本。支持 DeepSeek/OpenAI/Gemini/Google 等。
// @author       Wang Hao
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @noframes
// @connect      translate.googleapis.com
// @connect      api.openai.com
// @connect      api.deepseek.com
// @connect      generativelanguage.googleapis.com
// @connect      api-free.deepl.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @homepage     https://github.com/wanghao6736/Webpage-AI-Translator
// @updateURL    https://raw.githubusercontent.com/wanghao6736/Webpage-AI-Translator/main/src/web-ai-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/wanghao6736/Webpage-AI-Translator/main/src/web-ai-translator.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ========================================================================
    // 1. 配置模块 (Configuration)
    // ========================================================================
    const CONFIG = {
        // [切换服务]: 这里填写 services 中的 key
        activeService: 'gemini',

        // 通用提示词模板
        prompts: {
            translate: 'You are a professional translator. Translate the following text into Simplified Chinese directly without explanation:\n\n{text}',
            explain: 'You are a computer science expert. Explain the following text in Simplified Chinese clearly:\n\n{text}'
        },

        ui: {
            iconTrans: '译',
            iconExplain: '释',
            iconSettings: '⚙️',
            zIndex: 999999,
            offset: { x: 5, y: 5 }
        },

        services: {
            // --- AI 服务 (推荐) ---
            deepseek: {
                type: 'ai',
                provider: 'openai_compatible', // DeepSeek 兼容 OpenAI 协议
                baseUrl: 'https://api.deepseek.com',
                model: 'deepseek-chat',
                deltaPath: 'choices.0.delta.content'
            },

            openai: {
                type: 'ai',
                provider: 'openai_compatible',
                baseUrl: 'https://api.openai.com/v1',
                model: 'gpt-3.5-turbo',
                deltaPath: 'choices.0.delta.content'
            },

            gemini: {
                type: 'ai',
                provider: 'gemini',
                baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
                model: 'gemini-2.5-flash-lite',
                deltaPath: 'candidates.0.content.parts.0.text'
            },

            // --- 免费服务 (传统 API) ---
            google: {
                type: 'free',
                url: 'https://translate.googleapis.com/translate_a/single',
                params: { client: 'gtx', dt: 't', sl: 'auto', tl: 'zh-CN', q: '{text}' },
                parser: 'google_gtx'
            },

            bing: {
                type: 'free',
                url: 'https://api-edge.cognitive.microsofttranslator.com/translate',
                params: { 'api-version': '3.0', to: 'zh-Hans', text: '{text}' },
                headers: { 'Authorization': 'Bearer' }, // 这里的 Bearer 通常需要动态获取，仅作示例
                responsePath: '0.translations.0.text'
            }
        }
    };
    // ========================================================================
    // 1.1 工具函数 (Utility)
    // ========================================================================
    const capitalize = s => s && s[0].toUpperCase() + s.slice(1);

    // ========================================================================
    // 2. 核心逻辑层 (Core Logic)
    // ========================================================================
    class TranslationService {
        constructor(config) {
            this.config = config;
            this.buffer = '';
            this._initMenus(); // 初始化菜单
        }

        // 注册菜单命令，支持脱敏显示
        _initMenus() {
            Object.keys(this.config.services).forEach(key => {
                const cfg = this.config.services[key];
                if (cfg.type === 'ai') {
                    GM_registerMenuCommand(`设置 ${capitalize(key)} API Key`, () => {
                        const savedKey = GM_getValue(`key_${key}`, '');

                        let maskKey = '未设置';
                        if (savedKey) {
                            const start = savedKey.substring(0, 3);
                            const end = savedKey.substring(savedKey.length - 4);
                            maskKey = `${start}**********${end}`;
                        }

                        const msg = `当前 ${capitalize(key)} Key: [ ${maskKey} ]\n\n👇 如需修改，请在下方输入新 Key (留空取消):`;
                        const newKey = prompt(msg, '');

                        if (newKey && newKey.trim().length > 0) {
                            GM_setValue(`key_${key}`, newKey.trim());
                            alert(`✅ ${capitalize(key)} API Key 已更新！`);
                        }
                    });
                }
            });
        }

        getActiveKey() {
            const savedKey = GM_getValue('preferred_service', null);

            if (savedKey && this.config.services[savedKey]) {
                return savedKey;
            }
            return this.config.activeService;
        }

        setActiveKey(key) {
            if (this.config.services[key]) {
                GM_setValue('preferred_service', key);
            }
        }

        async request(text, mode, onUpdate) {
            const serviceKey = this.getActiveKey();
            const cfg = this.config.services[serviceKey];

            if (!cfg) throw new Error(`Service [${serviceKey}] not found.`);

            if (cfg.type === 'ai') {
                const key = GM_getValue(`key_${serviceKey}`, '');

                if (!key) {
                    onUpdate(`请先点击插件图标，在菜单中设置 [${serviceKey}] 的 API Key`, true);
                    return;
                }
                cfg.apiKey = key; // 临时注入
            }

            // 1. 处理免费的 GET 请求
            if (cfg.type === 'free') {
                if (mode === 'explain') {
                    onUpdate(`⚠️ 免费接口 ${capitalize(serviceKey)} 不支持“解释”模式，请切换至 AI 服务。`, true);
                    return;
                }
                const result = await this._requestFree(text, cfg);
                onUpdate(result, true);
                return;
            }

            // 2. 处理 AI 流式请求
            if (cfg.type === 'ai') {
                const promptTpl = this.config.prompts[mode] || this.config.prompts.translate;
                const finalPrompt = promptTpl.replace('{text}', text);
                await this._requestAiStream(cfg, finalPrompt, onUpdate);
                return;
            }
        }

        // --- 免费接口实现 ---
        _requestFree(text, cfg) {
            return new Promise((resolve, reject) => {
                const params = new URLSearchParams();
                Object.entries(cfg.params).forEach(([k, v]) => params.append(k, v.replace('{text}', text)));

                GM_xmlhttpRequest({
                    method: "GET",
                    url: `${cfg.url}?${params.toString()}`,
                    headers: cfg.headers || {},
                    onload: (res) => {
                        try {
                            const data = JSON.parse(res.responseText);
                            // Google 特殊解析逻辑
                            if (cfg.parser === 'google_gtx') {
                                resolve(data[0].map(i => i[0]).join(''));
                            } else {
                                resolve(this._getValue(data, cfg.responsePath));
                            }
                        } catch (e) { reject(e); }
                    },
                    onerror: reject
                });
            });
        }

        // --- AI 流式核心实现 (Fetch + Stream) ---
        _requestAiStream(cfg, prompt, onUpdate) {
            return new Promise((resolve, reject) => {
                const { url, headers, body } = this._buildRequestParams(cfg, prompt);

                GM_xmlhttpRequest({
                    method: "POST",
                    url: url,
                    headers: headers,
                    data: JSON.stringify(body),
                    responseType: 'stream', // 关键：使用流模式绕过缓冲
                    fetch: true, // 关键：开启 fetch 支持

                    onloadstart: async (res) => {
                        if (!res.response) {
                            console.warn("No response stream.");
                            return;
                        }
                        const reader = res.response.getReader();
                        const decoder = new TextDecoder();
                        this.buffer = '';

                        try {
                            while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;

                                const chunk = decoder.decode(value, { stream: true });
                                this.buffer += chunk;
                                this._parseBuffer(cfg, onUpdate);
                            }
                            onUpdate('', true); // 结束
                            resolve();
                        } catch (err) {
                            reject(err);
                        }
                    },
                    onerror: (err) => {
                        onUpdate(`\n[Network Error]`, true);
                        reject(err);
                    }
                });
            });
        }

        // --- 参数构建工厂 (Provider Factory) ---
        _buildRequestParams(cfg, prompt) {
            // 1. OpenAI 兼容协议 (DeepSeek, OpenAI, Moonshot...)
            if (cfg.provider === 'openai_compatible') {
                return {
                    url: `${cfg.baseUrl}/chat/completions`,
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${cfg.apiKey}`,
                        'Accept': 'text/event-stream'
                    },
                    body: {
                        model: cfg.model,
                        messages: [{ role: 'user', content: prompt }],
                        stream: true
                    }
                };
            }

            // 2. Google Gemini 协议
            if (cfg.provider === 'gemini') {
                return {
                    // Gemini 流式需要加上 alt=sse
                    url: `${cfg.baseUrl}/${cfg.model}:streamGenerateContent?alt=sse`,
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': cfg.apiKey // 推荐使用 Header 传参
                    },
                    body: {
                        contents: [{ parts: [{ text: prompt }] }]
                    }
                };
            }

            throw new Error(`Unknown provider: ${cfg.provider}`);
        }

        // --- 统一流解析器 ---
        _parseBuffer(cfg, onUpdate) {
            const lines = this.buffer.split('\n');
            // 保留最后一个可能不完整的片段
            this.buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                    const jsonStr = trimmed.substring(6); // 去掉 "data: "
                    try {
                        const data = JSON.parse(jsonStr);
                        const content = this._getValue(data, cfg.deltaPath);
                        if (content) onUpdate(content, false);
                    } catch (e) {
                        // 忽略解析错误的行（通常是 Keep-Alive 信号或格式错误）
                    }
                }
            }
        }

        _getValue(obj, path) {
            if (!path) return null;
            return path.split('.').reduce((o, i) => (o ? o[i] : null), obj);
        }
    }

    // ========================================================================
    // 3. UI 管理 (UI Layer) - 增加打字机平滑效果
    // ========================================================================
    class UIManager {
        constructor() {
            this.container = document.createElement('div');
            this.shadow = this.container.attachShadow({ mode: 'open' });
            this._injectStyle();
            this._createDom();
            document.body.appendChild(this.container);

            // 打字机队列相关
            this.charQueue = [];
            this.isRendering = false;
            this.typingSpeed = 30; // 打字速度 (毫秒/字)，越小越快

            ['mousedown', 'mouseup', 'click'].forEach(
                ev => this.container.addEventListener(ev, e => e.stopPropagation())
            );
        }

        _injectStyle() {
            const s = document.createElement('style');
            s.textContent = `
                :host { font-family: sans-serif; line-height: 1.6; --primary: #4e8cff; }

                /* 按钮样式 */
                .btn-group { position: absolute; display: none; gap: 6px; z-index: ${CONFIG.ui.zIndex}; }
                .btn {
                    width: 30px; height: 30px; border-radius: 20%;
                    background: #fff; color: #555; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: all 0.2s;
                    font-weight: bold; font-size: 14px; user-select: none;
                }
                .btn:hover, .btn.active { transform: translateY(-2px); color: var(--primary); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
                .btn.explain { color: #28a745; }
                .btn.settings { color: #666; font-size: 16px; background: #f8f9fa; }

                /* 下拉菜单样式 */
                .dropdown {
                    position: absolute; bottom: 110%; left: 50%; transform: translateX(-50%);
                    background: white; border-radius: 6px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
                    padding: 4px 0; min-width: 100px; display: none;
                    flex-direction: column; white-space: nowrap;
                }
                .dropdown.show { display: flex; }
                .dropdown-item {
                    padding: 6px 12px; cursor: pointer; font-size: 13px; color: #333;
                    transition: background 0.1s; display: flex; align-items: center;
                    gap: 6px; box-sizing: border-box; white-space: nowrap;
                }
                .dropdown-item:hover { background: #f1f3f4; color: var(--primary); }
                .dropdown-item.active { background: #e8f0fe; color: var(--primary); font-weight: bold; }

                /* 面板样式 */
                .panel {
                    position: absolute; display: none;
                    background: #fff; border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                    padding: 12px 16px; min-width: 200px; max-width: 400px;
                    max-height: 400px; overflow-y: auto; font-size: 14px; color: #333;
                    z-index: ${CONFIG.ui.zIndex}; white-space: pre-wrap;
                }

                /* 增加光标闪烁效果 */
                .cursor {
                    display: inline-block; width: 2px; height: 1em;
                    background: #333; vertical-align: text-bottom;
                    animation: blink 1s infinite;
                }
                @keyframes blink { 50% { opacity: 0; } }

                .loading { color: #999; font-style: italic; display: flex; align-items: center; gap: 6px; }

                /* 加载图标样式 */
                .loading::before {
                    content: ''; width: 12px; height: 12px; border: 2px solid #ccc;
                    border-top-color: var(--primary); border-radius: 50%;
                    animation: spin 1s infinite linear;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
            `;
            this.shadow.appendChild(s);
        }

        _createDom() {
            this.btnGroup = document.createElement('div');
            this.btnGroup.className = 'btn-group';

            const bTrans = document.createElement('div');
            bTrans.className = 'btn translate';
            bTrans.textContent = CONFIG.ui.iconTrans;
            bTrans.onclick = () => this.onAction('translate');

            const bExplain = document.createElement('div');
            bExplain.className = 'btn explain';
            bExplain.textContent = CONFIG.ui.iconExplain;
            bExplain.onclick = () => this.onAction('explain');

            // 设置按钮 (带下拉菜单)
            this.bSettings = document.createElement('div');
            this.bSettings.className = 'btn settings';
            this.bSettings.textContent = CONFIG.ui.iconSettings;
            this.bSettings.onclick = (e) => {
                e.stopPropagation();
                this._toggleDropdown();
            };

            this.dropdown = document.createElement('div');
            this.dropdown.className = 'dropdown';
            this.bSettings.appendChild(this.dropdown);

            this.btnGroup.append(bTrans, bExplain, this.bSettings);

            this.panel = document.createElement('div');
            this.panel.className = 'panel';

            this.shadow.append(this.btnGroup, this.panel);
        }

        initServiceList(services, activeKey, onSelect) {
            this._clearElement(this.dropdown);
            Object.keys(services).forEach(key => {
                const item = document.createElement('div');
                item.className = `dropdown-item ${key === activeKey ? 'active' : ''}`;
                item.textContent = capitalize(key);
                item.onclick = (e) => {
                    e.stopPropagation();
                    this._selectService(key, item, onSelect);
                };
                this.dropdown.appendChild(item);
            });
            this.activeServiceKey = activeKey; // 记录当前状态
        }

        _toggleDropdown() {
            const isShown = this.dropdown.classList.toggle('show');
            if (isShown) {
                this.bSettings.classList.add('active');
            } else {
                this.bSettings.classList.remove('active');
            }
        }

        _selectService(key, itemDom, onSelect) {
            // 更新 UI 选中态
            this.dropdown.querySelectorAll('.dropdown-item').forEach(el => el.classList.remove('active'));
            itemDom.classList.add('active');

            this.activeServiceKey = key;
            this.dropdown.classList.remove('show');
            this.bSettings.classList.remove('active');

            // 回调通知 App 保存
            if (onSelect) onSelect(key);
        }

        _clearElement(element) {
            // innerHTML 存在安全问题，使用 removeChild 代替
            while (element.firstChild) {
                element.removeChild(element.firstChild);
            }
        }

        showBtn(x, y) {
            this.panel.style.display = 'none';
            // 重置状态
            this.dropdown.classList.remove('show');
            if (this.bSettings) this.bSettings.classList.remove('active');

            this.btnGroup.style.display = 'flex';
            this.btnGroup.style.left = `${x + CONFIG.ui.offset.x}px`;
            this.btnGroup.style.top = `${y + CONFIG.ui.offset.y}px`;
        }

        showPanel(activeKey) {
            //this.btnGroup.style.display = 'none';
            this.panel.style.display = 'block';
            this.panel.style.left = this.btnGroup.style.left;
            this.panel.style.top = (parseFloat(this.btnGroup.style.top) + 35) + 'px';

            this._clearElement(this.panel);
            this.panel.appendChild(this._genPlaceHolder(activeKey));

            this.contentDiv = null;
            this.charQueue = [];
            this.isRendering = false;
        }

        _genPlaceHolder(activeKey) {
            const serviceConfig = CONFIG.services[activeKey];
            const serviceTitle = capitalize(activeKey);
            const isAI = serviceConfig && serviceConfig.type === 'ai';

            const placeholder = document.createElement('div');
            placeholder.className = 'loading';
            
            if (isAI) {
                placeholder.textContent = `🧠 ${serviceTitle} 正在思考...`;
            } else {
                placeholder.textContent = `🔄 ${serviceTitle} 正在翻译...`;
            }
            return placeholder;
        }

        updatePanel(text) {
            // 第一次收到数据，清除 Loading，建立文本容器
            if (!this.contentDiv) {
                this._clearElement(this.panel);
                this.contentDiv = document.createElement('span');
                this.cursor = document.createElement('span');
                this.cursor.className = 'cursor';
                this.panel.append(this.contentDiv, this.cursor);
            }

            // 将新文本拆分成字符数组，推入队列
            const chars = text.split('');
            this.charQueue.push(...chars);

            // 如果没有在渲染，就开始渲染循环
            if (!this.isRendering) {
                this._renderLoop();
            }
        }

        // 打字机渲染循环
        _renderLoop() {
            if (this.charQueue.length === 0) {
                this.isRendering = false;
                // 如果队列空了，检查是否还需要保留光标（可选）
                return;
            }

            this.isRendering = true;

            // 取出一个字符
            const char = this.charQueue.shift();
            this.contentDiv.textContent += char;

            // 自动滚动
            this.panel.scrollTop = this.panel.scrollHeight;

            // 动态调整速度：如果堆积了太多字符，就加快速度
            let speed = this.typingSpeed;
            if (this.charQueue.length > 50) speed = 5;
            else if (this.charQueue.length > 20) speed = 15;

            setTimeout(() => this._renderLoop(), speed);
        }

        hide() {
            this.btnGroup.style.display = 'none';
            this.panel.style.display = 'none';
            this.dropdown.classList.remove('show');
            if (this.bSettings) this.bSettings.classList.remove('active');
            this.charQueue = []; // 清空队列防止后台继续打字
            this.isRendering = false;
        }

        bindEvents(onTranslate, onExplain, onServiceChange) {
            this.onAction = (mode) => {
                if (mode === 'translate') onTranslate();
                if (mode === 'explain') onExplain();
            };
            // 初始化时也需要绑定选择回调，这里通过 initServiceList 传递更合适，
            // 或者在这里保存引用。为了简洁，建议在 App 初始化时直接调用 initServiceList
        }
        contains(target) { return target === this.container; }
    }
    // ========================================================================
    // 4. 主程序入口
    // ========================================================================
    class App {
        constructor() {
            this.svc = new TranslationService(CONFIG);
            this.ui = new UIManager();
            this.selection = '';

            this.init();
        }

        init() {
            // 1. 获取当前首选服务
            const currentKey = this.svc.getActiveKey();

            // 2. 初始化 UI 的下拉菜单
            this.ui.initServiceList(
                CONFIG.services,
                currentKey,
                (newKey) => {
                    // 当用户在 UI 选择了新服务
                    this.svc.setActiveKey(newKey);
                    console.log(`Default service switched to: ${newKey}`);
                }
            );

            // 3. 绑定翻译/解释事件
            this.ui.bindEvents(
                () => this.runTask('translate'),
                () => this.runTask('explain')
            );

            // 4. 全局事件
            document.addEventListener('mouseup', (e) => {
                setTimeout(() => {
                    let text = window.getSelection().toString().trim();

                    if (!text && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT')) {
                        const start = e.target.selectionStart;
                        const end = e.target.selectionEnd;
                        if (start !== end) {
                            text = e.target.value.substring(start, end).trim();
                        }
                    }

                    if (text) {
                        this.selection = text;
                        this.ui.showBtn(e.pageX, e.pageY);
                    }
                }, 10);
            });

            document.addEventListener('mousedown', (e) => {
                if (!this.ui.contains(e.target)) this.ui.hide();
            });
        }

        async runTask(mode) {
            // 获取当前动态的 Key
            const currentKey = this.svc.getActiveKey();

            // 【关键】将 Key 传给 showPanel 用于生成 PlaceHolder
            this.ui.showPanel(currentKey);

            try {
                // request 内部也会调用 getActiveKey()，保证逻辑一致
                await this.svc.request(this.selection, mode, (text, done) => {
                    if (text) this.ui.updatePanel(text);
                });
            } catch (err) {
                this.ui.updatePanel(`\n[出错]: ${err.message}`);
            }
        }
    }

    new App();
})();