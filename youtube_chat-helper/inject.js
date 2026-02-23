// YouTube Chat Helper - Refactored Version v3.0
// グローバル変数
const STORAGE_KEY = "chatData";
const SETTINGS_KEY = "chatHelperSettings";
const GLOBAL_CHANNEL_KEY = "__global__";

// チャンネル情報キャッシュ（非同期取得の結果を保持）
let _channelInfoCache = null;
let _channelInfoPromise = null;

// ユーティリティ関数
const Utils = {
  safeQuerySelector(element, selector) {
    try {
      return element?.querySelector(selector) || null;
    } catch (e) {
      console.warn(`Selector Error: ${selector}`, e);
      return null;
    }
  },

  safeQuerySelectorAll(element, selector) {
    try {
      return element?.querySelectorAll(selector) || [];
    } catch (e) {
      console.warn(`Selector Error: ${selector}`, e);
      return [];
    }
  },

  getChannelInfo() {
    // iframe内のYouTubeチャットで実行されている場合
    const isInIframe = window.self !== window.top;
    const isYouTubeChatIframe = window.location.href.includes("youtube.com/live_chat");

    if (isInIframe && isYouTubeChatIframe) {
      // YouTubeチャット内のチャンネル情報を取得
      // 方法1: チャンネル名の要素から取得
      let channelElement = this.safeQuerySelector(
        document,
        "yt-live-chat-header-renderer #channel-name a, " +
        "yt-live-chat-header-renderer yt-formatted-string a, " +
        "#author-name a"
      );

      if (channelElement) {
        return {
          name: channelElement.innerText.trim(),
          href: channelElement.href
        };
      }

      // 方法2: URLから動画IDを取得してチャンネル識別
      const urlParams = new URLSearchParams(window.location.search);
      const videoId = urlParams.get('v');
      if (videoId) {
        return {
          name: `Video_${videoId}`,
          href: `https://www.youtube.com/watch?v=${videoId}`
        };
      }
    }

    // 通常のYouTubeページ
    let channelElement = this.safeQuerySelector(
      document,
      "ytd-channel-name#channel-name yt-formatted-string#text a"
    );

    if (channelElement) {
      return {
        name: channelElement.innerText.trim(),
        href: channelElement.href
      };
    }

    // Holodex親ページ用
    channelElement = this.safeQuerySelector(
      document,
      ".channel-name a, .video-channel a, [class*='channel'] a"
    );

    if (channelElement) {
      return {
        name: channelElement.innerText.trim(),
        href: channelElement.href
      };
    }

    // URLからチャンネル情報を取得（フォールバック）
    const url = window.location.href;
    if (url.includes("holodex.net")) {
      // Holodexの場合、ページタイトルやURLから推測
      const titleElement = this.safeQuerySelector(document, "h1, .video-title, title");
      if (titleElement) {
        return {
          name: "Holodex_" + (titleElement.innerText || "Unknown").trim().slice(0, 30),
          href: url
        };
      }
    }

    return null;
  },

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
  },

  isHolodex() {
    return window.location.hostname.includes("holodex.net");
  },

  isYouTube() {
    return window.location.hostname.includes("youtube.com");
  },

  // URLからvideoIdを抽出
  extractVideoId(url) {
    if (!url) url = window.location.href;
    const urlParams = new URLSearchParams(new URL(url).search);
    return urlParams.get('v') || null;
  },

  // oEmbed APIでチャンネル情報を取得
  async fetchChannelFromOEmbed(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const response = await fetch(url);
      if (!response.ok) return null;
      const data = await response.json();
      // author_url は "@handle" 形式: https://www.youtube.com/@SakuraMiko
      const handle = data.author_url ? data.author_url.split('/').pop() : null;
      return {
        name: data.author_name,
        handle: handle,
        href: data.author_url
      };
    } catch (e) {
      return null;
    }
  },

  // @handleからUCxxxx形式のチャンネルIDを解決
  async resolveChannelId(handle) {
    if (!handle) return null;
    try {
      // YouTube同一オリジンなのでCORS問題なし
      const response = await fetch(`https://www.youtube.com/${handle}`);
      if (!response.ok) return null;
      const html = await response.text();
      // HTMLからchannelIdを抽出
      const match = html.match(/"externalId"\s*:\s*"(UC[^"]+)"/) ||
                    html.match(/"channelId"\s*:\s*"(UC[^"]+)"/);
      if (match) {
        return match[1];
      }
    } catch (e) {
      // resolveChannelId失敗
    }
    return null;
  },

  // 非同期でチャンネル情報を取得（oEmbed + UCxxxx解決）
  async getChannelInfoAsync() {
    // キャッシュがあればそれを返す
    if (_channelInfoCache) return _channelInfoCache;
    // 既に取得中ならそのPromiseを返す
    if (_channelInfoPromise) return _channelInfoPromise;

    _channelInfoPromise = this._resolveChannelInfo();
    _channelInfoCache = await _channelInfoPromise;
    _channelInfoPromise = null;
    return _channelInfoCache;
  },

  async _resolveChannelInfo() {
    const videoId = this.extractVideoId();
    if (!videoId) {
      // videoIdが取れない場合は同期版にフォールバック
      return this.getChannelInfo();
    }

    // oEmbed APIでチャンネル名と@handleを取得
    const oembedResult = await this.fetchChannelFromOEmbed(videoId);
    if (!oembedResult) {
      return this.getChannelInfo();
    }

    // @handleからUCxxxxを解決
    const channelId = await this.resolveChannelId(oembedResult.handle);

    const result = {
      id: channelId || null,
      handle: oembedResult.handle || null,
      name: oembedResult.name,
      href: oembedResult.href,
      videoId: videoId
    };

    return result;
  }
};

// 設定管理
const Settings = {
  defaults: {
    ccpppEnabled: true,
    autoLoadStamps: true
  },

  get() {
    // content.jsからDOM属性で共有された設定を優先
    const attr = document.documentElement?.getAttribute("data-chat-helper-settings");
    if (attr) {
      try {
        return { ...this.defaults, ...JSON.parse(attr) };
      } catch (e) {
        // JSON parse失敗時は次のフォールバックへ
      }
    }

    // 後方互換: 旧方式のwindow変数も許容
    if (window.__CHAT_HELPER_SETTINGS__) {
      return { ...this.defaults, ...window.__CHAT_HELPER_SETTINGS__ };
    }

    // フォールバック: localStorageから読み込み
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return { ...this.defaults, ...saved };
    } catch (e) {
      return this.defaults;
    }
  },

  save(settings) {
    // 互換性のためwindow変数を更新
    window.__CHAT_HELPER_SETTINGS__ = settings;
    // 新方式: DOM属性も更新
    try {
      document.documentElement?.setAttribute("data-chat-helper-settings", JSON.stringify(settings));
    } catch (e) {
      // no-op
    }

    // localStorageにも保存（バックアップ）
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      console.error("設定保存エラー:", e);
      return false;
    }
  },

  set(key, value) {
    const settings = this.get();
    settings[key] = value;
    return this.save(settings);
  },

  // 設定変更イベントのリスナー
  listenForChanges(callback) {
    window.addEventListener("chatHelperSettingsChanged", (e) => {
      window.__CHAT_HELPER_SETTINGS__ = e.detail;
      try {
        document.documentElement?.setAttribute("data-chat-helper-settings", JSON.stringify(e.detail));
      } catch (err) {
        // no-op
      }
      callback(e.detail);
    });
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

  saveTemplate(newContent, isGlobal = false, channelInfo = null) {
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
      // channelInfoが渡されなければキャッシュまたは同期版から取得
      const info = channelInfo || _channelInfoCache || Utils.getChannelInfo();
      if (!info) {
        return false;
      }

      // 既存チャンネルを検索（id > handle > name）
      let channel = this.findChannel(data, info);
      if (!channel) {
        channel = {
          name: info.name,
          href: info.href,
          data: []
        };
        // 新しいフィールドがあれば追加
        if (info.id) channel.id = info.id;
        if (info.handle) channel.handle = info.handle;
        data.channels.push(channel);
      } else {
        // 既存チャンネルにid/handleが未設定なら更新
        if (info.id && !channel.id) channel.id = info.id;
        if (info.handle && !channel.handle) channel.handle = info.handle;
        if (info.name && !channel.name) channel.name = info.name;
      }
      channel.data.push(template);
    }

    return this.saveData(data);
  },

  deleteTemplate(channelName, index) {
    const data = this.getData();

    if (channelName === GLOBAL_CHANNEL_KEY) {
      if (data.global && data.global[index]) {
        data.global.splice(index, 1);
      }
    } else {
      const channel = data.channels.find(ch =>
        ch.name === channelName || ch.id === channelName || ch.handle === channelName
      );
      if (!channel) return false;
      channel.data.splice(index, 1);
      if (channel.data.length === 0) {
        data.channels = data.channels.filter(ch => ch !== channel);
      }
    }

    return this.saveData(data);
  },

  // テンプレートをグローバル⇔ローカルに移動
  moveTemplate(fromChannel, index, toGlobal) {
    const data = this.getData();
    let template;

    // 元の場所から取得して削除
    if (fromChannel === GLOBAL_CHANNEL_KEY) {
      if (!data.global || !data.global[index]) return false;
      template = data.global.splice(index, 1)[0];
    } else {
      // fromChannelはnameの場合もid/handleの場合もある
      const channel = data.channels.find(ch =>
        ch.name === fromChannel || ch.id === fromChannel || ch.handle === fromChannel
      );
      if (!channel || !channel.data[index]) return false;
      template = channel.data.splice(index, 1)[0];
      if (channel.data.length === 0) {
        data.channels = data.channels.filter(ch => ch !== channel);
      }
    }

    // 新しい場所に追加
    if (toGlobal) {
      if (!data.global) data.global = [];
      data.global.push(template);
    } else {
      const info = _channelInfoCache || Utils.getChannelInfo();
      if (!info) return false;

      let existingChannel = this.findChannel(data, info);
      if (!existingChannel) {
        existingChannel = {
          name: info.name,
          href: info.href,
          data: []
        };
        if (info.id) existingChannel.id = info.id;
        if (info.handle) existingChannel.handle = info.handle;
        data.channels.push(existingChannel);
      }
      existingChannel.data.push(template);
    }

    return this.saveData(data);
  },

  reorderTemplate(channelName, oldIndex, newIndex) {
    const data = this.getData();
    let templates;

    if (channelName === GLOBAL_CHANNEL_KEY) {
      templates = data.global || [];
    } else {
      const channel = data.channels.find(ch =>
        ch.name === channelName || ch.id === channelName || ch.handle === channelName
      );
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

  // チャンネルを名前/ID/handleで検索するヘルパー
  _findChannelByKey(data, channelName) {
    if (channelName === GLOBAL_CHANNEL_KEY) return null;
    return data.channels.find(ch =>
      ch.name === channelName || ch.id === channelName || ch.handle === channelName
    );
  },

  // エイリアスを設定
  setAlias(channelName, index, alias) {
    const data = this.getData();
    let template;

    if (channelName === GLOBAL_CHANNEL_KEY) {
      if (!data.global || !data.global[index]) return false;
      template = data.global[index];
    } else {
      const channel = this._findChannelByKey(data, channelName);
      if (!channel || !channel.data[index]) return false;
      template = channel.data[index];
    }

    template.alias = alias;
    return this.saveData(data);
  },

  // エイリアスを削除
  removeAlias(channelName, index) {
    const data = this.getData();
    let template;

    if (channelName === GLOBAL_CHANNEL_KEY) {
      if (!data.global || !data.global[index]) return false;
      template = data.global[index];
    } else {
      const channel = this._findChannelByKey(data, channelName);
      if (!channel || !channel.data[index]) return false;
      template = channel.data[index];
    }

    delete template.alias;
    return this.saveData(data);
  },

  generateCaption(content) {
    return content.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item.alt) return `[${item.alt}]`;
      return "";
    }).join("").slice(0, 50);
  },

  // チャンネル情報でマッチするチャンネルを検索（id > handle > name の優先順）
  findChannel(data, channelInfo) {
    if (!channelInfo) return null;

    // 1. チャンネルID (UCxxxx) でマッチ
    if (channelInfo.id) {
      const ch = data.channels.find(c => c.id === channelInfo.id);
      if (ch) return ch;
    }

    // 2. @handle でマッチ
    if (channelInfo.handle) {
      const ch = data.channels.find(c => c.handle === channelInfo.handle);
      if (ch) return ch;
    }

    // 3. チャンネル名でマッチ（後方互換性）
    if (channelInfo.name) {
      const ch = data.channels.find(c => c.name === channelInfo.name);
      if (ch) return ch;
    }

    return null;
  },

  getTemplatesForChannel(channelInfo) {
    const data = this.getData();
    const result = { channel: [], global: [] };

    if (data.global) {
      result.global = data.global.map((t, i) => ({ ...t, index: i, isGlobal: true }));
    }

    // channelInfoがstringの場合は後方互換性のためnameとして扱う
    const info = typeof channelInfo === "string" ? { name: channelInfo } : channelInfo;
    const channel = this.findChannel(data, info);
    if (channel) {
      result.channel = channel.data.map((t, i) => ({ ...t, index: i, isGlobal: false }));
    }

    return result;
  }
};

// CCPPP機能（絵文字自動変換）
const CCPPP = {
  enabled: true,
  emojiMap: new Map(),
  observer: null,

  init(iframe) {
    this.enabled = Settings.get().ccpppEnabled;
    if (!this.enabled) return;

    // iframe.contentDocument が null の場合は初期化をスキップ
    if (!iframe.contentDocument) return;

    this.buildEmojiMap(iframe);
    this.observeInput(iframe);
  },

  buildEmojiMap(iframe) {
    if (!iframe.contentDocument) return;

    const emojis = Utils.safeQuerySelectorAll(
      iframe.contentDocument,
      "tp-yt-iron-pages #categories img[alt]"
    );

    emojis.forEach(emoji => {
      if (emoji.alt) {
        this.emojiMap.set(emoji.alt, emoji.src);
      }
    });

  },

  observeInput(iframe) {
    if (!iframe.contentDocument) return;

    const inputField = Utils.safeQuerySelector(
      iframe.contentDocument,
      "yt-live-chat-text-input-field-renderer#input #input"
    );

    if (!inputField) return;

    if (this.observer) this.observer.disconnect();

    const debouncedProcess = Utils.debounce(() => this.processInput(iframe), 300);

    // MutationObserver
    this.observer = new MutationObserver(debouncedProcess);
    this.observer.observe(inputField, {
      childList: true,
      characterData: true,
      subtree: true
    });

    // paste/inputイベントでも検知（MutationObserverだけでは不十分な場合の補完）
    inputField.addEventListener("paste", () => {
      setTimeout(() => this.processInput(iframe), 100);
      setTimeout(() => this.processInput(iframe), 500);
    });

    inputField.addEventListener("input", debouncedProcess);

    // 初回チェック
    this.processInput(iframe);
  },

  processInput(iframe) {
    if (!this.enabled) return;

    if (!iframe.contentDocument) return;

    const inputField = Utils.safeQuerySelector(
      iframe.contentDocument,
      "yt-live-chat-text-input-field-renderer#input #input"
    );

    if (!inputField) return;

    // 既にCCPPPボタンを処理中のノードはスキップ
    if (inputField.querySelector(".ccppp-emoji-btn")) return;

    // テキストノードを検索（iframe内のdocumentを使用）
    const textNodes = [];
    const walker = iframe.contentDocument.createTreeWalker(
      inputField,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    if (textNodes.length === 0) return;

    // 各テキストノードで絵文字名を検索
    textNodes.forEach(textNode => {
      const text = textNode.textContent;
      if (!text || text.indexOf(':') === -1) return;

      const regex = /:([^:\s]+):/g;
      let match;
      let lastIndex = 0;
      const fragments = [];
      let hasEmoji = false;

      while ((match = regex.exec(text)) !== null) {
        const emojiName = match[1];
        if (this.emojiMap.has(emojiName)) {
          hasEmoji = true;
          // マッチ前のテキスト
          if (match.index > lastIndex) {
            fragments.push(iframe.contentDocument.createTextNode(text.slice(lastIndex, match.index)));
          }
          // 絵文字ボタン
          const btn = this.createEmojiButton(emojiName, iframe);
          fragments.push(btn);
          lastIndex = match.index + match[0].length;
        }
      }

      if (hasEmoji) {
        // 残りのテキスト
        if (lastIndex < text.length) {
          fragments.push(iframe.contentDocument.createTextNode(text.slice(lastIndex)));
        }
        // MutationObserverを一時停止して無限ループを防ぐ
        if (this.observer) this.observer.disconnect();
        // ノードを置換
        const parent = textNode.parentNode;
        fragments.forEach(frag => parent.insertBefore(frag, textNode));
        parent.removeChild(textNode);
        // MutationObserverを再開
        if (this.observer) {
          this.observer.observe(inputField, {
            childList: true,
            characterData: true,
            subtree: true
          });
        }
      }
    });
  },

  createEmojiButton(emojiName, iframe) {
    const btn = iframe.contentDocument.createElement("button");
    btn.className = "ccppp-emoji-btn";
    btn.textContent = `:${emojiName}:`;
    btn.style.cssText = `
            background: #ff9800;
            color: white;
            border: none;
            border-radius: 4px;
            padding: 1px 4px;
            margin: 0 2px;
            cursor: pointer;
            font-size: 11px;
    `;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // まず絵文字ピッカーが開いているか確認、開いていなければ開く
      const emojiPickerBtn = Utils.safeQuerySelector(
        iframe.contentDocument,
        "#emoji-picker-button button, yt-live-chat-icon-toggle-button-renderer button"
      );

      const categories = Utils.safeQuerySelector(
        iframe.contentDocument,
        "tp-yt-iron-pages #categories"
      );

      const clickEmoji = () => {
        const cats = Utils.safeQuerySelector(
          iframe.contentDocument,
          "tp-yt-iron-pages #categories"
        );
        if (cats) {
          const emojiBtn = Utils.safeQuerySelector(cats, `img[alt="${emojiName}"]`);
          if (emojiBtn) {
            emojiBtn.click();
            btn.remove();
          }
        }
      };

      if (!categories && emojiPickerBtn) {
        emojiPickerBtn.click();
        setTimeout(() => {
          clickEmoji();
          // ピッカーを閉じる
          if (emojiPickerBtn) emojiPickerBtn.click();
        }, 300);
      } else {
        clickEmoji();
      }
    });

    return btn;
  },

  toggle(enabled) {
    this.enabled = enabled;
    Settings.set("ccpppEnabled", enabled);
  }
};

// UI管理
const UI = {
  currentIframe: null,
  managementModal: null,

  readChatInput(iframe) {
    const inputElement = Utils.safeQuerySelector(
      iframe.contentDocument,
      "yt-live-chat-text-input-field-renderer#input #input"
    );
    if (!inputElement) return null;

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

  insertTemplate(data, iframe) {
    const inputPanel = Utils.safeQuerySelector(iframe.contentDocument, "#input-panel");
    if (!inputPanel) return;

    const categories = Utils.safeQuerySelector(inputPanel, "tp-yt-iron-pages #categories");
    const inputField = Utils.safeQuerySelector(inputPanel, "yt-live-chat-text-input-field-renderer#input");

    if (!inputField) return;

    data.forEach(item => {
      if (typeof item === "string") {
        inputField.insertText(item);
      } else if (typeof item === "object" && item.alt && categories) {
        const button = Utils.safeQuerySelector(categories, `[alt="${item.alt}"]`);
        if (button) button.click();
      }
    });
  },

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

  setupChatButtons(iframe) {
    this.currentIframe = iframe;

    // iframe.contentDocument が null の場合は早期リターン
    if (!iframe.contentDocument) return;

    /* emoji load */
    const emojiButton = Utils.safeQuerySelector(
      iframe.contentDocument,
      "#emoji-picker-button button, yt-live-chat-icon-toggle-button-renderer button"
    );
    if (!emojiButton) return;
    emojiButton.click();
    emojiButton.click();

    const chatContainer = Utils.safeQuerySelector(
      iframe.contentDocument,
      "#chat-messages #input-panel #container"
    );
    const chatContainerTop = Utils.safeQuerySelector(
      iframe.contentDocument,
      "#chat-messages #input-panel #container > #top"
    );
    const inputField = Utils.safeQuerySelector(
      iframe.contentDocument,
      "yt-live-chat-text-input-field-renderer#input #input"
    );
    if (!chatContainer) return;
    if (!chatContainerTop) return;
    // 登録者限定などで入力欄が無い/無効な場合はボタンUIを作らない
    if (!inputField || inputField.getAttribute("contenteditable") === "false") return;

    const existingWrapper = Utils.safeQuerySelector(iframe.contentDocument, "#chat-helper-buttons");
    if (existingWrapper) existingWrapper.remove();

    const buttonWrapper = document.createElement("div");
    buttonWrapper.id = "chat-helper-buttons";

    // キャッシュまたは同期版からチャンネル情報を取得
    const channelInfo = _channelInfoCache || Utils.getChannelInfo();
    const templates = Storage.getTemplatesForChannel(channelInfo);

    // チャンネル識別キー（UIの内部処理用: id > handle > name）
    const channelKey = channelInfo?.id || channelInfo?.handle || channelInfo?.name;

    // グローバルテンプレートボタン
    templates.global.forEach((entry, idx) => {
      const btn = this.createTemplateButton(entry, idx, GLOBAL_CHANNEL_KEY, iframe, true);
      buttonWrapper.appendChild(btn);
    });

    // チャンネル別テンプレートボタン
    templates.channel.forEach((entry, idx) => {
      const btn = this.createTemplateButton(entry, idx, channelKey, iframe, false);
      buttonWrapper.appendChild(btn);
    });

    // 保存ボタン（チャンネル用）
    const saveButton = this.createButton("save-channel-btn", "Save", () => {
      const data = this.readChatInput(iframe);
      if (data && data.length > 0) {
        Storage.saveTemplate(data, false, channelInfo);
        this.setupChatButtons(iframe);
      }
    }, "save-btn");
    buttonWrapper.appendChild(saveButton);

    chatContainerTop.insertAdjacentElement("afterend", buttonWrapper);

    // ドラッグ＆ドロップを設定
    this.setupButtonDragAndDrop(iframe);
  },

  createTemplateButton(entry, index, channelName, iframe, isGlobal) {
    // エイリアスがある場合はそれを表示、なければ元のコンテンツを表示
    const displayContent = entry.alias || entry.content;
    const hasAlias = !!entry.alias;

    let className = isGlobal ? "template-btn global draggable" : "template-btn draggable";
    if (hasAlias) {
      className += " aliased";
    }

    const btn = this.createButton(
      `template-btn-${isGlobal ? "g" : "c"}-${index}`,
      displayContent,
      () => this.insertTemplate(entry.content, iframe),
      className
    );

    // ドラッグ可能にする
    btn.draggable = true;
    btn.dataset.channelName = channelName;
    btn.dataset.index = index;
    btn.dataset.isGlobal = isGlobal;

    // 右クリックメニュー
    btn.oncontextmenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.showContextMenu(event, channelName, index, iframe, isGlobal);
      return false;
    };

    return btn;
  },

  setupButtonDragAndDrop(iframe) {
    const wrapper = Utils.safeQuerySelector(iframe.contentDocument, "#chat-helper-buttons");
    if (!wrapper) return;

    let draggedBtn = null;

    wrapper.querySelectorAll("button.draggable").forEach(btn => {
      btn.addEventListener("dragstart", (e) => {
        draggedBtn = btn;
        btn.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        // ドラッグ中のカーソルを設定
        iframe.contentDocument.body.style.cursor = "grabbing";
      });

      btn.addEventListener("dragend", () => {
        btn.classList.remove("dragging");
        draggedBtn = null;
        // カーソルを元に戻す
        iframe.contentDocument.body.style.cursor = "";
      });

      btn.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!draggedBtn || draggedBtn === btn) return;

        // 同じカテゴリ（グローバル/ローカル）のみ並び替え可能
        if (draggedBtn.dataset.isGlobal !== btn.dataset.isGlobal) return;

        const rect = btn.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;

        if (e.clientX < midX) {
          wrapper.insertBefore(draggedBtn, btn);
        } else {
          wrapper.insertBefore(draggedBtn, btn.nextSibling);
        }
      });

      btn.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!draggedBtn) return;

        // 新しい順番を保存
        const channelName = draggedBtn.dataset.channelName;
        const oldIndex = parseInt(draggedBtn.dataset.index);
        const isGlobal = draggedBtn.dataset.isGlobal === "true";

        // 同じカテゴリのボタンを取得して新しいインデックスを計算
        const sameTypeButtons = Array.from(wrapper.querySelectorAll(`button.draggable[data-is-global="${isGlobal}"]`));
        const newIndex = sameTypeButtons.indexOf(draggedBtn);

        if (oldIndex !== newIndex && newIndex >= 0) {
          Storage.reorderTemplate(channelName, oldIndex, newIndex);
          this.setupChatButtons(iframe);
        }
      });
    });
  },

  // 別名入力ダイアログを表示
  showAliasInputDialog(event, template, channelName, index, iframe) {
    // 既存のダイアログを削除
    const existingDialog = iframe.contentDocument.querySelector("#chat-helper-alias-dialog");
    if (existingDialog) existingDialog.remove();

    const dialog = iframe.contentDocument.createElement("div");
    dialog.id = "chat-helper-alias-dialog";
    dialog.style.cssText = `
      position: fixed;
      background: white;
      border: 2px solid #ff9800;
      box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.3);
      border-radius: 4px;
      z-index: 10001;
      padding: 12px;
      min-width: 250px;
    `;

    // タイトル
    const title = iframe.contentDocument.createElement("div");
    title.textContent = "別名を入力してください";
    title.style.cssText = "font-weight: bold; margin-bottom: 8px; font-size: 14px;";
    dialog.appendChild(title);

    // 入力フィールド（contenteditable）
    const inputField = iframe.contentDocument.createElement("div");
    inputField.contentEditable = true;
    inputField.style.cssText = `
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 6px;
      min-height: 30px;
      margin-bottom: 8px;
      background: white;
      overflow-x: auto;
      white-space: nowrap;
    `;

    // 元のコンテンツを表示（スタンプ含む）
    template.content.forEach(item => {
      if (typeof item === "string") {
        inputField.appendChild(iframe.contentDocument.createTextNode(item));
      } else if (typeof item === "object" && item.src) {
        const img = iframe.contentDocument.createElement("img");
        img.src = item.src;
        img.alt = item.alt || "";
        img.style.cssText = "height: 18px; width: 18px; vertical-align: middle;";
        inputField.appendChild(img);
      }
    });

    dialog.appendChild(inputField);

    // ボタンエリア
    const buttonArea = iframe.contentDocument.createElement("div");
    buttonArea.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";

    // OKボタン
    const okBtn = iframe.contentDocument.createElement("button");
    okBtn.textContent = "OK";
    okBtn.style.cssText = "background: #4caf50; color: white; border: none; padding: 6px 12px; border-radius: 3px; cursor: pointer;";
    okBtn.addEventListener("click", () => {
      // 入力内容を取得（テキストとスタンプ絵文字を含む配列）
      const aliasContent = [];
      inputField.childNodes.forEach(node => {
        if (node.nodeType === 3) { // テキストノード
          const text = node.textContent;
          if (text) aliasContent.push(text);
        } else if (node.nodeType === 1 && node.tagName === "IMG") { // imgタグ
          aliasContent.push({ alt: node.alt, src: node.src });
        }
      });

      if (aliasContent.length > 0) {
        Storage.setAlias(channelName, index, aliasContent);
        this.setupChatButtons(iframe);
      }
      dialog.remove();
    });

    // キャンセルボタン
    const cancelBtn = iframe.contentDocument.createElement("button");
    cancelBtn.textContent = "キャンセル";
    cancelBtn.style.cssText = "background: #ccc; color: black; border: none; padding: 6px 12px; border-radius: 3px; cursor: pointer;";
    cancelBtn.addEventListener("click", () => {
      dialog.remove();
    });

    buttonArea.appendChild(cancelBtn);
    buttonArea.appendChild(okBtn);
    dialog.appendChild(buttonArea);

    // ダイアログを表示
    iframe.contentDocument.body.appendChild(dialog);

    // コンテキストメニューの近くに配置
    dialog.style.left = `${event.clientX}px`;
    dialog.style.top = `${event.clientY}px`;

    // 画面外に出ないように調整
    const dialogRect = dialog.getBoundingClientRect();
    const iframeWidth = iframe.contentWindow.innerWidth;
    const iframeHeight = iframe.contentWindow.innerHeight;

    if (dialogRect.right > iframeWidth) {
      dialog.style.left = `${iframeWidth - dialogRect.width - 10}px`;
    }
    if (dialogRect.bottom > iframeHeight) {
      dialog.style.top = `${iframeHeight - dialogRect.height - 10}px`;
    }

    // フォーカスを設定
    inputField.focus();

    // Enterキーで確定
    inputField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        okBtn.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelBtn.click();
      }
    });

    // ダイアログ外クリックで閉じる
    const closeDialog = (e) => {
      if (!dialog.contains(e.target)) {
        dialog.remove();
      }
    };

    setTimeout(() => {
      iframe.contentDocument.addEventListener("click", closeDialog, { once: true });
      document.addEventListener("click", closeDialog, { once: true });
    }, 100);
  },

  showContextMenu(event, channelName, index, iframe, isGlobal) {
    // 既存のメニューを削除（iframe内と親ドキュメント両方）
    const existingMenu = iframe.contentDocument.querySelector("#chat-helper-context-menu");
    if (existingMenu) existingMenu.remove();
    const existingMenuParent = document.querySelector("#chat-helper-context-menu");
    if (existingMenuParent) existingMenuParent.remove();

    // 現在のテンプレートを取得してエイリアスがあるか確認
    const data = Storage.getData();
    let template;
    if (channelName === GLOBAL_CHANNEL_KEY) {
      template = data.global && data.global[index];
    } else {
      const channel = data.channels.find(ch => ch.name === channelName);
      template = channel && channel.data[index];
    }
    const hasAlias = template && template.alias;

    const menu = document.createElement("div");
    menu.id = "chat-helper-context-menu";
    menu.style.cssText = `
            position: fixed;
            background: white;
            border: 1px solid #ccc;
            box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.3);
            border-radius: 4px;
            z-index: 10000;
            min-width: 140px;
    `;

    const toggleText = isGlobal ? "ローカルに移動" : "グローバルに移動";
    const aliasText = hasAlias ? "もとに戻す" : "別名表示";
    const menuLabels = ["削除", toggleText, aliasText];

    // DOM APIを使用してメニュー項目を作成（Trusted Types対応）
    menuLabels.forEach(label => {
      const item = document.createElement("div");
      item.className = "menu-item";
      item.textContent = label;
      item.style.cssText = "padding: 8px 12px; cursor: pointer; font-size: 14px;";
      menu.appendChild(item);
    });

    // エイリアスがある場合、元のテキストを表示（スタンプ絵文字含む）
    if (hasAlias) {
      const originalItem = document.createElement("div");
      originalItem.className = "menu-item-info";
      originalItem.style.cssText = "padding: 8px 12px; font-size: 12px; color: #666; background-color: #f9f9f9; border-top: 1px solid #eee;";

      // "元: "ラベル
      const label = document.createTextNode("元: ");
      originalItem.appendChild(label);

      // 元のコンテンツを表示（スタンプ絵文字含む）
      template.content.forEach(item => {
        if (typeof item === "string") {
          originalItem.appendChild(document.createTextNode(item));
        } else if (typeof item === "object" && item.src) {
          const img = document.createElement("img");
          img.src = item.src;
          img.alt = item.alt || "";
          img.style.cssText = "height: 16px; width: 16px; vertical-align: middle;";
          originalItem.appendChild(img);
        }
      });

      menu.appendChild(originalItem);
    }

    // メニューをiframe内に表示（座標計算がシンプルになる）
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;

    iframe.contentDocument.body.appendChild(menu);

    // メニューが画面外に出ないように調整
    const menuRect = menu.getBoundingClientRect();
    const iframeWidth = iframe.contentWindow.innerWidth;
    const iframeHeight = iframe.contentWindow.innerHeight;

    if (menuRect.right > iframeWidth) {
      menu.style.left = `${event.clientX - menuRect.width}px`;
    }
    if (menuRect.bottom > iframeHeight) {
      menu.style.top = `${event.clientY - menuRect.height}px`;
    }

    // ホバー効果
    menu.querySelectorAll(".menu-item").forEach(item => {
      item.addEventListener("mouseenter", () => {
        item.style.backgroundColor = "#f0f0f0";
      });
      item.addEventListener("mouseleave", () => {
        item.style.backgroundColor = "white";
      });
    });

    const menuItems = menu.querySelectorAll(".menu-item");

    // 削除
    menuItems[0].addEventListener("click", (e) => {
      e.stopPropagation();
      Storage.deleteTemplate(channelName, index);
      this.setupChatButtons(iframe);
      menu.remove();
    });

    // グローバル/ローカル切り替え
    menuItems[1].addEventListener("click", (e) => {
      e.stopPropagation();
      Storage.moveTemplate(channelName, index, !isGlobal);
      this.setupChatButtons(iframe);
      menu.remove();
    });

    // エイリアス設定/削除
    menuItems[2].addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();

      if (hasAlias) {
        // エイリアスを削除
        Storage.removeAlias(channelName, index);
        this.setupChatButtons(iframe);
      } else {
        // エイリアスを設定（カスタムダイアログを表示）
        this.showAliasInputDialog(event, template, channelName, index, iframe);
      }
    });

    // メニュー外クリックで閉じる
    const closeMenu = () => {
      if (iframe.contentDocument.body.contains(menu)) {
        menu.remove();
      }
    };

    setTimeout(() => {
      iframe.contentDocument.addEventListener("click", closeMenu, { once: true });
      document.addEventListener("click", closeMenu, { once: true });
    }, 100);
  },

  showSettingsUI() {
    if (this.managementModal) this.managementModal.remove();

    const modal = document.createElement("div");
    modal.id = "chat-helper-management-modal";
    this.managementModal = modal;

    const data = Storage.getData();
    const channelInfo = _channelInfoCache || Utils.getChannelInfo();
    const settings = Settings.get();

    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>YouTube Chat Helper 設定</h2>
          <button class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div class="tabs">
            <button class="tab active" data-tab="settings">設定</button>
            <button class="tab" data-tab="current">現在のチャンネル</button>
            <button class="tab" data-tab="global">グローバル</button>
            <button class="tab" data-tab="all">全チャンネル</button>
          </div>
          <div class="tab-content" id="tab-settings">
            <div class="settings-section">
              <h3>機能設定</h3>
              <label class="setting-item">
                <input type="checkbox" id="ccppp-toggle" ${settings.ccpppEnabled ? "checked" : ""}>
                <span>CCPPP（絵文字自動変換）を有効にする</span>
              </label>
              <p class="setting-desc">:emoji_name: 形式のテキストを自動的にクリック可能なボタンに変換します</p>

              <label class="setting-item">
                <input type="checkbox" id="autoload-toggle" ${settings.autoLoadStamps ? "checked" : ""}>
                <span>ページ読み込み時にスタンプを自動読み込み</span>
              </label>
              <p class="setting-desc">ページ読み込み時に絵文字ボタンを自動クリックしてスタンプを事前読み込みします</p>
            </div>
          </div>
          <div class="tab-content hidden" id="tab-current"></div>
          <div class="tab-content hidden" id="tab-global"></div>
          <div class="tab-content hidden" id="tab-all"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 設定の変更イベント
    modal.querySelector("#ccppp-toggle").addEventListener("change", (e) => {
      CCPPP.toggle(e.target.checked);
      if (e.target.checked && this.currentIframe) {
        CCPPP.init(this.currentIframe);
      }
    });

    modal.querySelector("#autoload-toggle").addEventListener("change", (e) => {
      Settings.set("autoLoadStamps", e.target.checked);
    });

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
      const channel = Storage.findChannel(data, channelInfo);
      const displayName = channelInfo.name || channelInfo.handle || channelInfo.id || "Unknown";
      const channelKey = channel ? (channel.id || channel.handle || channel.name) : null;
      if (channel && channel.data.length > 0) {
        currentTab.innerHTML = `<h3>${displayName}</h3>` + this.renderTemplateList(channelKey, channel.data, false);
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

    // モーダル外クリックで閉じる
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.remove();
        this.managementModal = null;
      }
    });

    this.setupDragAndDrop(modal);
    this.setupDeleteButtons(modal);
  },

  renderTemplateList(channelName, templates, isGlobal) {
    return `<ul class="template-list" data-channel="${channelName}">
            ${templates.map((t, i) => {
              const caption = t.caption || Storage.generateCaption(t.content);
              // aliasが配列の場合はgenerateCaptionで文字列に変換、文字列の場合はそのまま使用
              const aliasText = t.alias
                ? (Array.isArray(t.alias) ? Storage.generateCaption(t.alias) : t.alias)
                : null;
              const displayText = aliasText
                ? `<span class="alias-indicator">📝 ${this.escapeHtml(aliasText)}</span><span class="original-caption">(${this.escapeHtml(caption)})</span>`
                : this.escapeHtml(caption);
              return `
    <li class="template-item${t.alias ? ' has-alias' : ''}" draggable="true" data-index="${i}">
    <span class="drag-handle">☰</span>
    <span class="template-caption">${displayText}</span>
    <span class="template-time">${new Date(t.timestamp).toLocaleString()}</span>
    <button class="delete-template-btn" data-channel="${channelName}" data-index="${i}">削除</button>
    </li>
    `;
            }).join("")}
        </ul>`;
  },

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

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
          const items = Array.from(item.closest(".template-list").children);
          const actualNewIndex = items.indexOf(draggedItem);

          if (draggedIndex !== actualNewIndex) {
            Storage.reorderTemplate(draggedChannel, draggedIndex, actualNewIndex);
            if (this.currentIframe) {
              this.setupChatButtons(this.currentIframe);
            }
            items.forEach((li, idx) => li.dataset.index = idx);
          }
        }
      });
    });
  },

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
          this.showSettingsUI();
        }
      });
    });
  },

  addStyles(iframe) {
    // iframe.contentDocument が null の場合は早期リターン（クロスオリジンまたは未ロードの場合）
    if (!iframe.contentDocument) return;

    const styleId = "chat-helper-styles";
    if (iframe.contentDocument.querySelector(`#${styleId}`)) return;

    const styleTag = document.createElement("style");
    styleTag.id = styleId;
    styleTag.textContent = `
            #chat-helper-buttons {
                position: relative;
                top: 0;
                /*margin-top: 36px;*/
                z-index: 1;
                background: rgba(144, 238, 144, 0.3);
                height: auto;
                width: 100%;
                overflow: visible;
                display: flex;
                gap: 3px;
                flex-wrap: wrap;
                padding: 4px;
                box-sizing: border-box;
            }

            #chat-helper-buttons button {
                margin: 0;
                padding: 2px 6px;
                font-size: 12px;
                background-color: #0073e6;
                color: white;
                border: none;
                border-radius: 10px;
                cursor: pointer;
                height: auto;
                min-height: 20px;
                white-space: nowrap;
            }

            #chat-helper-buttons button:hover {
                opacity: 0.8;
            }

            #chat-helper-buttons button.draggable {
                cursor: pointer;
            }

            #chat-helper-buttons button.dragging {
                opacity: 0.5;
                cursor: grabbing;
            }

            #chat-helper-buttons button.template-btn.global {
                background-color: #9c27b0;
            }

            #chat-helper-buttons button.template-btn.aliased {
                border: 2px solid #ff9800;
            }

            #chat-helper-buttons button.save-btn {
                background-color: #4caf50;
                cursor: pointer;
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
                min-width: 140px;
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
                flex: 1;
            }

            #chat-helper-management-modal .tabs {
                display: flex;
                gap: 8px;
                margin-bottom: 16px;
                flex-wrap: wrap;
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

            #chat-helper-management-modal .settings-section {
                margin-bottom: 20px;
            }

            #chat-helper-management-modal .settings-section h3 {
                margin: 0 0 12px 0;
                color: #333;
            }

            #chat-helper-management-modal .setting-item {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 8px;
                cursor: pointer;
            }

            #chat-helper-management-modal .setting-item input[type="checkbox"] {
                width: 18px;
                height: 18px;
            }

            #chat-helper-management-modal .setting-desc {
                margin: 0 0 16px 26px;
                color: #666;
                font-size: 12px;
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

            #chat-helper-management-modal .template-item.has-alias {
                background-color: #fff9f0;
                border-color: #ff9800;
            }

            #chat-helper-management-modal .alias-indicator {
                font-weight: bold;
                color: #ff9800;
                margin-right: 6px;
            }

            #chat-helper-management-modal .original-caption {
                color: #888;
                font-size: 12px;
                font-style: italic;
                margin-left: 4px;
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
    if (!Settings.get().autoLoadStamps) return;


    setTimeout(() => {
      setTimeout(() => {
        this.loaded = true;

        // CCPPP初期化（スタンプ読み込み後）
        setTimeout(() => {
          CCPPP.init(iframe);
        }, 500);
      }, 100);
    }, 1000);
  }
};

// メイン処理
const ChatHelper = {
  initialized: false,
  observer: null,

  init() {
    // iframe内で実行されているかチェック
    const isInIframe = window.self !== window.top;
    const isYouTubeChatIframe = window.location.href.includes("youtube.com/live_chat");

    if (isInIframe && isYouTubeChatIframe) {
      this.initializeCurrentFrame();
      return;
    }

    UI.addMainPageStyles();
    this.observeDOM();
    this.checkForChatFrame();

    Utils.getChannelInfoAsync();

    Settings.listenForChanges((newSettings) => {
      CCPPP.enabled = newSettings.ccpppEnabled;

      // CCPPPが有効になった場合、再初期化
      if (newSettings.ccpppEnabled && UI.currentIframe) {
        CCPPP.init(UI.currentIframe);
      }
    });
  },

  initializeCurrentFrame() {
    // iframe要素の代わりに、windowオブジェクトを使用
    const pseudoIframe = {
      contentDocument: document,
      contentWindow: window
    };

    try {
      UI.addStyles(pseudoIframe);
      UI.setupChatButtons(pseudoIframe);
      StampLoader.autoLoadStamps(pseudoIframe);

      // 非同期でチャンネル情報を取得し、取得完了後にボタンを再描画
      Utils.getChannelInfoAsync().then(info => {
        if (info && (info.id || info.handle)) {
          UI.setupChatButtons(pseudoIframe);
        }
      });

      // 設定変更を監視
      Settings.listenForChanges((newSettings) => {
        CCPPP.enabled = newSettings.ccpppEnabled;

        if (newSettings.ccpppEnabled) {
          CCPPP.init(pseudoIframe);
        }
      });

    } catch (e) {
      console.error("initializeCurrentFrame: エラー", e);
    }
  },

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

    let lastUrl = location.href;
    const urlObserver = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        this.initialized = false;
        StampLoader.loaded = false;
        // チャンネル情報キャッシュをクリア（新しい動画/チャンネルの可能性）
        _channelInfoCache = null;
        _channelInfoPromise = null;
        this.checkForChatFrame();
      }
    });

    urlObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  },

  checkForChatFrame() {
    const isHolodex = Utils.isHolodex();
    const isYouTube = Utils.isYouTube();

    if (isHolodex) {
      // Holodexの場合、複数のチャットiframeを処理
      this.checkForChatFrameHolodex();
    } else if (isYouTube) {
      // YouTubeの場合、単一のチャットiframeを処理
      this.checkForChatFrameYouTube();
    }
  },

  checkForChatFrameYouTube() {
    // YouTube用
    const chatFrame = document.querySelector("iframe#chatframe");
    if (!chatFrame) return;

    // 既に初期化済みかチェック
    let hasButtons = false;
    try {
      if (chatFrame.contentDocument) {
        hasButtons = chatFrame.contentDocument.querySelector("#chat-helper-buttons") !== null;
      }
    } catch (e) {
      // クロスオリジンの場合は確認できない
    }

    if (this.initialized && hasButtons) {
      return; // 既に初期化済みでボタンも存在
    }

    if (!chatFrame.dataset.chatHelperListenerAdded) {
      chatFrame.addEventListener("load", () => {
        this.initialized = false; // リロード時にフラグをクリア
        this.initializeFrame(chatFrame);
      });
      chatFrame.dataset.chatHelperListenerAdded = "true";
    }

    try {
      if (chatFrame.contentDocument?.readyState === "complete") {
        this.initializeFrame(chatFrame);
      }
    } catch (e) {
      // クロスオリジンの場合、loadイベントを待つ
    }
  },

  checkForChatFrameHolodex() {
    // Holodex用：複数のチャットiframeを検出
    // 注意: Holodex親ページからはクロスオリジン制約によりiframe内にアクセスできません
    // iframe内での自己初期化（initializeCurrentFrame）に依存します
    const chatFrames = [];

    // Holodex専用のセレクタで検索
    const holodexSelectors = [
      "div.embedded-chat iframe",
      "div.watch-live-chat iframe",
      "div.cell-content iframe"
    ];

    for (const selector of holodexSelectors) {
      const iframes = document.querySelectorAll(selector);
      iframes.forEach(iframe => {
        try {
          if (iframe.src && iframe.src.includes("youtube.com/live_chat")) {
            // 重複を避ける
            if (!chatFrames.includes(iframe)) {
              chatFrames.push(iframe);
            }
          }
        } catch (e) {
          // クロスオリジンの場合は無視
        }
      });
    }

    // フォールバック：すべてのiframeをチェック
    if (chatFrames.length === 0) {
      const allIframes = document.querySelectorAll("iframe");
      for (const iframe of allIframes) {
        try {
          if (iframe.src && iframe.src.includes("youtube.com/live_chat")) {
            chatFrames.push(iframe);
          }
        } catch (e) {
          // クロスオリジンの場合は無視
        }
      }
    }

    if (chatFrames.length === 0) return;

    // クロスオリジンの場合、親ページからiframe内を初期化することはできません
    // 代わりに、all_frames:trueにより、iframe内でスクリプトが実行され、
    // initializeCurrentFrame()によって自己初期化されます
  },

  initializeFrameSafe(iframe, frameId) {
    const success = this.initializeFrame(iframe);
    if (success) {
      iframe.dataset.chatHelperInitialized = "true";
    }
  },

  initializeFrame(iframe) {
    if (!iframe.contentDocument) {
      this.initialized = false;
      return false;
    }

    try {
      this.initialized = true;
      UI.addStyles(iframe);
      UI.setupChatButtons(iframe);
      StampLoader.autoLoadStamps(iframe);
      return true;
    } catch (e) {
      console.error("initializeFrame: 初期化中にエラーが発生:", e);
      this.initialized = false;
      return false; // 失敗を返す
    }
  }
};

// 診断機能
const Diagnostics = {
  async run() {
    const results = {
      version: "3.0",
      timestamp: new Date().toISOString(),
      page: {
        url: window.location.href,
        isYouTube: Utils.isYouTube(),
        isHolodex: Utils.isHolodex(),
        isIframe: window.self !== window.top,
        isYouTubeChatIframe: window.location.href.includes("youtube.com/live_chat")
      },
      channelInfo: {
        cache: _channelInfoCache,
        sync: Utils.getChannelInfo()
      },
      ccppp: {
        enabled: CCPPP.enabled,
        emojiMapSize: CCPPP.emojiMap.size
      },
      chatHelper: {
        initialized: ChatHelper.initialized
      },
      storage: {
        channelCount: 0,
        globalTemplateCount: 0,
        channels: []
      }
    };

    const data = Storage.getData();
    results.storage.channelCount = data.channels.length;
    results.storage.globalTemplateCount = (data.global || []).length;
    results.storage.channels = data.channels.map(ch => ({
      name: ch.name || null,
      id: ch.id || null,
      handle: ch.handle || null,
      templateCount: ch.data.length
    }));

    return results;
  },

  async runChannelDetection() {
    const results = {
      timestamp: new Date().toISOString(),
      steps: []
    };

    // Step 1: videoId
    const videoId = Utils.extractVideoId();
    results.steps.push({
      name: "videoId抽出",
      success: !!videoId,
      result: videoId || "取得できません"
    });

    // Step 2: DOM検出（同期）
    const domResult = Utils.getChannelInfo();
    results.steps.push({
      name: "DOM検出（同期）",
      success: !!domResult,
      result: domResult || "検出できません"
    });

    if (!videoId) {
      results.steps.push({
        name: "oEmbed API",
        success: false,
        result: "videoIdがないためスキップ"
      });
      return results;
    }

    // Step 3: oEmbed API
    try {
      const oembedResult = await Utils.fetchChannelFromOEmbed(videoId);
      results.steps.push({
        name: "oEmbed API",
        success: !!oembedResult,
        result: oembedResult || "取得失敗"
      });

      if (oembedResult && oembedResult.handle) {
        // Step 4: resolveChannelId
        try {
          const channelId = await Utils.resolveChannelId(oembedResult.handle);
          results.steps.push({
            name: "チャンネルID解決",
            success: !!channelId,
            result: channelId || "解決できません"
          });
        } catch (e) {
          results.steps.push({
            name: "チャンネルID解決",
            success: false,
            result: `エラー: ${e.message}`
          });
        }
      }
    } catch (e) {
      results.steps.push({
        name: "oEmbed API",
        success: false,
        result: `エラー: ${e.message}`
      });
    }

    return results;
  }
};

// 診断リクエストのリスナー
window.addEventListener("chatHelperRunDiagnostics", () => {
  Diagnostics.run().then(results => {
    window.dispatchEvent(new CustomEvent("chatHelperDiagnosticsResult", {
      detail: results
    }));
  });
});

window.addEventListener("chatHelperRunChannelDetection", () => {
  Diagnostics.runChannelDetection().then(results => {
    window.dispatchEvent(new CustomEvent("chatHelperChannelDetectionResult", {
      detail: results
    }));
  });
});

// 初期化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => ChatHelper.init());
} else {
  ChatHelper.init();
}
