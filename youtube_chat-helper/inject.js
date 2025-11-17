// YouTube Chat Helper - Refactored Version
// グローバル変数
const STORAGE_KEY = "chatData";
const GLOBAL_CHANNEL_KEY = "__global__";

// ユーティリティ関数
const Utils = {
    // DOM要素の安全な取得
    safeQuerySelector(element, selector) {
        try {
            return element?.querySelector(selector) || null;
        } catch (e) {
            console.warn(`セレクタエラー: ${selector}`, e);
            return null;
        }
    },

    // 現在のチャンネル情報を取得
    getChannelInfo() {
        const channelElement = this.safeQuerySelector(
            document,
            "ytd-channel-name#channel-name yt-formatted-string#text a"
        );
        if (!channelElement) return null;
        return {
            name: channelElement.innerText.trim(),
            href: channelElement.href
        };
    },

    // デバウンス関数
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// ストレージ管理
const Storage = {
    getData() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { channels: [], global: [] };
        } catch (e) {
            console.error("ストレージデータの読み込みエラー:", e);
            return { channels: [], global: [] };
        }
    },

    saveData(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error("ストレージデータの保存エラー:", e);
            return false;
        }
    },

    // テンプレートの保存（チャンネル別またはグローバル）
    saveTemplate(newContent, isGlobal = false) {
        const data = this.getData();
        const template = {
            timestamp: new Date().toISOString(),
            content: newContent,
            caption: this.generateCaption(newContent)
        };

        if (isGlobal) {
            if (!data.global) data.global = [];
            data.global.push(template);
        } else {
            const channelInfo = Utils.getChannelInfo();
            if (!channelInfo) {
                console.warn("チャンネル情報が取得できません。");
                return false;
            }

            let channelIndex = data.channels.findIndex(ch => ch.name === channelInfo.name);
            if (channelIndex === -1) {
                data.channels.push({
                    name: channelInfo.name,
                    href: channelInfo.href,
                    data: [template]
                });
            } else {
                data.channels[channelIndex].data.push(template);
            }
        }

        return this.saveData(data);
    },

    // テンプレートの削除
    deleteTemplate(channelName, index) {
        const data = this.getData();

        if (channelName === GLOBAL_CHANNEL_KEY) {
            if (data.global && data.global[index]) {
                data.global.splice(index, 1);
            }
        } else {
            const channel = data.channels.find(ch => ch.name === channelName);
            if (!channel) return false;
            channel.data.splice(index, 1);
            if (channel.data.length === 0) {
                data.channels = data.channels.filter(ch => ch.name !== channelName);
            }
        }

        return this.saveData(data);
    },

    // テンプレートの並び替え
    reorderTemplate(channelName, oldIndex, newIndex) {
        const data = this.getData();
        let templates;

        if (channelName === GLOBAL_CHANNEL_KEY) {
            templates = data.global || [];
        } else {
            const channel = data.channels.find(ch => ch.name === channelName);
            if (!channel) return false;
            templates = channel.data;
        }

        if (oldIndex < 0 || oldIndex >= templates.length || newIndex < 0 || newIndex >= templates.length) {
            return false;
        }

        const [removed] = templates.splice(oldIndex, 1);
        templates.splice(newIndex, 0, removed);

        return this.saveData(data);
    },

    // キャプション生成
    generateCaption(content) {
        return content.map(item => {
            if (typeof item === "string") return item;
            if (typeof item === "object" && item.alt) return `[${item.alt}]`;
            return "";
        }).join("").slice(0, 50);
    },

    // 現在のチャンネルのテンプレート取得（グローバル含む）
    getTemplatesForChannel(channelName) {
        const data = this.getData();
        const result = { channel: [], global: [] };

        // グローバルテンプレート
        if (data.global) {
            result.global = data.global.map((t, i) => ({ ...t, index: i, isGlobal: true }));
        }

        // チャンネル別テンプレート
        if (channelName) {
            const channel = data.channels.find(ch => ch.name === channelName);
            if (channel) {
                result.channel = channel.data.map((t, i) => ({ ...t, index: i, isGlobal: false }));
            }
        }

        return result;
    }
};

// UI管理
const UI = {
    currentIframe: null,
    managementModal: null,

    // チャット入力を読み取り
    readChatInput(iframe) {
        const inputElement = Utils.safeQuerySelector(
            iframe.contentDocument,
            "yt-live-chat-text-input-field-renderer#input #input"
        );
        if (!inputElement) {
            console.warn("入力欄が見つかりません。");
            return null;
        }

        const inputData = [];
        inputElement.childNodes.forEach(node => {
            if (node.nodeType === 3) {
                const text = node.textContent.trim();
                if (text) inputData.push(text);
            } else if (node.nodeType === 1 && node.alt) {
                inputData.push({ alt: node.alt, src: node.src });
            }
        });

        return inputData;
    },

    // テンプレートの挿入
    insertTemplate(data, iframe) {
        const inputPanel = Utils.safeQuerySelector(iframe.contentDocument, "#input-panel");
        if (!inputPanel) return;

        const categories = Utils.safeQuerySelector(inputPanel, "tp-yt-iron-pages #categories");
        const inputField = Utils.safeQuerySelector(inputPanel, "yt-live-chat-text-input-field-renderer#input");

        if (!inputField) {
            console.warn("入力欄が見つかりません。");
            return;
        }

        data.forEach(item => {
            if (typeof item === "string") {
                inputField.insertText(item);
            } else if (typeof item === "object" && item.alt && categories) {
                const button = Utils.safeQuerySelector(categories, `[alt="${item.alt}"]`);
                if (button) button.click();
            }
        });
    },

    // ボタンの作成
    createButton(id, caption, handler, className = "") {
        const button = document.createElement("button");
        button.id = id;
        if (className) button.className = className;

        if (typeof caption === "string") {
            button.textContent = caption;
        } else if (Array.isArray(caption)) {
            caption.forEach(item => {
                if (typeof item === "string") {
                    button.appendChild(document.createTextNode(item));
                } else if (typeof item === "object" && item.src) {
                    const img = document.createElement("img");
                    img.src = item.src;
                    img.alt = item.alt || "";
                    button.appendChild(img);
                }
            });
        }

        button.addEventListener("click", handler);
        return button;
    },

    // メインUIのセットアップ
    setupChatButtons(iframe) {
        this.currentIframe = iframe;
        const chatContainer = Utils.safeQuerySelector(
            iframe.contentDocument,
            "#chat-messages #input-panel #container"
        );
        if (!chatContainer) return;

        // 既存のボタンを削除
        const existingWrapper = Utils.safeQuerySelector(iframe.contentDocument, "#chat-helper-buttons");
        if (existingWrapper) existingWrapper.remove();

        // ラッパー作成
        const buttonWrapper = document.createElement("div");
        buttonWrapper.id = "chat-helper-buttons";

        const channelInfo = Utils.getChannelInfo();
        const templates = Storage.getTemplatesForChannel(channelInfo?.name);

        // グローバルテンプレートボタン
        templates.global.forEach((entry, idx) => {
            const btn = this.createTemplateButton(entry, idx, GLOBAL_CHANNEL_KEY, iframe, true);
            buttonWrapper.appendChild(btn);
        });

        // チャンネル別テンプレートボタン
        templates.channel.forEach((entry, idx) => {
            const btn = this.createTemplateButton(entry, idx, channelInfo.name, iframe, false);
            buttonWrapper.appendChild(btn);
        });

        // 保存ボタン（チャンネル用）
        const saveButton = this.createButton("save-channel-btn", "💾 Save", () => {
            const data = this.readChatInput(iframe);
            if (data && data.length > 0) {
                Storage.saveTemplate(data, false);
                this.setupChatButtons(iframe);
            }
        }, "save-btn");
        buttonWrapper.appendChild(saveButton);

        // グローバル保存ボタン
        const saveGlobalButton = this.createButton("save-global-btn", "🌐 Global", () => {
            const data = this.readChatInput(iframe);
            if (data && data.length > 0) {
                Storage.saveTemplate(data, true);
                this.setupChatButtons(iframe);
            }
        }, "save-btn global-btn");
        buttonWrapper.appendChild(saveGlobalButton);

        // 管理ボタン
        const manageButton = this.createButton("manage-templates-btn", "⚙️", () => {
            this.showManagementUI();
        }, "manage-btn");
        buttonWrapper.appendChild(manageButton);

        chatContainer.appendChild(buttonWrapper);
    },

    // テンプレートボタンの作成
    createTemplateButton(entry, index, channelName, iframe, isGlobal) {
        const btn = this.createButton(
            `template-btn-${isGlobal ? "g" : "c"}-${index}`,
            entry.content,
            () => this.insertTemplate(entry.content, iframe),
            isGlobal ? "template-btn global" : "template-btn"
        );

        // 右クリックで削除
        btn.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            this.showContextMenu(event, channelName, index, iframe);
        });

        return btn;
    },

    // コンテキストメニュー表示
    showContextMenu(event, channelName, index, iframe) {
        const existingMenu = document.querySelector("#chat-helper-context-menu");
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement("div");
        menu.id = "chat-helper-context-menu";
        menu.innerHTML = `
            <div class="menu-item delete-item">🗑️ 削除</div>
            <div class="menu-item move-up-item">⬆️ 上に移動</div>
            <div class="menu-item move-down-item">⬇️ 下に移動</div>
        `;

        const rect = iframe.getBoundingClientRect();
        menu.style.left = `${event.clientX + rect.left + window.scrollX}px`;
        menu.style.top = `${event.clientY + rect.top + window.scrollY}px`;

        document.body.appendChild(menu);

        // 削除
        menu.querySelector(".delete-item").addEventListener("click", () => {
            Storage.deleteTemplate(channelName, index);
            this.setupChatButtons(iframe);
            menu.remove();
        });

        // 上に移動
        menu.querySelector(".move-up-item").addEventListener("click", () => {
            if (index > 0) {
                Storage.reorderTemplate(channelName, index, index - 1);
                this.setupChatButtons(iframe);
            }
            menu.remove();
        });

        // 下に移動
        menu.querySelector(".move-down-item").addEventListener("click", () => {
            Storage.reorderTemplate(channelName, index, index + 1);
            this.setupChatButtons(iframe);
            menu.remove();
        });

        // メニュー外クリックで閉じる
        const closeMenu = () => {
            if (document.body.contains(menu)) menu.remove();
        };
        setTimeout(() => {
            document.addEventListener("click", closeMenu, { once: true });
            iframe.contentDocument.addEventListener("click", closeMenu, { once: true });
        }, 10);
    },

    // 管理UI表示
    showManagementUI() {
        if (this.managementModal) this.managementModal.remove();

        const modal = document.createElement("div");
        modal.id = "chat-helper-management-modal";
        this.managementModal = modal;

        const data = Storage.getData();
        const channelInfo = Utils.getChannelInfo();

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>テンプレート管理</h2>
                    <button class="close-btn">✕</button>
                </div>
                <div class="modal-body">
                    <div class="tabs">
                        <button class="tab active" data-tab="current">現在のチャンネル</button>
                        <button class="tab" data-tab="global">グローバル</button>
                        <button class="tab" data-tab="all">全チャンネル</button>
                    </div>
                    <div class="tab-content" id="tab-current"></div>
                    <div class="tab-content hidden" id="tab-global"></div>
                    <div class="tab-content hidden" id="tab-all"></div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // タブ切り替え
        modal.querySelectorAll(".tab").forEach(tab => {
            tab.addEventListener("click", () => {
                modal.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
                modal.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
                tab.classList.add("active");
                modal.querySelector(`#tab-${tab.dataset.tab}`).classList.remove("hidden");
            });
        });

        // 現在のチャンネルタブ
        const currentTab = modal.querySelector("#tab-current");
        if (channelInfo) {
            const channel = data.channels.find(ch => ch.name === channelInfo.name);
            if (channel && channel.data.length > 0) {
                currentTab.innerHTML = this.renderTemplateList(channel.name, channel.data, false);
            } else {
                currentTab.innerHTML = "<p>このチャンネルにはテンプレートがありません。</p>";
            }
        } else {
            currentTab.innerHTML = "<p>チャンネル情報を取得できません。</p>";
        }

        // グローバルタブ
        const globalTab = modal.querySelector("#tab-global");
        if (data.global && data.global.length > 0) {
            globalTab.innerHTML = this.renderTemplateList(GLOBAL_CHANNEL_KEY, data.global, true);
        } else {
            globalTab.innerHTML = "<p>グローバルテンプレートはありません。</p>";
        }

        // 全チャンネルタブ
        const allTab = modal.querySelector("#tab-all");
        if (data.channels.length > 0) {
            let html = "";
            data.channels.forEach(channel => {
                html += `<div class="channel-section">
                    <h3>${channel.name}</h3>
                    ${this.renderTemplateList(channel.name, channel.data, false)}
                </div>`;
            });
            allTab.innerHTML = html;
        } else {
            allTab.innerHTML = "<p>保存されたテンプレートはありません。</p>";
        }

        // 閉じるボタン
        modal.querySelector(".close-btn").addEventListener("click", () => {
            modal.remove();
            this.managementModal = null;
        });

        // ドラッグ＆ドロップの設定
        this.setupDragAndDrop(modal);

        // 削除ボタンのイベント
        this.setupDeleteButtons(modal);
    },

    // テンプレートリストのレンダリング
    renderTemplateList(channelName, templates, isGlobal) {
        return `<ul class="template-list" data-channel="${channelName}">
            ${templates.map((t, i) => `
                <li class="template-item" draggable="true" data-index="${i}">
                    <span class="drag-handle">☰</span>
                    <span class="template-caption">${this.escapeHtml(t.caption || Storage.generateCaption(t.content))}</span>
                    <span class="template-time">${new Date(t.timestamp).toLocaleString()}</span>
                    <button class="delete-template-btn" data-channel="${channelName}" data-index="${i}">🗑️</button>
                </li>
            `).join("")}
        </ul>`;
    },

    // HTMLエスケープ
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    },

    // ドラッグ＆ドロップ設定
    setupDragAndDrop(modal) {
        let draggedItem = null;
        let draggedChannel = null;
        let draggedIndex = null;

        modal.querySelectorAll(".template-item").forEach(item => {
            item.addEventListener("dragstart", (e) => {
                draggedItem = item;
                draggedChannel = item.closest(".template-list").dataset.channel;
                draggedIndex = parseInt(item.dataset.index);
                item.classList.add("dragging");
            });

            item.addEventListener("dragend", () => {
                item.classList.remove("dragging");
                draggedItem = null;
            });

            item.addEventListener("dragover", (e) => {
                e.preventDefault();
                if (draggedItem && draggedItem !== item) {
                    const list = item.closest(".template-list");
                    if (list.dataset.channel === draggedChannel) {
                        const rect = item.getBoundingClientRect();
                        const midY = rect.top + rect.height / 2;
                        if (e.clientY < midY) {
                            list.insertBefore(draggedItem, item);
                        } else {
                            list.insertBefore(draggedItem, item.nextSibling);
                        }
                    }
                }
            });

            item.addEventListener("drop", () => {
                if (draggedItem && draggedChannel) {
                    const newIndex = parseInt(draggedItem.dataset.index);
                    const items = Array.from(item.closest(".template-list").children);
                    const actualNewIndex = items.indexOf(draggedItem);

                    if (draggedIndex !== actualNewIndex) {
                        Storage.reorderTemplate(draggedChannel, draggedIndex, actualNewIndex);
                        if (this.currentIframe) {
                            this.setupChatButtons(this.currentIframe);
                        }
                        // インデックスを更新
                        items.forEach((li, idx) => li.dataset.index = idx);
                    }
                }
            });
        });
    },

    // 削除ボタンの設定
    setupDeleteButtons(modal) {
        modal.querySelectorAll(".delete-template-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const channel = btn.dataset.channel;
                const index = parseInt(btn.dataset.index);
                if (confirm("このテンプレートを削除しますか？")) {
                    Storage.deleteTemplate(channel, index);
                    if (this.currentIframe) {
                        this.setupChatButtons(this.currentIframe);
                    }
                    this.showManagementUI(); // UIを再描画
                }
            });
        });
    },

    // スタイルの追加
    addStyles(iframe) {
        const styleId = "chat-helper-styles";
        if (iframe.contentDocument.querySelector(`#${styleId}`)) return;

        const styleTag = document.createElement("style");
        styleTag.id = styleId;
        styleTag.textContent = `
            #chat-helper-buttons {
                position: absolute;
                top: 0;
                margin-top: 36px;
                visibility: hidden;
                z-index: 1;
                background: rgba(144, 238, 144, 0.2);
                height: auto;
                width: 100%;
                overflow: hidden;
                transition: all 0.2s ease;
                display: flex;
                gap: 3px;
                flex-wrap: wrap;
                padding: 0;
            }

            #chat-helper-buttons button {
                visibility: hidden;
                height: 0;
                margin: 0;
                padding: 0;
                font-size: 12px;
                background-color: #0073e6;
                color: white;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                transition: all 0.2s ease;
            }

            #chat-helper-buttons button.template-btn.global {
                background-color: #9c27b0;
            }

            #chat-helper-buttons button.save-btn {
                background-color: #4caf50;
            }

            #chat-helper-buttons button.save-btn.global-btn {
                background-color: #ff9800;
            }

            #chat-helper-buttons button.manage-btn {
                background-color: #607d8b;
            }

            #input-panel>yt-live-chat-message-input-renderer[emoji-open] #chat-helper-buttons {
                visibility: visible;
                margin-top: 36px;
                padding-bottom: 10px;
            }

            #chat-helper-buttons:hover {
                height: auto;
                opacity: 0.9;
                padding: 4px;
            }

            #chat-helper-buttons:hover button {
                padding: 2px 5px;
                visibility: visible;
                height: 19px;
            }

            #input-panel #container {
                position: relative;
            }

            #input-panel #top {
                position: relative;
                z-index: 200;
            }

            #chat-helper-buttons img {
                --img-size: 15px;
                height: var(--img-size);
                width: var(--img-size);
                vertical-align: middle;
            }
        `;

        iframe.contentDocument.head.appendChild(styleTag);
    },

    // メインページのスタイル
    addMainPageStyles() {
        const styleId = "chat-helper-main-styles";
        if (document.querySelector(`#${styleId}`)) return;

        const styleTag = document.createElement("style");
        styleTag.id = styleId;
        styleTag.textContent = `
            #chat-helper-context-menu {
                position: absolute;
                background: white;
                border: 1px solid #ccc;
                box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.2);
                border-radius: 4px;
                z-index: 10000;
                min-width: 120px;
            }

            #chat-helper-context-menu .menu-item {
                padding: 8px 12px;
                cursor: pointer;
                font-size: 14px;
            }

            #chat-helper-context-menu .menu-item:hover {
                background: #f0f0f0;
            }

            #chat-helper-management-modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.5);
                z-index: 10001;
                display: flex;
                justify-content: center;
                align-items: center;
            }

            #chat-helper-management-modal .modal-content {
                background: white;
                border-radius: 8px;
                width: 80%;
                max-width: 800px;
                max-height: 80%;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            #chat-helper-management-modal .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px;
                border-bottom: 1px solid #ddd;
            }

            #chat-helper-management-modal .modal-header h2 {
                margin: 0;
                font-size: 20px;
            }

            #chat-helper-management-modal .close-btn {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                padding: 0 8px;
            }

            #chat-helper-management-modal .modal-body {
                padding: 16px;
                overflow-y: auto;
            }

            #chat-helper-management-modal .tabs {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
            }

            #chat-helper-management-modal .tab {
                padding: 8px 16px;
                border: 1px solid #ddd;
                background: #f5f5f5;
                cursor: pointer;
                border-radius: 4px;
            }

            #chat-helper-management-modal .tab.active {
                background: #0073e6;
                color: white;
                border-color: #0073e6;
            }

            #chat-helper-management-modal .tab-content {
                min-height: 200px;
            }

            #chat-helper-management-modal .tab-content.hidden {
                display: none;
            }

            #chat-helper-management-modal .template-list {
                list-style: none;
                padding: 0;
                margin: 0;
            }

            #chat-helper-management-modal .template-item {
                display: flex;
                align-items: center;
                padding: 8px;
                border: 1px solid #ddd;
                margin-bottom: 4px;
                border-radius: 4px;
                background: white;
            }

            #chat-helper-management-modal .template-item.dragging {
                opacity: 0.5;
            }

            #chat-helper-management-modal .drag-handle {
                cursor: move;
                margin-right: 8px;
                color: #888;
            }

            #chat-helper-management-modal .template-caption {
                flex: 1;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            #chat-helper-management-modal .template-time {
                color: #888;
                font-size: 12px;
                margin-right: 8px;
            }

            #chat-helper-management-modal .delete-template-btn {
                background: #f44336;
                color: white;
                border: none;
                padding: 4px 8px;
                border-radius: 4px;
                cursor: pointer;
            }

            #chat-helper-management-modal .channel-section {
                margin-bottom: 24px;
            }

            #chat-helper-management-modal .channel-section h3 {
                margin: 0 0 8px 0;
                color: #333;
            }
        `;

        document.head.appendChild(styleTag);
    }
};

// スタンプ自動読み込み
const StampLoader = {
    loaded: false,

    autoLoadStamps(iframe) {
        if (this.loaded) return;

        const emojiButton = Utils.safeQuerySelector(
            iframe.contentDocument,
            "#emoji-picker-button button, yt-live-chat-icon-toggle-button-renderer button"
        );

        if (!emojiButton) {
            console.log("絵文字ボタンが見つかりません。");
            return;
        }

        // 2回クリックして開閉
        setTimeout(() => {
            emojiButton.click(); // 開く
            setTimeout(() => {
                emojiButton.click(); // 閉じる
                this.loaded = true;
                console.log("スタンプを自動読み込みしました。");
            }, 500);
        }, 1000);
    }
};

// メイン処理
const ChatHelper = {
    initialized: false,
    observer: null,

    init() {
        console.log("YouTube Chat Helper を初期化中...");
        UI.addMainPageStyles();
        this.observeDOM();
        this.checkForChatFrame();
    },

    // MutationObserverでDOM変更を監視
    observeDOM() {
        if (this.observer) this.observer.disconnect();

        this.observer = new MutationObserver(
            Utils.debounce(() => {
                this.checkForChatFrame();
            }, 500)
        );

        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // URL変更の監視（History API）
        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                this.initialized = false;
                StampLoader.loaded = false;
                this.checkForChatFrame();
            }
        });

        urlObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    },

    // チャットフレームの検索と初期化
    checkForChatFrame() {
        const chatFrame = document.querySelector("iframe#chatframe");
        if (!chatFrame) return;

        if (!this.initialized) {
            chatFrame.addEventListener("load", () => {
                this.initializeFrame(chatFrame);
            });

            // 既にロード済みの場合
            if (chatFrame.contentDocument?.readyState === "complete") {
                this.initializeFrame(chatFrame);
            }
        }
    },

    initializeFrame(iframe) {
        console.log("チャットフレームを初期化中...");
        this.initialized = true;

        // スタイルの追加
        UI.addStyles(iframe);

        // ボタンのセットアップ
        UI.setupChatButtons(iframe);

        // スタンプの自動読み込み
        StampLoader.autoLoadStamps(iframe);

        console.log("YouTube Chat Helper の初期化完了！");
    }
};

// 初期化
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => ChatHelper.init());
} else {
    ChatHelper.init();
}
