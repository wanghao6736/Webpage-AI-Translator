// ==UserScript==
// @name         网页划词翻译 (Webpage AI Translator)
// @namespace    http://tampermonkey.net/
// @version      1.1.5
// @description  支持流式输出、解释模式、配置分离的划词翻译脚本。UI 多级坐标回退(兼容GitHub)，精准锚点定位，链式布局。
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
// @connect      api.chatanywhere.tech
// @connect      generativelanguage.googleapis.com
// @connect      api-free.deepl.com
// @connect      api-edge.cognitive.microsofttranslator.com
// @homepage     https://github.com/wanghao6736/Webpage-AI-Translator
// @updateURL    https://raw.githubusercontent.com/wanghao6736/Webpage-AI-Translator/main/src/web-ai-translator.user.js
// @downloadURL  https://raw.githubusercontent.com/wanghao6736/Webpage-AI-Translator/main/src/web-ai-translator.user.js
// ==/UserScript==

(function () {
	"use strict";

	// ========================================================================
	// 1. 配置模块
	// ========================================================================
	const CONFIG = {
		activeService: "gemini", // [切换服务]

		prompts: {
			translate:
				"You are a professional translator. Translate the following text into Simplified Chinese directly without explanation:\n\n{text}",
			explain:
				"You are a computer science expert. Explain the following text in Simplified Chinese clearly. Use Markdown format (bold key points, code blocks for code).\n\n{text}",
		},

		ui: {
			iconTrans: "译",
			iconExplain: "释",
			iconSettings: "⚙️",
			zIndex: 999999,
			offset: 10, // 垂直间距
		},

		services: {
			// --- AI 服务 ---
			deepseek: {
				type: "ai",
				provider: "openai_compatible",
				baseUrl: "https://api.deepseek.com",
				model: "deepseek-chat",
				deltaPath: "choices.0.delta.content",
			},
			openai: {
				type: "ai",
				provider: "openai_compatible",
				baseUrl: "https://api.openai.com/v1",
				model: "gpt-3.5-turbo",
				deltaPath: "choices.0.delta.content",
			},
			chatanywhere: {
				type: "ai",
				provider: "openai_compatible",
				baseUrl: "https://api.chatanywhere.tech/v1",
				model: "gemini-2.5-flash-lite",
				deltaPath: "choices.0.delta.content",
			},
			gemini: {
				type: "ai",
				provider: "gemini",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
				model: "gemini-2.5-flash-lite",
				deltaPath: "candidates.0.content.parts.0.text",
			},
			// --- 免费服务 ---
			google: {
				type: "free",
				url: "https://translate.googleapis.com/translate_a/single",
				params: { client: "gtx", dt: "t", sl: "auto", tl: "zh-CN", q: "{text}" },
				parser: "google_gtx",
			},
			bing: {
				type: "free",
				url: "https://api-edge.cognitive.microsofttranslator.com/translate",
				params: { "api-version": "3.0", to: "zh-Hans", text: "{text}" },
				headers: { Authorization: "Bearer" },
				responsePath: "0.translations.0.text",
			},
		},
	};

	// ========================================================================
	// 1.1 工具函数
	// ========================================================================
	const capitalize = (s) => s && s[0].toUpperCase() + s.slice(1);

	// ========================================================================
	// 2. 核心逻辑层
	// ========================================================================
	class TranslationService {
		constructor(config) {
			this.config = config;
			this.buffer = "";
			this._initMenus();
		}

		_initMenus() {
			Object.keys(this.config.services).forEach((key) => {
				const cfg = this.config.services[key];
				if (cfg.type === "ai") {
					GM_registerMenuCommand(`设置 ${capitalize(key)} API Key`, () => {
						const savedKey = GM_getValue(`key_${key}`, "");
						let maskKey = "未设置";
						if (savedKey)
							maskKey = `${savedKey.substring(0, 3)}**********${savedKey.substring(savedKey.length - 4)}`;
						const newKey = prompt(
							`当前 ${capitalize(
								key
							)} Key: [ ${maskKey} ]\n\n👇 如需修改，请在下方输入新 Key (留空取消):`,
							""
						);
						if (newKey && newKey.trim().length > 0) {
							GM_setValue(`key_${key}`, newKey.trim());
							alert(`✅ ${capitalize(key)} API Key 已更新！`);
						}
					});
				}
			});
		}

		getActiveKey() {
			const savedKey = GM_getValue("preferred_service", null);
			return savedKey && this.config.services[savedKey] ? savedKey : this.config.activeService;
		}

		setActiveKey(key) {
			if (this.config.services[key]) GM_setValue("preferred_service", key);
		}

		async request(text, mode, onUpdate) {
			// 清空 buffer，防止上次请求的数据残留
			this.buffer = "";

			const serviceKey = this.getActiveKey();
			const cfg = this.config.services[serviceKey];
			if (!cfg) throw new Error(`Service [${serviceKey}] not found.`);

			if (cfg.type === "ai") {
				const key = GM_getValue(`key_${serviceKey}`, "");
				if (!key) {
					onUpdate(`⚠️ 请先点击插件图标，设置 [${capitalize(serviceKey)}] API Key`, false);
					return;
				}
				cfg.apiKey = key;
			}

			if (cfg.type === "free") {
				if (mode === "explain") {
					onUpdate(`⚠️ 免费接口 ${capitalize(serviceKey)} 不支持“解释”模式，请切换至 AI 服务。`, false);
					return;
				}
				const result = await this._requestFree(text, cfg);
				onUpdate(result, false);
				return;
			}

			const promptTpl = this.config.prompts[mode] || this.config.prompts.translate;
			const finalPrompt = promptTpl.replace("{text}", text);
			await this._requestAiStream(cfg, finalPrompt, onUpdate);
		}

		_requestFree(text, cfg) {
			return new Promise((resolve, reject) => {
				const params = new URLSearchParams();
				Object.entries(cfg.params).forEach(([k, v]) => params.append(k, v.replace("{text}", text)));

				GM_xmlhttpRequest({
					method: "GET",
					url: `${cfg.url}?${params.toString()}`,
					headers: cfg.headers || {},
					timeout: 15000,
					onload: (res) => {
						if (res.status >= 400) {
							let errMsg = `HTTP ${res.status}`;
							try {
								const errData = JSON.parse(res.responseText);
								// 尝试提取 Bing/Google 的错误信息
								errMsg = errData.message || errData.error?.message || errMsg;
							} catch (e) {}
							reject(new Error(`[${capitalize(cfg.parser || "API")}] ${errMsg}`));
							return;
						}
						try {
							const data = JSON.parse(res.responseText);
							if (cfg.parser === "google_gtx") resolve(data[0].map((i) => i[0]).join(""));
							else resolve(this._getValue(data, cfg.responsePath));
						} catch (e) {
							reject(new Error("响应解析失败，可能是接口变动"));
						}
					},
					onerror: () => reject(new Error("网络请求失败 (Network Error)")),
					ontimeout: () => reject(new Error("请求超时 (Timeout)")),
				});
			});
		}

		_requestAiStream(cfg, prompt, onUpdate) {
			return new Promise((resolve, reject) => {
				const { url, headers, body } = this._buildRequestParams(cfg, prompt);
				GM_xmlhttpRequest({
					method: "POST",
					url: url,
					headers: headers,
					data: JSON.stringify(body),
					responseType: "stream",
					fetch: true,
					timeout: 15000, // AI 响应较慢，给 15 秒

					onloadstart: async (res) => {
						// 【修改点 1】: 放宽状态码检查
						// 如果 status 是 200，肯定没问题。
						// 如果 status >= 400，肯定是错的。
						// 如果 status === 0，可能是错的（网络挂了），也可能是 429（TM bug）。
						// 所以，只要不是 200，我们都保持警惕，但不要立即 kill 掉，先读流。

						const reader = res.response.getReader();
						const decoder = new TextDecoder();

						// 【修改点 2】: 预读一段数据来判断生死
						let firstChunk = "";
						try {
							const { done, value } = await reader.read();
							if (value) {
								firstChunk = decoder.decode(value, { stream: true });
							}

							let isErrorJson = false;
							let errorMsg = "";
							try {
								const json = JSON.parse(firstChunk);
								// 如果解析成功，且包含 error 字段，说明是 API 报错（即便是 status 0）
								if (json.error || json.message) {
									isErrorJson = true;
									errorMsg = json.error?.message || json.message;
								}
							} catch (e) {
								// 解析 JSON 失败，说明不是普通 JSON，可能是正常的 SSE 数据流 ("data: ...")
								// 或者数据不完整。暂且认为是正常的。
							}

							if (res.status >= 400 || isErrorJson) {
								this.buffer = ""; // 请求失败，清空 buffer
								const finalStatus = res.status === 0 ? 429 : res.status;
								let friendlyMsg = errorMsg || `HTTP ${finalStatus}`;

								if (friendlyMsg.includes("Quota") || friendlyMsg.includes("limit"))
									friendlyMsg = "额度已用完 (Quota Exceeded)";
								if (friendlyMsg.includes("key")) friendlyMsg = "API Key 无效";
								reject(new Error(`[API Error] ${friendlyMsg}`));
								return;
							}

							// 如果状态码是 0 但内容不是 JSON 报错（比如内容是 "data: {"...），
							// 那可能是 TM 的 status 没传过来，但流是正常的。
							// 继续处理 buffer
							this.buffer += firstChunk;
							this._parseBuffer(cfg, onUpdate);
							while (true) {
								const { done, value } = await reader.read();
								if (done) break;
								this.buffer += decoder.decode(value, { stream: true });
								this._parseBuffer(cfg, onUpdate);
							}
							this.buffer = ""; // 请求成功完成，清空 buffer
							resolve();
						} catch (err) {
							// 只有读流本身报错（比如网络彻底断了读不到数据），才报 Network Error
							this.buffer = ""; // 请求失败，清空 buffer
							reject(new Error("网络连接中断或无法读取响应"));
						}
					},
					onerror: () => {
						this.buffer = ""; // 请求失败，清空 buffer
						reject(new Error("网络请求失败 (Network Error)"));
					},
					ontimeout: () => {
						this.buffer = ""; // 请求超时，清空 buffer
						reject(new Error("请求超时，请检查网络 (Timeout)"));
					},
				});
			});
		}

		_buildRequestParams(cfg, prompt) {
			if (cfg.provider === "openai_compatible") {
				return {
					url: `${cfg.baseUrl}/chat/completions`,
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${cfg.apiKey}`,
						Accept: "text/event-stream",
					},
					body: { model: cfg.model, messages: [{ role: "user", content: prompt }], stream: true },
				};
			}
			if (cfg.provider === "gemini") {
				return {
					url: `${cfg.baseUrl}/${cfg.model}:streamGenerateContent?alt=sse`,
					headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
					body: { contents: [{ parts: [{ text: prompt }] }] },
				};
			}
			throw new Error(`Unknown provider: ${cfg.provider}`);
		}

		_parseBuffer(cfg, onUpdate) {
			const lines = this.buffer.split("\n");
			this.buffer = lines.pop() || "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed === "data: [DONE]") continue;
				if (trimmed.startsWith("data: ")) {
					try {
						const data = JSON.parse(trimmed.substring(6));
						const content = this._getValue(data, cfg.deltaPath);
						if (content) onUpdate(content, true);
					} catch (e) {
						// 解析 SSE 数据失败，可能是数据格式异常，记录日志便于调试
						console.warn(
							"[Web AI Translator] Failed to parse SSE data:",
							e.message,
							trimmed.substring(0, 100)
						);
					}
				}
			}
		}

		_getValue(obj, path) {
			if (!path) return null;
			return path.split(".").reduce((o, i) => (o ? o[i] : null), obj);
		}
	}

	// ========================================================================
	// 3. UI 管理 (UI Layer)
	// ========================================================================
	class UIManager {
		constructor() {
			this.container = document.createElement("div");
			this.shadow = this.container.attachShadow({ mode: "open" });
			this._injectStyle();
			this._createDom();
			document.body.appendChild(this.container);

			["mousedown", "mouseup", "click"].forEach((ev) =>
				this.container.addEventListener(ev, (e) => e.stopPropagation())
			);

			this.targetText = "";
			this.currentText = "";
			this.isRendering = false;
		}

		_injectStyle() {
			const s = document.createElement("style");
			s.textContent = `
                :host { font-family: sans-serif; line-height: 1.6; --primary: #4e8cff; --translate: #4e8cff; --explain: #28a745; --error: #d93025; }

                .btn-group {
                    position: absolute; display: none; gap: 8px;
                    z-index: ${CONFIG.ui.zIndex + 1};
                    background: #fff; padding: 4px; border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.15);
                    border: 1px solid #e0e0e0;
                }

                .btn {
                    width: 28px; height: 28px; border-radius: 20%;
                    background: #f8f9fa; color: #555; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15); transition: all 0.2s;
                    font-weight: bold; font-size: 14px; user-select: none;
                }
                .btn:hover, .btn.active { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
                .btn.translate { color: var(--translate); }
                .btn.explain { color: var(--explain); }
                .btn.settings { color: #666; font-size: 16px; background: #f8f9fa; }

                .dropdown {
                    position: absolute; background: white; border-radius: 6px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
                    padding: 4px 0; min-width: 120px; display: none;
                    flex-direction: column; white-space: nowrap; z-index: ${CONFIG.ui.zIndex + 2};
                    border: 1px solid #eee;
                }
                .dropdown.show { display: flex; }
                .dropdown-item {
                    padding: 8px 12px; cursor: pointer; font-size: 13px; color: #333;
                    transition: background 0.1s; display: flex; align-items: center; gap: 6px;
                }
                .dropdown-item:hover { background: #f1f3f4; color: var(--primary); }
                .dropdown-item.active { background: #e8f0fe; color: var(--primary); font-weight: bold; }

                .panel {
                    position: absolute; display: none;
                    background: #fff; border-radius: 8px;
                    box-shadow: 0 6px 24px rgba(0,0,0,0.12);
                    padding: 16px; width: 400px; max-width: 90vw;
                    max-height: 400px; overflow-y: auto; font-size: 14px; color: #333;
                    z-index: ${CONFIG.ui.zIndex};
                    border: 1px solid #eee;
                    margin-top: 6px;
                }

                .md-content { text-align: left; line-height: 1.6; font-size: 14px; }
                .md-content p { margin: 0 0 10px 0; }
                .md-content strong { color: var(--primary); font-weight: 700; }
                .md-content code { background: #f0f0f0; padding: 2px 4px; border-radius: 4px; font-family: monospace; color: #d63384; font-size: 0.9em; }
                .md-content pre { background: #f6f8fa; padding: 10px; border-radius: 6px; overflow-x: auto; margin: 10px 0; border: 1px solid #eee; }
                .md-content pre code { background: none; color: #333; padding: 0; display: block; }
                .md-content ul, .md-content ol { margin: 0 0 10px 0; padding-left: 20px; }
                .md-content li { margin-bottom: 4px; }
                .md-content h1, .md-content h2, .md-content h3 { margin: 12px 0 8px 0; font-size: 1.1em; font-weight: bold; color: #333; }
                .loading { color: #999; font-style: italic; display: flex; align-items: center; gap: 6px; }
                .loading::before { content: ''; width: 14px; height: 14px; border: 2px solid #eee; border-top-color: var(--primary); border-radius: 50%; animation: spin 0.8s infinite linear; }
                @keyframes spin { to { transform: rotate(360deg); } }
            `;
			this.shadow.appendChild(s);
		}

		_createDom() {
			this.btnGroup = document.createElement("div");
			this.btnGroup.className = "btn-group";

			const createBtn = (cls, txt, onClick) => {
				const btn = document.createElement("div");
				btn.className = `btn ${cls}`;
				btn.textContent = txt;
				btn.onmousedown = (e) => e.preventDefault();
				btn.onclick = onClick;
				return btn;
			};

			const bTrans = createBtn("translate", CONFIG.ui.iconTrans, () => this.onAction("translate"));
			const bExplain = createBtn("explain", CONFIG.ui.iconExplain, () => this.onAction("explain"));
			this.bSettings = createBtn("settings", CONFIG.ui.iconSettings, (e) => {
				e.stopPropagation();
				this._toggleDropdown();
			});

			this.dropdown = document.createElement("div");
			this.dropdown.className = "dropdown";

			this.btnGroup.append(bTrans, bExplain, this.bSettings);
			this.panel = document.createElement("div");
			this.panel.className = "panel";

			this.shadow.append(this.btnGroup, this.panel, this.dropdown);
		}

		initServiceList(services, activeKey, onSelect) {
			this._clearElement(this.dropdown);
			Object.keys(services).forEach((key) => {
				const item = document.createElement("div");
				item.className = `dropdown-item ${key === activeKey ? "active" : ""}`;
				item.textContent = capitalize(key);
				item.onmousedown = (e) => e.preventDefault();
				item.onclick = (e) => {
					e.stopPropagation();
					this._selectService(key, item, onSelect);
				};
				this.dropdown.appendChild(item);
			});
			this.activeServiceKey = activeKey;
		}

		_toggleDropdown() {
			if (this.dropdown.classList.contains("show")) this._closeDropdown();
			else this._openDropdown();
		}

		_openDropdown() {
			const itemCount = this.dropdown.childElementCount;
			const menuHeight = itemCount * 38 + 10;
			const menuWidth = 120;
			const btnRect = this.bSettings.getBoundingClientRect();
			// 下拉菜单锚点：设置按钮
			const pos = this._computePosition(btnRect, { w: menuWidth, h: menuHeight }, "priority-bottom");

			this.dropdown.style.left = `${pos.left}px`;
			this.dropdown.style.top = `${pos.top}px`;
			this.dropdown.classList.add("show");
			this.bSettings.classList.add("active");
		}

		_closeDropdown() {
			this.dropdown.classList.remove("show");
			this.bSettings.classList.remove("active");
		}

		_selectService(key, itemDom, onSelect) {
			this.dropdown.querySelectorAll(".dropdown-item").forEach((el) => el.classList.remove("active"));
			itemDom.classList.add("active");
			this.activeServiceKey = key;
			this._closeDropdown();
			if (onSelect) onSelect(key);
		}

		_clearElement(el) {
			while (el.firstChild) el.removeChild(el.firstChild);
		}

		/**
		 * 终极位置计算器
		 * @param {Object} anchor 锚点信息 {left, top, bottom, height} (Viewport坐标)
		 * @param {Object} size 自身尺寸 {w, h}
		 * @param {string} strategy 'forced-bottom' | 'priority-bottom'
		 */
		_computePosition(anchor, size, strategy) {
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			const scrollX = window.scrollX;
			const scrollY = window.scrollY;
			const gap = CONFIG.ui.offset;

			let top, left;

			// X 轴：默认左对齐锚点
			left = anchor.left;
			// 碰撞检测：右溢出则向左平移
			if (left + size.w > vw) {
				left = Math.max(10, vw - size.w - 10);
			}

			// Y 轴
			if (strategy === "forced-bottom") {
				top = anchor.bottom + gap;
			} else {
				// 优先在下方
				if (anchor.bottom + size.h + gap > vh && anchor.top > size.h + gap) {
					top = anchor.top - size.h - gap; // 放上方
				} else {
					top = anchor.bottom + gap; // 放下方
				}
			}

			return {
				left: left + scrollX,
				top: top + scrollY,
			};
		}

		/**
		 * 显示按钮组
		 * @param {Object} anchorRect 虚拟的锚点矩形 {left, top, bottom...}
		 */
		showBtn(anchorRect) {
			this.panel.style.display = "none";
			this._closeDropdown();
			this.btnGroup.style.display = "flex";

			const btnW = 120;
			const btnH = 40;
			// 按钮组锚点：文本选区/鼠标虚拟矩形
			const pos = this._computePosition(anchorRect, { w: btnW, h: btnH }, "priority-bottom");

			this.btnGroup.style.left = `${pos.left}px`;
			this.btnGroup.style.top = `${pos.top}px`;
		}

		/**
		 * 显示面板
		 */
		showPanel(activeKey) {
			this._closeDropdown();
			this._clearElement(this.panel);
			this.panel.appendChild(this._genPlaceHolder(activeKey));

			const btnRect = this.btnGroup.getBoundingClientRect();
			const panelW = 400;
			const panelH = 200;

			// 面板锚点：按钮组 (强制在下方，构成稳定的视觉链)
			const pos = this._computePosition(btnRect, { w: panelW, h: panelH }, "forced-bottom");

			this.panel.style.left = `${pos.left}px`;
			this.panel.style.top = `${pos.top}px`;
			this.panel.style.display = "block";

			this.targetText = "";
			this.currentText = "";
			this.contentDiv = null;
			this.isRendering = false;
		}

		_genPlaceHolder(activeKey) {
			const serviceConfig = CONFIG.services[activeKey];
			const isAI = serviceConfig && serviceConfig.type === "ai";
			const div = document.createElement("div");
			div.className = "loading";
			div.textContent = isAI
				? `🧠 ${capitalize(activeKey)} 正在思考...`
				: `🔄 ${capitalize(activeKey)} 翻译中...`;
			return div;
		}

		updatePanel(text, isIncremental) {
			if (!this.contentDiv) {
				this._clearElement(this.panel);
				this.contentDiv = document.createElement("div");
				this.contentDiv.className = "md-content";
				this.panel.appendChild(this.contentDiv);
			}
			if (isIncremental) this.targetText += text;
			else this.targetText = text;

			if (!this.isRendering) this._renderLoop();
		}

		_renderLoop() {
			if (this.panel.style.display === "none") {
				this.isRendering = false;
				return;
			}
			const dist = this.targetText.length - this.currentText.length;
			if (dist > 0) {
				this.isRendering = true;
				const speed = Math.max(1, Math.min(100, Math.ceil(dist / 8)));
				this.currentText += this.targetText.substring(this.currentText.length, this.currentText.length + speed);
				this._renderSafeMarkdown(this.contentDiv, this.currentText);
				this.panel.scrollTop = this.panel.scrollHeight;
				requestAnimationFrame(() => this._renderLoop());
			} else {
				this.isRendering = false;
			}
		}

		_renderSafeMarkdown(container, text) {
			this._clearElement(container);
			const lines = text.split("\n");
			let inCodeBlock = false;
			let currentBlock = null;
			let currentList = null;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const trimLine = line.trim();
				if (trimLine.startsWith("```")) {
					if (inCodeBlock) {
						inCodeBlock = false;
						currentBlock = null;
					} else {
						inCodeBlock = true;
						currentBlock = document.createElement("pre");
						currentBlock.appendChild(document.createElement("code"));
						container.appendChild(currentBlock);
					}
					continue;
				}
				if (inCodeBlock) {
					if (!currentBlock) {
						currentBlock = document.createElement("pre");
						currentBlock.appendChild(document.createElement("code"));
						container.appendChild(currentBlock);
					}
					currentBlock.firstChild.appendChild(document.createTextNode(line + "\n"));
					continue;
				}
				if (line.startsWith("#")) {
					const match = line.match(/^(#{1,6})\s/);
					if (match) {
						const h = document.createElement("h3");
						this._processInline(h, line.substring(match[0].length));
						container.appendChild(h);
						currentList = null;
						continue;
					}
				}
				if (line.match(/^[-*]\s/)) {
					if (!currentList) {
						currentList = document.createElement("ul");
						container.appendChild(currentList);
					}
					const li = document.createElement("li");
					this._processInline(li, line.replace(/^[-*]\s/, ""));
					currentList.appendChild(li);
					continue;
				}
				currentList = null;
				if (trimLine.length > 0) {
					const p = document.createElement("p");
					this._processInline(p, line);
					container.appendChild(p);
				}
			}
		}

		_processInline(container, text) {
			let cursor = 0;
			while (cursor < text.length) {
				const nextCode = text.indexOf("`", cursor);
				const nextBold = text.indexOf("**", cursor);
				let mode = "text";
				let start = -1;
				if (nextCode !== -1 && (nextBold === -1 || nextCode < nextBold)) {
					mode = "code";
					start = nextCode;
				} else if (nextBold !== -1) {
					mode = "bold";
					start = nextBold;
				}

				if (start === -1) {
					container.appendChild(document.createTextNode(text.slice(cursor)));
					break;
				}
				if (start > cursor) container.appendChild(document.createTextNode(text.slice(cursor, start)));

				if (mode === "code") {
					const end = text.indexOf("`", start + 1);
					if (end === -1) {
						container.appendChild(document.createTextNode(text.slice(start)));
						break;
					}
					const codeEl = document.createElement("code");
					codeEl.textContent = text.slice(start + 1, end);
					container.appendChild(codeEl);
					cursor = end + 1;
				} else if (mode === "bold") {
					const end = text.indexOf("**", start + 2);
					if (end === -1) {
						container.appendChild(document.createTextNode(text.slice(start)));
						break;
					}
					const strongEl = document.createElement("strong");
					this._processInline(strongEl, text.slice(start + 2, end));
					container.appendChild(strongEl);
					cursor = end + 2;
				}
			}
		}

		hide() {
			this.btnGroup.style.display = "none";
			this.panel.style.display = "none";
			this._closeDropdown();
			this.isRendering = false;
		}

		bindEvents(onTranslate, onExplain) {
			this.onAction = (mode) => {
				this._closeDropdown();
				if (mode === "translate") onTranslate();
				if (mode === "explain") onExplain();
			};
		}
		contains(target) {
			return target === this.container;
		}
	}

	// ========================================================================
	// 4. 主程序入口
	// ========================================================================
	class App {
		constructor() {
			this.svc = new TranslationService(CONFIG);
			this.ui = new UIManager();
			this.selection = "";

			// 状态追踪
			this.startMouse = { x: 0, y: 0 };
			this.endMouse = { x: 0, y: 0 };
			this.lastRange = null;

			this.init();
		}

		init() {
			const currentKey = this.svc.getActiveKey();
			this.ui.initServiceList(CONFIG.services, currentKey, (newKey) => {
				this.svc.setActiveKey(newKey);
			});

			this.ui.bindEvents(
				() => this.runTask("translate"),
				() => this.runTask("explain")
			);

			// 1. 记录开始坐标
			document.addEventListener("mousedown", (e) => {
				// 如果点在插件UI上，不重置
				if (this.ui.contains(e.target)) return;
				this.ui.hide();
				this.startMouse = { x: e.clientX, y: e.clientY };
			});

			// 2. 记录结束坐标并处理选区
			document.addEventListener("mouseup", (e) => {
				this.endMouse = { x: e.clientX, y: e.clientY };

				setTimeout(() => {
					if (this.ui.contains(e.target)) return;

					const selection = window.getSelection();
					let text = selection.toString().trim();
					let anchorRect = null;

					// A. 输入框特殊处理
					if (!text && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) {
						const start = e.target.selectionStart;
						const end = e.target.selectionEnd;
						if (start !== end) text = e.target.value.substring(start, end).trim();
						// 输入框回退到鼠标虚拟矩形
						anchorRect = this._getMouseAnchor();
					}
					// B. 普通文本选区处理
					else if (text && selection.rangeCount > 0) {
						const range = selection.getRangeAt(0);
						anchorRect = this._getSmartAnchor(range);
					}

					if (text && anchorRect) {
						this.selection = text;
						this.ui.showBtn(anchorRect);
					}
				}, 10);
			});
		}

		/**
		 * 智能获取锚点 (多级回退策略)
		 * 目标：返回一个虚拟矩形，其 left=mouseupX, bottom=selectionBottom
		 */
		_getSmartAnchor(range) {
			let rect = null;

			// 策略 1: getBoundingClientRect (最准，但可能为0)
			const r1 = range.getBoundingClientRect();
			if (r1.width > 0 && r1.height > 0) {
				rect = r1;
			}
			// 策略 2: getClientRects (处理多行/GitHub代码表格)
			else {
				const rects = range.getClientRects();
				if (rects.length > 0) {
					// 通常最后一个矩形是选区结束的地方
					rect = rects[rects.length - 1];
				}
			}

			// 策略 3: 鼠标回退 (绝对兜底)
			if (!rect) {
				return this._getMouseAnchor();
			}

			// 构造混合锚点：
			// X轴：跟随鼠标结束位置 (符合用户视觉焦点)
			// Y轴：跟随选区底部 (防止遮挡文字)
			return {
				left: this.endMouse.x,
				right: this.endMouse.x,
				top: rect.bottom, // 逻辑 Top 设为 Bottom，确保后续计算在下方
				bottom: rect.bottom,
				width: 0,
				height: 0,
			};
		}

		_getMouseAnchor() {
			// 构造一个基于鼠标轨迹的虚拟矩形
			const bottom = Math.max(this.startMouse.y, this.endMouse.y);
			const right = this.endMouse.x;
			return {
				left: right,
				right: right,
				top: bottom,
				bottom: bottom,
				width: 0,
				height: 0,
			};
		}

		async runTask(mode) {
			const currentKey = this.svc.getActiveKey();
			this.ui.showPanel(currentKey);
			try {
				await this.svc.request(this.selection, mode, (text, isIncremental) => {
					if (text) this.ui.updatePanel(text, isIncremental);
				});
			} catch (err) {
				const msg = `\n**❌ 出错啦**\n\n${err.message}`;
				this.ui.updatePanel(msg, false);
			}
		}
	}

	new App();
})();
