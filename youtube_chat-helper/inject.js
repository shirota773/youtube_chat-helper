// YouTube Chat Helper - Refactored Version v2.1
// グローバル変数
const STORAGE_KEY = "chatData";
const SETTINGS_KEY = "chatHelperSettings";
const GLOBAL_CHANNEL_KEY = "__global__";

// ユーティリティ関数
const Utils = {
  channelInfoCache: null, // チャンネル情報のキャッシュ
  channelInfoCacheTime: 0, // キャッシュの有効期限（ミリ秒）

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
    // キャッシュをチェック（10秒間有効）
    const now = Date.now();
    const CACHE_DURATION = 10000; // 10秒
    if (this.channelInfoCache && (now - this.channelInfoCacheTime) < CACHE_DURATION) {
      return this.channelInfoCache;
    }

    // iframe内のYouTubeチャットで実行されている場合
    const isInIframe = window.self !== window.top;
    const isYouTubeChatIframe = window.location.href.includes("youtube.com/live_chat");

    if (isInIframe && isYouTubeChatIframe) {
      // 優先度1: DOMからチャンネルIDを取得（UC... 形式）
      const channelIdSelectors = [
        "yt-live-chat-header-renderer a[href*='/channel/']",
        "a[href*='/channel/']",
        "#author-photo a[href*='/channel/']",
        "yt-live-chat-header-renderer a[href*='/@']",
        "a[href*='/@']"
      ];

      for (const selector of channelIdSelectors) {
        const element = this.safeQuerySelector(document, selector);
        if (element && element.href) {
          // /channel/UC... 形式から抽出
          const channelMatch = element.href.match(/\/channel\/(UC[^/?]+)/);
          if (channelMatch) {
            const channelId = channelMatch[1];
            const result = {
              name: channelId,
              href: element.href
            };
            this.channelInfoCache = result;
            this.channelInfoCacheTime = Date.now();
            return result;
          }

          // /@username 形式
          const handleMatch = element.href.match(/\/@([^/?]+)/);
          if (handleMatch) {
            const handle = `@${handleMatch[1]}`;
            const result = {
              name: handle,
              href: element.href
            };
            this.channelInfoCache = result;
            this.channelInfoCacheTime = Date.now();
            return result;
          }
        }
      }

      // 優先度2: URLから動画IDを取得（フォールバック）
      const urlParams = new URLSearchParams(window.location.search);
      let videoId = urlParams.get('v');

      // iframe URL に videoId がない場合、親 URL から取得
      if (!videoId) {
        const parentUrl = document.referrer;
        if (parentUrl) {
          const parentVideoMatch = parentUrl.match(/[?&]v=([^&]+)/);
          if (parentVideoMatch) {
            videoId = parentVideoMatch[1];
          }
        }
      }

      if (videoId) {
        const result = {
          name: `Video_${videoId}`,
          href: `https://www.youtube.com/watch?v=${videoId}`
        };
        this.channelInfoCache = result;
        this.channelInfoCacheTime = Date.now();
        return result;
      }

      // 最終フォールバック
      return {
        name: "Unknown_Channel",
        href: window.location.href
      };
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

    console.warn("[ChatHelper] チャンネル情報を取得できませんでした。");
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
  }
};

// 設定管理
const Settings = {
  defaults: {
    ccpppEnabled: true,
    autoLoadStamps: true
  },

  currentSettings: null,

  get() {
    // メモリ内の設定を優先
    if (this.currentSettings) {
      return { ...this.defaults, ...this.currentSettings };
    }
    return this.defaults;
  },

  save(settings) {
    // メモリに保存
    this.currentSettings = settings;

    // content.jsに保存を依頼（chrome.storageに保存）
    window.postMessage({
      source: "chat-helper-page",
      type: "settings-save",
      settings: settings
    }, "*");

    return true;
  },

  set(key, value) {
    const settings = this.get();
    settings[key] = value;
    return this.save(settings);
  },

  // 設定変更イベントのリスナー
  listenForChanges(callback) {
    // 後で登録されるリスナーを保存
    if (!window.__settingsChangeCallbacks__) {
      window.__settingsChangeCallbacks__ = [];
    }
    window.__settingsChangeCallbacks__.push(callback);
  },

  // 設定を受信したときに呼ばれる
  _onSettingsReceived(settings) {
    this.currentSettings = settings;

    // 登録されたコールバックを実行
    if (window.__settingsChangeCallbacks__) {
      window.__settingsChangeCallbacks__.forEach(cb => cb(settings));
    }
  }
};

// chrome.storage用のメッセージパッシングヘルパー
const ChromeStorageHelper = {
  requestIdCounter: 0,
  pendingRequests: new Map(),
  reloadNotificationShown: false,
  extensionInvalidated: false, // 拡張機能が無効化されたフラグ

  sendMessage(type, key, value = null) {
    return new Promise((resolve, reject) => {
      // 拡張機能が既に無効化されている場合は、静かに拒否
      if (this.extensionInvalidated) {
        reject(new Error("Extension context invalidated"));
        return;
      }

      const requestId = `req_${++this.requestIdCounter}_${Date.now()}`;

      // レスポンスリスナーを登録
      this.pendingRequests.set(requestId, { resolve, reject });

      // メッセージを送信
      window.postMessage({
        source: "chat-helper-page",
        type: type,
        requestId: requestId,
        key: key,
        value: value
      }, "*");

      // タイムアウト設定（10秒）
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          // 拡張機能が無効化されている場合はログを出さない
          if (!this.extensionInvalidated) {
            console.error("[ChatHelper] ストレージタイムアウト:", type, key);
          }
          reject(new Error(`Storage request timeout: ${type} ${key}`));
        }
      }, 10000);
    });
  },

  async get(key) {
    return this.sendMessage("storage-get", key);
  },

  async set(key, value) {
    return this.sendMessage("storage-set", key, value);
  },

  showReloadNotification() {
    if (this.reloadNotificationShown) return;
    this.reloadNotificationShown = true;
    this.extensionInvalidated = true; // フラグを設定

    // ページ上に目立つ通知バナーを表示（コンソールログは省略）
    this.showReloadBanner();
  },

  showReloadBanner() {
    // 既存のバナーがあれば何もしない
    if (document.getElementById("chat-helper-reload-banner")) return;

    const banner = document.createElement("div");
    banner.id = "chat-helper-reload-banner";
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #ff9800 0%, #ff6b00 100%);
      color: white;
      padding: 16px 20px;
      text-align: center;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      animation: slideDown 0.3s ease-out;
    `;

    // DOM APIを使用してバナーコンテンツを構築（Trusted Types対応）
    const container = document.createElement("div");
    container.style.cssText = "max-width: 800px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 16px; flex-wrap: wrap;";

    const icon = document.createElement("span");
    icon.style.fontSize = "20px";
    icon.textContent = "⚠️";

    const title = document.createElement("span");
    title.style.cssText = "font-size: 16px; font-weight: bold;";
    title.textContent = "YouTube Chat Helper が更新されました";

    const message = document.createElement("span");
    message.style.fontSize = "14px";
    message.textContent = "ページをリロードしてください";

    const reloadBtn = document.createElement("button");
    reloadBtn.id = "chat-helper-reload-btn";
    reloadBtn.style.cssText = `
      background: white;
      color: #ff9800;
      border: none;
      padding: 8px 20px;
      border-radius: 20px;
      font-weight: bold;
      cursor: pointer;
      font-size: 14px;
      transition: transform 0.2s;
    `;
    reloadBtn.textContent = "今すぐリロード (F5)";

    const dismissBtn = document.createElement("button");
    dismissBtn.id = "chat-helper-dismiss-btn";
    dismissBtn.style.cssText = `
      background: transparent;
      color: white;
      border: 2px solid white;
      padding: 6px 16px;
      border-radius: 20px;
      font-weight: bold;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    `;
    dismissBtn.textContent = "後で";

    container.appendChild(icon);
    container.appendChild(title);
    container.appendChild(message);
    container.appendChild(reloadBtn);
    container.appendChild(dismissBtn);
    banner.appendChild(container);

    // アニメーションのスタイルを追加
    const style = document.createElement("style");
    style.textContent = `
      @keyframes slideDown {
        from {
          transform: translateY(-100%);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      #chat-helper-reload-btn:hover {
        transform: scale(1.05);
      }
      #chat-helper-dismiss-btn:hover {
        background: rgba(255, 255, 255, 0.2);
      }
    `;
    document.head.appendChild(style);

    document.body.appendChild(banner);

    // リロードボタンのイベント
    document.getElementById("chat-helper-reload-btn").addEventListener("click", () => {
      window.location.reload();
    });

    // 閉じるボタンのイベント
    document.getElementById("chat-helper-dismiss-btn").addEventListener("click", () => {
      banner.style.animation = "slideDown 0.3s ease-out reverse";
      setTimeout(() => banner.remove(), 300);
    });

    // 10秒後に自動的に消す（ユーザーが気づいている場合）
    setTimeout(() => {
      if (banner.parentNode) {
        banner.style.animation = "slideDown 0.3s ease-out reverse";
        setTimeout(() => banner.remove(), 300);
      }
    }, 10000);
  }
};

// レスポンスリスナーを設定
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const message = event.data;
  if (!message || message.source !== "chat-helper-content") return;

  // 拡張機能が再読み込みされた通知
  if (message.type === "extension-reloaded") {
    ChromeStorageHelper.showReloadNotification();
    return;
  }

  // 設定の初期化
  if (message.type === "settings-init") {
    Settings._onSettingsReceived(message.settings);
    return;
  }

  // 設定の変更通知
  if (message.type === "settings-changed") {
    Settings._onSettingsReceived(message.settings);
    return;
  }

  // ストレージGETレスポンス
  if (message.type === "storage-get-response") {
    const pending = ChromeStorageHelper.pendingRequests.get(message.requestId);
    if (pending) {
      ChromeStorageHelper.pendingRequests.delete(message.requestId);
      if (message.error) {
        if (message.error.includes("Extension context invalidated")) {
          // 通知を表示（ログは出さない）
          ChromeStorageHelper.showReloadNotification();
        } else if (!ChromeStorageHelper.extensionInvalidated) {
          // 拡張機能が無効化されていない場合のみエラーログを出す
          console.error("[ChatHelper] ストレージエラー:", message.error);
        }
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.data);
      }
    }
    return;
  }

  // ストレージSETレスポンス
  if (message.type === "storage-set-response") {
    const pending = ChromeStorageHelper.pendingRequests.get(message.requestId);
    if (pending) {
      ChromeStorageHelper.pendingRequests.delete(message.requestId);
      if (message.success) {
        pending.resolve(true);
      } else {
        if (message.error && message.error.includes("Extension context invalidated")) {
          // 通知を表示（ログは出さない）
          ChromeStorageHelper.showReloadNotification();
        } else if (!ChromeStorageHelper.extensionInvalidated) {
          // 拡張機能が無効化されていない場合のみエラーログを出す
          console.error("[ChatHelper] ストレージ保存エラー:", message.error);
        }
        pending.reject(new Error(message.error || "Storage set failed"));
      }
    }
    return;
  }
});

// ストレージ管理
const Storage = {
  async getData() {
    try {
      const data = await ChromeStorageHelper.get(STORAGE_KEY);
      return data || { channels: [], global: [] };
    } catch (e) {
      // 拡張機能が無効化されていない場合のみエラーログを出す
      if (!ChromeStorageHelper.extensionInvalidated && !e.message?.includes("Extension context invalidated")) {
        console.error("[ChatHelper] ストレージデータの読み込みエラー:", e);
      }
      return { channels: [], global: [] };
    }
  },

  async saveData(data) {
    try {
      await ChromeStorageHelper.set(STORAGE_KEY, data);
      return true;
    } catch (e) {
      // 拡張機能が無効化されていない場合のみエラーログを出す
      if (!ChromeStorageHelper.extensionInvalidated && !e.message?.includes("Extension context invalidated")) {
        console.error("[ChatHelper] ストレージデータの保存エラー:", e);
      }
      return false;
    }
  },

  async saveTemplate(newContent, isGlobal = false) {
    const data = await this.getData();
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
      if (!channelInfo || !channelInfo.name) {
        if (!data.global) data.global = [];
        data.global.push(template);
        return await this.saveData(data);
      }

      // エイリアスシステム: 現在の識別子がどのチャンネルのエイリアスにも含まれているか検索
      let channelIndex = data.channels.findIndex(ch => {
        // 後方互換性: 古いデータ構造（aliasesなし）もサポート
        if (!ch.aliases) {
          ch.aliases = [ch.name]; // 初回は name をエイリアスに追加
        }
        return ch.aliases.includes(channelInfo.name);
      });

      if (channelIndex === -1) {
        // 新しいチャンネルを作成
        data.channels.push({
          name: channelInfo.name,
          href: channelInfo.href,
          aliases: [channelInfo.name], // エイリアスリストに追加
          data: [template]
        });
      } else {
        // 既存のチャンネルにテンプレートを追加
        const channel = data.channels[channelIndex];

        // 現在の識別子がエイリアスリストになければ追加
        if (!channel.aliases.includes(channelInfo.name)) {
          channel.aliases.push(channelInfo.name);
        }

        // hrefを最新のものに更新
        channel.href = channelInfo.href;

        channel.data.push(template);
      }
    }

    return await this.saveData(data);
  },

  async deleteTemplate(channelName, index) {
    const data = await this.getData();

    if (channelName === GLOBAL_CHANNEL_KEY) {
      if (data.global && data.global[index]) {
        data.global.splice(index, 1);
      }
    } else {
      // エイリアスシステム対応
      const channel = data.channels.find(ch => {
        if (!ch.aliases) ch.aliases = [ch.name];
        return ch.aliases.includes(channelName);
      });
      if (!channel) return false;
      channel.data.splice(index, 1);
      if (channel.data.length === 0) {
        // チャンネルを削除する際も、エイリアスで検索
        data.channels = data.channels.filter(ch => {
          if (!ch.aliases) ch.aliases = [ch.name];
          return !ch.aliases.includes(channelName);
        });
      }
    }

    return await this.saveData(data);
  },

  // テンプレートをグローバル⇔ローカルに移動
  async moveTemplate(fromChannel, index, toGlobal) {
    const data = await this.getData();
    let template;

    // 元の場所から取得して削除
    if (fromChannel === GLOBAL_CHANNEL_KEY) {
      if (!data.global || !data.global[index]) return false;
      template = data.global.splice(index, 1)[0];
    } else {
      // エイリアスシステム対応
      const channel = data.channels.find(ch => {
        if (!ch.aliases) ch.aliases = [ch.name];
        return ch.aliases.includes(fromChannel);
      });
      if (!channel || !channel.data[index]) return false;
      template = channel.data.splice(index, 1)[0];
      if (channel.data.length === 0) {
        data.channels = data.channels.filter(ch => {
          if (!ch.aliases) ch.aliases = [ch.name];
          return !ch.aliases.includes(fromChannel);
        });
      }
    }

    // 新しい場所に追加
    if (toGlobal) {
      if (!data.global) data.global = [];
      data.global.push(template);
    } else {
      const channelInfo = Utils.getChannelInfo();
      if (!channelInfo) return false;

      // エイリアスシステム対応: 既存チャンネルを検索
      let channelIndex = data.channels.findIndex(ch => {
        if (!ch.aliases) ch.aliases = [ch.name];
        return ch.aliases.includes(channelInfo.name);
      });

      if (channelIndex === -1) {
        data.channels.push({
          name: channelInfo.name,
          href: channelInfo.href,
          aliases: [channelInfo.name],
          data: [template]
        });
      } else {
        const channel = data.channels[channelIndex];
        // エイリアスリストに現在の名前を追加
        if (!channel.aliases.includes(channelInfo.name)) {
          channel.aliases.push(channelInfo.name);
        }
        channel.data.push(template);
      }
    }

    return await this.saveData(data);
  },

  async reorderTemplate(channelName, oldIndex, newIndex) {
    const data = await this.getData();
    let templates;

    if (channelName === GLOBAL_CHANNEL_KEY) {
      templates = data.global || [];
    } else {
      // エイリアスシステム対応
      const channel = data.channels.find(ch => {
        if (!ch.aliases) ch.aliases = [ch.name];
        return ch.aliases.includes(channelName);
      });
      if (!channel) return false;
      templates = channel.data;
    }

    if (oldIndex < 0 || oldIndex >= templates.length || newIndex < 0 || newIndex >= templates.length) {
      return false;
    }

    const [removed] = templates.splice(oldIndex, 1);
    templates.splice(newIndex, 0, removed);

    return await this.saveData(data);
  },

  // エイリアスを設定
  async setAlias(channelName, index, alias) {
    const data = await this.getData();
    let template;

    if (channelName === GLOBAL_CHANNEL_KEY) {
      if (!data.global || !data.global[index]) return false;
      template = data.global[index];
    } else {
      const channel = data.channels.find(ch => ch.name === channelName);
      if (!channel || !channel.data[index]) return false;
      template = channel.data[index];
    }

    template.alias = alias;
    return await this.saveData(data);
  },

  // エイリアスを削除
  async removeAlias(channelName, index) {
    const data = await this.getData();
    let template;

    if (channelName === GLOBAL_CHANNEL_KEY) {
      if (!data.global || !data.global[index]) return false;
      template = data.global[index];
    } else {
      const channel = data.channels.find(ch => ch.name === channelName);
      if (!channel || !channel.data[index]) return false;
      template = channel.data[index];
    }

    delete template.alias;
    return await this.saveData(data);
  },

  generateCaption(content) {
    return content.map(item => {
      if (typeof item === "string") return item;
      if (typeof item === "object" && item.alt) return `[${item.alt}]`;
      return "";
    }).join("").slice(0, 50);
  },

  async getTemplatesForChannel(channelName) {
    const data = await this.getData();
    const result = { channel: [], global: [] };

    if (data.global) {
      result.global = data.global.map((t, i) => ({ ...t, index: i, isGlobal: true }));
    }

    if (channelName) {
      // エイリアスシステム: channelName がエイリアスに含まれるチャンネルを検索
      const channel = data.channels.find(ch => {
        // 後方互換性: 古いデータ構造もサポート
        if (!ch.aliases) {
          ch.aliases = [ch.name];
        }
        return ch.aliases.includes(channelName);
      });

      if (channel) {
        result.channel = channel.data.map((t, i) => ({ ...t, index: i, isGlobal: false }));
      }
    }

    return result;
  }
};

// CCPPP機能（絵文字自動変換）
const CCPPP = {
  enabled: true,
  iframeData: new Map(), // iframe ごとのデータを管理
  isProcessing: false, // 処理中フラグ
  maxSetupRetries: 10, // 最大リトライ回数（Holodex multiview 対応のため増加）
  retryDelay: 2000, // リトライ間隔（ミリ秒）

  init(iframe) {
    console.log("CCPPP: 初期化を開始します");
    this.enabled = Settings.get().ccpppEnabled;
    if (!this.enabled) {
      console.warn("CCPPP: 機能が無効化されています（設定で無効）");
      return;
    }
    console.log("CCPPP: 機能は有効です");

    // iframe.contentDocument が null の場合は初期化をスキップ
    if (!iframe.contentDocument) {
      console.warn("CCPPP: iframe.contentDocument is null, skipping init");
      return;
    }
    console.log("CCPPP: iframe.contentDocument が有効です");

    // このiframe用のデータを初期化
    if (!this.iframeData.has(iframe)) {
      this.iframeData.set(iframe, {
        emojiMap: new Map(),
        setupRetryCount: 0
      });
    }

    this.buildEmojiMap(iframe);
    this.setupPasteListener(iframe);
    console.log("CCPPP: 初期化完了！");
  },

  buildEmojiMap(iframe) {
    console.log("CCPPP: スタンプマップの構築を開始します");
    if (!iframe.contentDocument) {
      console.warn("CCPPP: iframe.contentDocument is null, skipping buildEmojiMap");
      return;
    }

    // iframeData が存在しない場合は初期化
    if (!this.iframeData.has(iframe)) {
      console.log("CCPPP: iframe データを初期化します");
      this.iframeData.set(iframe, {
        emojiMap: new Map(),
        setupRetryCount: 0
      });
    }

    // すべてのタブをクリックしてスタンプをロード（メンバーシップスタンプを含む）
    const categoryButtons = Utils.safeQuerySelectorAll(
      iframe.contentDocument,
      "yt-live-chat-emoji-picker-category-buttons button, #picker-tabs button"
    );

    if (categoryButtons.length > 0) {
      console.log(`CCPPP: ${categoryButtons.length} 個のカテゴリタブを検出しました`);
      // 各タブをクリックしてスタンプをロード
      categoryButtons.forEach((button, index) => {
        setTimeout(() => {
          console.log(`CCPPP: タブ ${index + 1}/${categoryButtons.length} をクリック`);
          button.click();
        }, index * 100); // 各クリックの間に100ms待つ
      });

      // すべてのタブをクリックした後、スタンプを収集
      setTimeout(() => {
        this.collectEmojisFromDOM(iframe);
      }, categoryButtons.length * 100 + 500);
    } else {
      this.collectEmojisFromDOM(iframe);
    }
  },

  collectEmojisFromDOM(iframe) {
    const data = this.iframeData.get(iframe);
    if (!data) {
      console.warn("CCPPP: iframe データが見つかりません");
      return;
    }

    const emojis = Utils.safeQuerySelectorAll(
      iframe.contentDocument,
      "tp-yt-iron-pages img[alt], yt-live-chat-emoji-picker-renderer img[alt], #picker img[alt]"
    );

    data.emojiMap.clear();

    emojis.forEach((emoji) => {
      if (emoji.alt) {
        data.emojiMap.set(emoji.alt, emoji.src);
      }
    });
  },

  setupPasteListener(iframe) {

    // iframeとcontentDocumentの有効性をチェック
    if (!iframe) {
      console.warn("CCPPP: iframe is null or undefined, skipping setupPasteListener");
      return;
    }

    if (!iframe.contentDocument) {
      console.warn("CCPPP: iframe.contentDocument is null, skipping setupPasteListener");
      return;
    }

    const data = this.iframeData.get(iframe);
    if (!data) {
      console.warn("CCPPP: iframe データが見つかりません");
      return;
    }

    // 複数のセレクタを試す
    const selectors = [
      "yt-live-chat-text-input-field-renderer#input #input",
      "yt-live-chat-text-input-field-renderer#input div[contenteditable]",
      "#input-panel yt-live-chat-text-input-field-renderer#input #input",
      "#input-panel div[contenteditable]"
    ];

    let inputField = null;
    let usedSelector = null;

    for (const selector of selectors) {
      inputField = Utils.safeQuerySelector(iframe.contentDocument, selector);
      if (inputField) {
        usedSelector = selector;
        console.log(`CCPPP: 入力欄を取得しました (セレクタ: ${selector}):`, inputField);
        break;
      }
    }

    if (!inputField) {
      console.error("CCPPP: 入力欄が見つかりません");
      console.log("CCPPP: 試したセレクタ:", selectors);

      // デバッグ情報を出力
      if (iframe.contentDocument) {
        const inputPanel = Utils.safeQuerySelector(iframe.contentDocument, "#input-panel");
        console.log("CCPPP: #input-panel の存在:", !!inputPanel);
        const textInputRenderer = Utils.safeQuerySelector(iframe.contentDocument, "yt-live-chat-text-input-field-renderer");
        console.log("CCPPP: yt-live-chat-text-input-field-renderer の存在:", !!textInputRenderer);
        console.log("CCPPP: iframe URL:", iframe.contentWindow?.location?.href || "不明");
      }

      // リトライ回数をチェック
      if (data.setupRetryCount < this.maxSetupRetries) {
        data.setupRetryCount++;
        console.log(`CCPPP: ${this.retryDelay}ms 後にリトライします... (${data.setupRetryCount}/${this.maxSetupRetries})`);

        // リトライ（iframeの有効性を再確認）
        setTimeout(() => {
          console.log("CCPPP: リトライ中...");
          // iframeがまだ有効かチェック
          if (iframe && iframe.contentDocument) {
            this.setupPasteListener(iframe);
          } else {
            console.warn("CCPPP: リトライ時にiframeが無効になっています");
            data.setupRetryCount = 0; // カウンターをリセット
          }
        }, this.retryDelay);
      } else {
        console.warn(`CCPPP: 最大リトライ回数(${this.maxSetupRetries})に達しました。ペーストリスナーのセットアップを中止します。`);
        console.warn("CCPPP: emojiMap は利用可能ですが、ペースト機能は動作しません。");
        data.setupRetryCount = 0; // カウンターをリセット
      }
      return;
    }
    console.log("CCPPP: 入力欄を取得しました:", inputField);

    // 成功したのでリトライカウンターをリセット
    data.setupRetryCount = 0;

    // 既にリスナーが設定されているかチェック
    if (inputField._ccpppListenerAttached) {
      console.log("CCPPP: このinputFieldには既にリスナーが設定されています。スキップします。");
      return;
    }

    // 既存のリスナーを削除（念のため）
    if (inputField._ccpppPasteHandler) {
      inputField.removeEventListener("paste", inputField._ccpppPasteHandler, true);
      inputField.removeEventListener("paste", inputField._ccpppPasteHandler, false);
      console.log("CCPPP: 既存のペーストリスナーを削除しました");
    }

    // ペーストイベントハンドラーを作成
    const handler = (event) => {
      this.handlePaste(event, iframe);
    };

    // inputFieldに直接ハンドラーを保存
    inputField._ccpppPasteHandler = handler;
    inputField._ccpppListenerAttached = true;

    // キャプチャフェーズで処理（他のリスナーより先に実行）
    inputField.addEventListener("paste", handler, true);
    console.log("%cCCPPP: ペーストイベントリスナーを設定しました（キャプチャフェーズ）！", "color: green; font-weight: bold;");
    console.log("CCPPP: この入力欄にCtrl+Vでペーストすると、スタンプ変換が実行されます");
  },

  handlePaste(event, iframe) {
    console.log("%c━━━ CCPPP: handlePaste 開始 ━━━", "color: orange; font-weight: bold;");

    if (!this.enabled) {
      console.log("CCPPP: 機能が無効化されています");
      return;
    }

    // 処理中フラグをチェック（重複実行を防ぐ）
    if (this.isProcessing) {
      console.warn("%cCCPPP: 既に処理中です。このイベントをスキップします。", "color: red; font-weight: bold;");
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const data = this.iframeData.get(iframe);
    if (!data || !data.emojiMap) {
      console.warn("CCPPP: iframe データまたは emojiMap が見つかりません");
      return;
    }

    try {
      this.isProcessing = true;

      console.log("CCPPP: ペーストイベントを検出しました");

      // クリップボードからテキストを取得
      const pastedText = event.clipboardData?.getData("text");
      if (!pastedText) {
        console.log("CCPPP: クリップボードにテキストがありません");
        return;
      }

      console.log("CCPPP: ペーストされたテキスト:", pastedText);
      console.log("CCPPP: 現在のemojiMapサイズ:", data.emojiMap.size);

      // スタンプ名を検出（コロンなし、YouTubeの仕様に対応）
      // テキストを左から順番に走査して、最長一致でスタンプを検出
      const stampNames = Array.from(data.emojiMap.keys());

      // 長い名前から順にソート（最長一致を優先）
      stampNames.sort((a, b) => b.length - a.length);

      console.log("CCPPP: 登録されているスタンプ名の例:", stampNames.slice(0, 10));

      // テキストを解析してスタンプの位置を特定
      const tokens = []; // { type: 'text' | 'stamp', value: string, position: number }
      let currentPos = 0;

      while (currentPos < pastedText.length) {
        let matched = false;

        // 現在位置から最長一致するスタンプ名を探す
        for (const stampName of stampNames) {
          if (pastedText.substring(currentPos).startsWith(stampName)) {
            console.log(`CCPPP: ✓ 位置${currentPos}で "${stampName}" を検出`);
            tokens.push({ type: 'stamp', value: stampName, position: currentPos });
            currentPos += stampName.length;
            matched = true;
            break;
          }
        }

        // スタンプにマッチしなかった場合は、次の文字へ
        if (!matched) {
          // テキスト部分を収集
          let textStart = currentPos;
          currentPos++;

          // 次のスタンプまたは終端まで進む
          while (currentPos < pastedText.length) {
            let foundStamp = false;
            for (const stampName of stampNames) {
              if (pastedText.substring(currentPos).startsWith(stampName)) {
                foundStamp = true;
                break;
              }
            }
            if (foundStamp) break;
            currentPos++;
          }

          const textValue = pastedText.substring(textStart, currentPos);
          if (textValue) {
            tokens.push({ type: 'text', value: textValue, position: textStart });
          }
        }
      }

      console.log("CCPPP: 解析結果:", tokens);

      // スタンプが1つでも含まれている場合は、カスタム処理を実行
      const stampTokens = tokens.filter(t => t.type === 'stamp');

      if (stampTokens.length > 0) {
        console.log(`%cCCPPP: ${stampTokens.length} 個のスタンプを検出しました`, "color: green; font-weight: bold;", stampTokens.map(t => t.value));

        // デフォルトのペースト動作をキャンセル（最初に実行）
        event.preventDefault();
        event.stopPropagation();
        console.log("CCPPP: デフォルトのペースト動作をキャンセルしました");

        // トークンに基づいてスタンプとテキストを挿入
        this.insertTokens(tokens, iframe);
      } else {
        console.log("CCPPP: スタンプが見つからなかったため、通常のペーストを実行します");
      }
    } finally {
      // 処理完了後、フラグをクリア
      this.isProcessing = false;
    }
  },

  insertTokens(tokens, iframe) {
    console.log("CCPPP: insertTokens を開始します");
    console.log("CCPPP: トークン数:", tokens.length);
    console.log("CCPPP: トークン詳細:", tokens.map(t => `[${t.type}] "${t.value}"`).join(" → "));

    // iframe.contentDocument の有効性をチェック
    if (!iframe || !iframe.contentDocument) {
      console.error("CCPPP: iframe または iframe.contentDocument が無効です");
      return;
    }

    const inputPanel = Utils.safeQuerySelector(
      iframe.contentDocument,
      "#input-panel"
    );

    if (!inputPanel) {
      console.error("CCPPP: input-panelが見つかりません");
      return;
    }

    const categories = Utils.safeQuerySelector(
      inputPanel,
      "tp-yt-iron-pages #categories"
    );

    if (!categories) {
      console.error("CCPPP: カテゴリが見つかりません");
      return;
    }

    const inputField = Utils.safeQuerySelector(
      inputPanel,
      "yt-live-chat-text-input-field-renderer#input"
    );

    if (!inputField) {
      console.error("CCPPP: 入力欄が見つかりません");
      return;
    }

    console.log("CCPPP: 入力欄の現在の内容:", inputField.textContent);

    let insertCount = 0;
    let tokenIndex = 0;

    // トークンを順番に処理（insertTemplateと同じ方式）
    for (const token of tokens) {
      tokenIndex++;
      console.log(`%cCCPPP: [${tokenIndex}/${tokens.length}] 処理中: ${token.type} = "${token.value}"`, "color: purple;");

      if (token.type === 'text') {
        console.log(`CCPPP: テキストを挿入: "${token.value}"`);

        // insertTextメソッドを使用（insertTemplateと同じ）
        if (inputField.insertText) {
          inputField.insertText(token.value);
        } else {
          console.warn("CCPPP: insertTextメソッドが利用できません");
        }

        console.log(`CCPPP: テキスト挿入後の入力欄内容:`, inputField.textContent);
      } else if (token.type === 'stamp') {
        const emojiBtn = Utils.safeQuerySelector(categories, `[alt="${token.value}"]`);
        if (emojiBtn) {
          console.log(`%cCCPPP: スタンプをクリック: ${token.value}`, "color: blue; font-weight: bold;");

          // insertTemplateと同じ方式でクリック
          emojiBtn.click();

          insertCount++;
          console.log(`CCPPP: スタンプクリック完了後の入力欄内容:`, inputField.textContent);
        } else {
          console.warn(`CCPPP: スタンプボタンが見つかりません: ${token.value}`);
        }
      }
    }

    console.log(`%cCCPPP: 挿入処理完了！合計 ${insertCount} 個のスタンプをクリックしました`, "color: green; font-weight: bold;");
    console.log("CCPPP: 最終的な入力欄内容:", inputField.textContent);
  },

  insertEmojis(emojiNames, originalText, iframe) {
    console.log("CCPPP: insertEmojis を開始します");
    console.log("CCPPP: 挿入対象のテキスト:", originalText);
    console.log("CCPPP: 検出されたスタンプ名:", emojiNames);

    // iframe.contentDocument の有効性をチェック
    if (!iframe || !iframe.contentDocument) {
      console.error("CCPPP: iframe または iframe.contentDocument が無効です");
      return;
    }

    const categories = Utils.safeQuerySelector(
      iframe.contentDocument,
      "tp-yt-iron-pages #categories"
    );

    if (!categories) {
      console.error("CCPPP: カテゴリが見つかりません");
      return;
    }
    console.log("CCPPP: カテゴリ要素を取得しました");

    const inputField = Utils.safeQuerySelector(
      iframe.contentDocument,
      "yt-live-chat-text-input-field-renderer#input #input"
    );

    if (!inputField) {
      console.error("CCPPP: 入力欄が見つかりません");
      return;
    }
    console.log("CCPPP: 入力欄を取得しました");

    // スタンプ名が1つだけで、テキスト全体と完全一致する場合
    if (emojiNames.length === 1 && originalText === emojiNames[0]) {
      const emojiName = emojiNames[0];
      console.log(`CCPPP: テキスト全体がスタンプ名と一致: ${emojiName}`);

      const emojiBtn = Utils.safeQuerySelector(categories, `[alt="${emojiName}"]`);
      if (emojiBtn) {
        console.log(`%cCCPPP: スタンプをクリック: ${emojiName}`, "color: blue; font-weight: bold;");
        emojiBtn.click();
        console.log(`%cCCPPP: 挿入処理完了！1 個のスタンプをクリックしました`, "color: green; font-weight: bold;");
      } else {
        console.warn(`CCPPP: スタンプボタンが見つかりません: ${emojiName}`);
        // スタンプが見つからない場合は、元のテキストを挿入
        if (inputField.insertText) {
          inputField.insertText(originalText);
        } else {
          const textNode = iframe.contentDocument.createTextNode(originalText);
          inputField.appendChild(textNode);
        }
      }
      return;
    }

    // 複数のスタンプまたは混在テキストの場合
    // スタンプ名でテキストを分割して処理
    let remainingText = originalText;
    let insertCount = 0;

    // emojiNamesを出現順に処理するため、テキスト内の位置でソート
    const stampPositions = [];
    for (const stampName of emojiNames) {
      const index = remainingText.indexOf(stampName);
      if (index !== -1) {
        stampPositions.push({ name: stampName, index: index });
      }
    }
    stampPositions.sort((a, b) => a.index - b.index);

    console.log("CCPPP: スタンプの出現順:", stampPositions);

    let lastIndex = 0;
    for (const { name: emojiName, index } of stampPositions) {
      // スタンプの前のテキストを挿入
      if (index > lastIndex) {
        const textBefore = remainingText.slice(lastIndex, index);
        console.log(`CCPPP: テキストを挿入: "${textBefore}"`);
        if (inputField.insertText) {
          inputField.insertText(textBefore);
        } else {
          const textNode = iframe.contentDocument.createTextNode(textBefore);
          inputField.appendChild(textNode);
        }
      }

      // スタンプを挿入
      const emojiBtn = Utils.safeQuerySelector(categories, `[alt="${emojiName}"]`);
      if (emojiBtn) {
        console.log(`%cCCPPP: スタンプをクリック: ${emojiName}`, "color: blue; font-weight: bold;");
        emojiBtn.click();
        insertCount++;
        console.log(`CCPPP: スタンプクリック完了 (${insertCount}個目)`);
      } else {
        console.warn(`CCPPP: スタンプボタンが見つかりません: ${emojiName}`);
        // スタンプが見つからない場合は、元のテキストを挿入
        if (inputField.insertText) {
          inputField.insertText(emojiName);
        } else {
          const textNode = iframe.contentDocument.createTextNode(emojiName);
          inputField.appendChild(textNode);
        }
      }

      lastIndex = index + emojiName.length;
    }

    // 残りのテキストを挿入
    if (lastIndex < remainingText.length) {
      const textAfter = remainingText.slice(lastIndex);
      console.log(`CCPPP: 残りのテキストを挿入: "${textAfter}"`);
      if (inputField.insertText) {
        inputField.insertText(textAfter);
      } else {
        const textNode = iframe.contentDocument.createTextNode(textAfter);
        inputField.appendChild(textNode);
      }
    }

    console.log(`%cCCPPP: 挿入処理完了！合計 ${insertCount} 個のスタンプをクリックしました`, "color: green; font-weight: bold;");
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
  isSettingUpButtons: false, // Guard against concurrent setupChatButtons calls

  readChatInput(iframe) {
    const inputElement = Utils.safeQuerySelector(
      iframe.contentDocument,
      "yt-live-chat-text-input-field-renderer#input #input"
    );
    if (!inputElement) {
      console.warn("入力欄が見つかりません。");
      return null;
    }

    console.log("[ChatHelper] readChatInput: 入力欄の内容を読み取ります");
    console.log("[ChatHelper] readChatInput: childNodes の数:", inputElement.childNodes.length);

    const inputData = [];
    inputElement.childNodes.forEach((node, index) => {
      console.log(`[ChatHelper] readChatInput: ノード ${index}:`, {
        nodeType: node.nodeType,
        nodeName: node.nodeName,
        alt: node.alt,
        src: node.src,
        textContent: node.textContent?.substring(0, 50)
      });

      if (node.nodeType === 3) {
        // テキストノード
        const text = node.textContent.trim();
        if (text) {
          console.log(`[ChatHelper] readChatInput: テキスト追加: "${text}"`);
          inputData.push(text);
        }
      } else if (node.nodeType === 1 && node.alt) {
        // エレメントノードで alt 属性を持つもの（スタンプ）
        console.log(`[ChatHelper] readChatInput: スタンプ追加: alt="${node.alt}", src="${node.src}"`);
        inputData.push({ alt: node.alt, src: node.src });
      } else if (node.nodeType === 1) {
        // alt 属性を持たないエレメントノード - 内部を調査
        console.log(`[ChatHelper] readChatInput: alt なしのエレメント:`, node.nodeName);
        // img タグを探す
        if (node.nodeName === 'IMG') {
          console.log(`[ChatHelper] readChatInput: IMG タグだが alt がない:`, node);
        }
        // 子要素に img があるか確認
        const imgs = node.querySelectorAll ? node.querySelectorAll('img[alt]') : [];
        if (imgs.length > 0) {
          console.log(`[ChatHelper] readChatInput: 子要素に ${imgs.length} 個の img を発見`);
          imgs.forEach(img => {
            console.log(`[ChatHelper] readChatInput: 子要素のスタンプ追加: alt="${img.alt}", src="${img.src}"`);
            inputData.push({ alt: img.alt, src: img.src });
          });
        }
      }
    });

    console.log("[ChatHelper] readChatInput: 読み取り結果:", inputData);
    return inputData;
  },

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

  async setupChatButtons(iframe) {
    // Guard against concurrent calls
    if (this.isSettingUpButtons) {
      return;
    }

    try {
      this.isSettingUpButtons = true;
      this.currentIframe = iframe;

      if (!iframe.contentDocument) {
        return;
      }

      const emojiButton = Utils.safeQuerySelector(
        iframe.contentDocument,
        "#emoji-picker-button button, yt-live-chat-icon-toggle-button-renderer button"
      );
      if (!emojiButton) {
        return;
      }

      emojiButton.click();
      emojiButton.click();

      // スタンプピッカーが開いてスタンプが読み込まれるまで待つ
      await new Promise(resolve => setTimeout(resolve, 500));

      // すべてのカテゴリタブをクリックしてメンバーシップスタンプを含むすべてのスタンプをロード
      const categoryButtons = Utils.safeQuerySelectorAll(
        iframe.contentDocument,
        "yt-live-chat-emoji-picker-category-buttons button, #picker-tabs button"
      );

      if (categoryButtons.length > 0) {
        console.log(`[ChatHelper] setupChatButtons: ${categoryButtons.length} 個のカテゴリタブをクリックします`);
        for (let i = 0; i < categoryButtons.length; i++) {
          categoryButtons[i].click();
          await new Promise(resolve => setTimeout(resolve, 100)); // 各クリックの間に100ms待つ
        }
        // すべてのタブをクリックした後、少し待つ
        await new Promise(resolve => setTimeout(resolve, 300));
        console.log("[ChatHelper] setupChatButtons: すべてのカテゴリタブをクリックしました");
      }

      const chatContainer = Utils.safeQuerySelector(
        iframe.contentDocument,
        "#chat-messages #input-panel #container"
      );
      const chatContainerTop = Utils.safeQuerySelector(
        iframe.contentDocument,
        "#chat-messages #input-panel #container > #top"
      );
      if (!chatContainer) {
        return;
      }

      // Remove ALL existing wrappers (in case there are multiple)
      const existingWrappers = Utils.safeQuerySelectorAll(iframe.contentDocument, "#chat-helper-buttons");
      if (existingWrappers.length > 0) {
        existingWrappers.forEach(wrapper => wrapper.remove());
      }

      const buttonWrapper = document.createElement("div");
      buttonWrapper.id = "chat-helper-buttons";

      const channelInfo = Utils.getChannelInfo();
      const templates = await Storage.getTemplatesForChannel(channelInfo?.name);

      // チャンネルIDデバッグ表示
      console.log(`[CH_ID] ${channelInfo?.name || 'なし'} | G:${templates.global.length} C:${templates.channel.length}`);

      // グローバルテンプレートボタン
      templates.global.forEach((entry, idx) => {
        const btn = this.createTemplateButton(entry, idx, GLOBAL_CHANNEL_KEY, iframe, true);
        buttonWrapper.appendChild(btn);
      });

      // チャンネル別テンプレートボタン（チャンネル情報がある場合のみ）
      if (channelInfo && channelInfo.name) {
        templates.channel.forEach((entry, idx) => {
          const btn = this.createTemplateButton(entry, idx, channelInfo.name, iframe, false);
          buttonWrapper.appendChild(btn);
        });
      }

      // 保存ボタン（チャンネル用）
      const saveButton = this.createButton("save-channel-btn", "Save", () => {
        const data = this.readChatInput(iframe);
        if (data && data.length > 0) {
          const currentChannelInfo = Utils.getChannelInfo();
          Storage.saveTemplate(data, !currentChannelInfo || !currentChannelInfo.name).then(() => {
            this.setupChatButtons(iframe);
          });
        }
      }, "save-btn");
      buttonWrapper.appendChild(saveButton);

      chatContainerTop.insertAdjacentElement("afterend", buttonWrapper);

      // ドラッグ＆ドロップを設定
      this.setupButtonDragAndDrop(iframe);

      // スタンプが追加された後、CCPPPのemojiMapを再構築
      if (CCPPP.enabled) {
        console.log("[ChatHelper] setupChatButtons: CCPPPのemojiMapを再構築します");
        await new Promise(resolve => setTimeout(resolve, 500)); // スタンプが完全に読み込まれるまで待つ
        CCPPP.buildEmojiMap(iframe);
      }
    } finally {
      // Always clear the guard flag
      this.isSettingUpButtons = false;
      console.log("[ChatHelper] setupChatButtons: 完了（フラグをクリア）");
    }
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
          Storage.reorderTemplate(channelName, oldIndex, newIndex).then(() => {
            this.setupChatButtons(iframe);
          });
        }
      });
    });
  },

  // 別名入力ダイアログを表示
  showAliasInputDialog(event, template, channelName, index, iframe) {
    // テンプレートが存在しない場合は処理を中止
    if (!template) {
      console.error("CCPPP: テンプレートが見つかりません");
      return;
    }

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
    if (template && template.content) {
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
    }

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
        Storage.setAlias(channelName, index, aliasContent).then(() => {
          this.setupChatButtons(iframe);
        });
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

  async showContextMenu(event, channelName, index, iframe, isGlobal) {
    // 既存のメニューを削除（iframe内と親ドキュメント両方）
    const existingMenu = iframe.contentDocument.querySelector("#chat-helper-context-menu");
    if (existingMenu) existingMenu.remove();
    const existingMenuParent = document.querySelector("#chat-helper-context-menu");
    if (existingMenuParent) existingMenuParent.remove();

    // 現在のテンプレートを取得してエイリアスがあるか確認
    const data = await Storage.getData();
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
      const label = document.createTextNode("");
      originalItem.appendChild(label);

      // 元のコンテンツを表示（スタンプ絵文字含む）
      if (template && template.content) {
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
      }

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
      Storage.deleteTemplate(channelName, index).then(() => {
        this.setupChatButtons(iframe);
      });
      menu.remove();
    });

    // グローバル/ローカル切り替え
    menuItems[1].addEventListener("click", (e) => {
      e.stopPropagation();
      Storage.moveTemplate(channelName, index, !isGlobal).then(() => {
        this.setupChatButtons(iframe);
      });
      menu.remove();
    });

    // エイリアス設定/削除
    menuItems[2].addEventListener("click", (e) => {
      e.stopPropagation();
      menu.remove();

      if (hasAlias) {
        // エイリアスを削除
        Storage.removeAlias(channelName, index).then(() => {
          this.setupChatButtons(iframe);
        });
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

  async showSettingsUI() {
    if (this.managementModal) this.managementModal.remove();

    const modal = document.createElement("div");
    modal.id = "chat-helper-management-modal";
    this.managementModal = modal;

    const data = await Storage.getData();
    const channelInfo = Utils.getChannelInfo();
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
      const channel = data.channels.find(ch => ch.name === channelInfo.name);
      if (channel && channel.data.length > 0) {
        currentTab.innerHTML = `<h3>${channelInfo.name}</h3>` + this.renderTemplateList(channel.name, channel.data, false);
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
            Storage.reorderTemplate(draggedChannel, draggedIndex, actualNewIndex).then(() => {
              if (this.currentIframe) {
                this.setupChatButtons(this.currentIframe);
              }
              items.forEach((li, idx) => li.dataset.index = idx);
            });
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
          Storage.deleteTemplate(channel, index).then(() => {
            if (this.currentIframe) {
              this.setupChatButtons(this.currentIframe);
            }
            this.showSettingsUI();
          });
        }
      });
    });
  },

  addStyles(iframe) {
    // iframe.contentDocument が null の場合は早期リターン（クロスオリジンまたは未ロードの場合）
    if (!iframe || !iframe.contentDocument) {
      console.warn("iframe または iframe.contentDocument is null, skipping addStyles");
      return;
    }

    const styleId = "chat-helper-styles";
    // 再度チェック（非同期処理の間に無効になる可能性があるため）
    if (!iframe.contentDocument) {
      console.warn("iframe.contentDocument became null, skipping addStyles");
      return;
    }

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

    // 最終チェック: head にアクセスする前に contentDocument が有効か確認
    if (!iframe.contentDocument || !iframe.contentDocument.head) {
      console.warn("iframe.contentDocument または head が無効です, skipping appendChild");
      return;
    }

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

    // Holodex の multiview かどうかを判定
    const isHolodexMultiview = window.location.href.includes("holodex.net/multiview");
    const ccpppDelay = isHolodexMultiview ? 2000 : 500; // Holodex multiview の場合は長めに待つ

    setTimeout(() => {
      setTimeout(() => {
        this.loaded = true;

        // CCPPP初期化（スタンプ読み込み後）
        console.log(`StampLoader: CCPPP を ${ccpppDelay}ms 後に初期化します ${isHolodexMultiview ? '(Holodex multiview モード)' : ''}`);
        setTimeout(() => {
          CCPPP.init(iframe);
        }, ccpppDelay);
      }, 100);
    }, 1000);
  }
};

// メイン処理
const ChatHelper = {
  initialized: false,
  observer: null,
  currentChatFrame: null, // 現在のチャットフレームを追跡

  init() {
    // iframe内で実行されているかチェック
    const isInIframe = window.self !== window.top;
    const isYouTubeChatIframe = window.location.href.includes("youtube.com/live_chat");

    if (isInIframe && isYouTubeChatIframe) {
      // iframe内のYouTubeチャット - 直接初期化
      this.initializeCurrentFrame();
      return;
    }

    // 通常のページ（YouTube/Holodex）
    UI.addMainPageStyles();
    this.observeDOM();
    this.checkForChatFrame();

    // 設定変更を監視
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

    // 親ページから初期化されるのを少し待つ（all_frames:true のため、親ページと iframe 内の両方で実行される）
    console.log("[ChatHelper] iframe内で実行中。親ページからの初期化を確認します...");
    setTimeout(() => {
      // 既にボタンが存在するかチェック（親ページから初期化済み）
      const existingButtons = document.querySelector("#chat-helper-buttons");
      if (existingButtons) {
        console.log("[ChatHelper] 親ページから既に初期化されています。自己初期化をスキップします。");
        // ただし、CCPPPが未初期化の場合は初期化する
        if (CCPPP.enabled && !CCPPP.iframeData.has(pseudoIframe)) {
          console.log("[ChatHelper] CCPPPを初期化します（iframe内）");
          // スタンプが読み込まれるまで待つ
          setTimeout(() => {
            CCPPP.init(pseudoIframe);
          }, 1500);
        }
        return;
      }

      console.log("[ChatHelper] 親ページから初期化されていません。自己初期化を開始します。");
      try {
        UI.addStyles(pseudoIframe);
        UI.setupChatButtons(pseudoIframe);
        StampLoader.autoLoadStamps(pseudoIframe);

        // 設定変更を監視
        Settings.listenForChanges((newSettings) => {
          CCPPP.enabled = newSettings.ccpppEnabled;

          if (newSettings.ccpppEnabled) {
            CCPPP.init(pseudoIframe);
          }
        });
      } catch (e) {
        console.error("[ChatHelper] 初期化エラー:", e);
      }
    }, 1000); // 1秒待つ
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
    if (!chatFrame) {
      // iframe が消えた場合、状態をリセット
      if (this.currentChatFrame) {
        console.log("[ChatHelper] チャットフレームが消えました。状態をリセットします。");
        this.currentChatFrame = null;
        this.initialized = false;
        StampLoader.loaded = false;
        UI.isSettingUpButtons = false;
      }
      return;
    }

    // iframe が新しくなった場合（再生成された場合）
    if (this.currentChatFrame && this.currentChatFrame !== chatFrame) {
      console.log("[ChatHelper] チャットフレームが再生成されました。状態をリセットします。");
      this.initialized = false;
      StampLoader.loaded = false;
      UI.isSettingUpButtons = false;
      this.currentChatFrame = null;
      // 古いiframeのフラグは無効なので、新しいiframeには設定されていない
    }

    // 現在のフレームを記録
    if (!this.currentChatFrame) {
      console.log("[ChatHelper] 新しいチャットフレームを検出しました。");
      this.currentChatFrame = chatFrame;
    }

    // iframe要素に直接フラグをチェック（最も信頼できる方法）
    if (chatFrame.dataset.chatHelperInitialized === "true") {
      console.log("[ChatHelper] このiframeは既に初期化済みです。スキップします。");
      return; // 既に初期化済み
    }

    if (!chatFrame.dataset.chatHelperListenerAdded) {
      chatFrame.addEventListener("load", () => {
        console.log("[ChatHelper] iframeがリロードされました。再初期化します。");
        // リロード時にフラグをクリア
        delete chatFrame.dataset.chatHelperInitialized;
        this.initialized = false;
        StampLoader.loaded = false;
        UI.isSettingUpButtons = false;
        this.initializeFrame(chatFrame);
      });
      chatFrame.dataset.chatHelperListenerAdded = "true";
    }

    try {
      if (chatFrame.contentDocument?.readyState === "complete") {
        console.log("[ChatHelper] iframeの準備ができました。初期化を開始します。");
        this.initializeFrame(chatFrame);
      }
    } catch (e) {
      // クロスオリジンの場合、loadイベントを待つ
      console.log("チャットフレームのloadイベントを待機中...");
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
          // エラーを無視（クロスオリジンの場合）
          console.warn("iframe.src にアクセスできません（クロスオリジン）:", e);
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
          console.warn("iframe.src にアクセスできません（クロスオリジン）:", e);
        }
      }
    }

    if (chatFrames.length === 0) {
      return;
    }
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

      if (iframe.dataset) {
        iframe.dataset.chatHelperInitialized = "true";
      }

      return true;
    } catch (e) {
      console.error("initializeFrame: 初期化中にエラーが発生:", e);
      this.initialized = false;
      return false;
    }
  }
};

// 初期化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => ChatHelper.init());
} else {
  ChatHelper.init();
}

// グローバルユーティリティ関数（コンソールから実行可能）
window.ChatHelperUtils = {
  // 保存されているすべてのテンプレートを削除
  async clearAllTemplates() {
    try {
      await ChromeStorageHelper.set(STORAGE_KEY, { channels: [], global: [] });
      console.log("%c[ChatHelper] すべてのテンプレートを削除しました", "color: green; font-weight: bold;");
      console.log("[ChatHelper] ページをリロードしてください (F5)");
      return true;
    } catch (e) {
      console.error("[ChatHelper] テンプレートの削除に失敗:", e);
      return false;
    }
  },

  // 保存されているデータを表示
  async showAllTemplates() {
    try {
      const data = await ChromeStorageHelper.get(STORAGE_KEY);
      console.log("%c[ChatHelper] 保存されているテンプレート:", "color: blue; font-weight: bold;");
      console.log("");
      console.log("グローバル:", data?.global || []);
      console.log("");
      console.log("チャンネル別:");
      if (data?.channels && data.channels.length > 0) {
        data.channels.forEach((ch, index) => {
          console.log(`  ${index + 1}. ${ch.name}`);
          console.log(`     エイリアス: ${ch.aliases ? ch.aliases.join(', ') : ch.name}`);
          console.log(`     テンプレート数: ${ch.data.length}`);
          console.log(`     URL: ${ch.href}`);
        });
      } else {
        console.log("  (なし)");
      }
      return data;
    } catch (e) {
      console.error("[ChatHelper] テンプレートの取得に失敗:", e);
      return null;
    }
  },

  // 特定のチャンネルのテンプレートを削除
  async clearChannelTemplates(channelName) {
    try {
      const data = await ChromeStorageHelper.get(STORAGE_KEY) || { channels: [], global: [] };
      // エイリアスシステム対応
      const index = data.channels.findIndex(ch => {
        if (!ch.aliases) ch.aliases = [ch.name];
        return ch.aliases.includes(channelName);
      });
      if (index !== -1) {
        const channel = data.channels[index];
        console.log(`%c[ChatHelper] チャンネル "${channelName}" のテンプレートを削除しました`, "color: green; font-weight: bold;");
        console.log(`  エイリアス: ${channel.aliases.join(', ')}`);
        data.channels.splice(index, 1);
        await ChromeStorageHelper.set(STORAGE_KEY, data);
        console.log("[ChatHelper] ページをリロードしてください (F5)");
        return true;
      } else {
        console.warn(`[ChatHelper] チャンネル "${channelName}" が見つかりません`);
        return false;
      }
    } catch (e) {
      console.error("[ChatHelper] テンプレートの削除に失敗:", e);
      return false;
    }
  },

  // グローバルテンプレートを削除
  async clearGlobalTemplates() {
    try {
      const data = await ChromeStorageHelper.get(STORAGE_KEY) || { channels: [], global: [] };
      data.global = [];
      await ChromeStorageHelper.set(STORAGE_KEY, data);
      console.log("%c[ChatHelper] グローバルテンプレートを削除しました", "color: green; font-weight: bold;");
      console.log("[ChatHelper] ページをリロードしてください (F5)");
      return true;
    } catch (e) {
      console.error("[ChatHelper] テンプレートの削除に失敗:", e);
      return false;
    }
  },

  // チャンネル情報の取得方法をデバッグ表示
  debugChannelInfo() {
    console.log("%c[ChatHelper] チャンネル情報の取得方法をデバッグします", "color: orange; font-weight: bold; font-size: 14px;");
    console.log("");

    const results = [];
    const isInIframe = window.self !== window.top;
    const isYouTubeChatIframe = window.location.href.includes("youtube.com/live_chat");

    console.log("環境情報:");
    console.log("  isInIframe:", isInIframe);
    console.log("  isYouTubeChatIframe:", isYouTubeChatIframe);
    console.log("  現在のURL:", window.location.href);
    console.log("  リファラー:", document.referrer);
    console.log("");

    // チャンネルIDを取得できるDOM要素を探す
    console.log("%cチャンネルID取得の試行:", "color: magenta; font-weight: bold;");
    const channelIdSelectors = [
      { name: "channel link href", selector: "a[href*='/channel/']", attr: "href" },
      { name: "channel link @", selector: "a[href*='/@']", attr: "href" },
      { name: "yt-live-chat-header owner", selector: "yt-live-chat-header-renderer a[href*='/channel/'], yt-live-chat-header-renderer a[href*='/@']", attr: "href" },
      { name: "author-photo", selector: "#author-photo a", attr: "href" },
      { name: "chat-header a", selector: "yt-live-chat-header-renderer a", attr: "href" }
    ];

    let channelIdFromDOM = null;
    let channelHandleFromDOM = null;
    for (const {name, selector, attr} of channelIdSelectors) {
      const element = document.querySelector(selector);
      console.log(`  ${name}: ${selector}`);
      if (element) {
        const value = element[attr];
        console.log(`    見つかった: ${value}`);

        // /channel/UC... 形式から抽出
        const channelMatch = value?.match(/\/channel\/(UC[^/?]+)/);
        if (channelMatch) {
          channelIdFromDOM = channelMatch[1];
          console.log(`    ✓ チャンネルID抽出成功: ${channelIdFromDOM}`);
          results.push({
            方法: "DOM - チャンネルID",
            セレクタ: name,
            成功: "○",
            取得値: channelIdFromDOM,
            形式: "UC..."
          });
          break;
        }

        // /@username 形式
        const handleMatch = value?.match(/\/@([^/?]+)/);
        if (handleMatch && !channelHandleFromDOM) {
          channelHandleFromDOM = handleMatch[1];
          console.log(`    △ ハンドル取得: @${channelHandleFromDOM} (チャンネルIDではない)`);
        }
      } else {
        console.log(`    見つからない`);
      }
    }

    if (channelIdFromDOM) {
      console.log(`  ✓ 最終結果: チャンネルID = ${channelIdFromDOM}`);
    } else if (channelHandleFromDOM) {
      console.log(`  △ 最終結果: ハンドル = @${channelHandleFromDOM} (チャンネルIDは取得できず)`);
      results.push({
        方法: "DOM - ハンドル",
        セレクタ: "a[href*='/@']",
        成功: "△",
        取得値: `@${channelHandleFromDOM}`,
        形式: "@username"
      });
    } else {
      console.log("  ✗ チャンネルIDを取得できませんでした");
      results.push({
        方法: "DOM - チャンネルID",
        セレクタ: "すべて失敗",
        成功: "×",
        取得値: "",
        形式: ""
      });
    }
    console.log("");

    // 方法1: チャンネル名の要素から取得
    console.log("%c方法1: DOMからチャンネル名を取得", "color: cyan; font-weight: bold;");
    const channelSelectors = [
      "yt-live-chat-header-renderer #channel-name a",
      "yt-live-chat-header-renderer yt-formatted-string a",
      "#author-name a",
      "yt-live-chat-header-renderer #chat-header-text a",
      "#channel-name yt-formatted-string a",
      "a[href*='/channel/']",
      "a[href*='/@']"
    ];

    let method1Success = false;
    for (const selector of channelSelectors) {
      const element = document.querySelector(selector);
      console.log(`  セレクタ: ${selector}`);
      console.log(`    要素: ${element ? '見つかった' : '見つからない'}`);
      if (element) {
        console.log(`    innerText: "${element.innerText?.trim() || '(空)'}"`);
        console.log(`    href: "${element.href || '(なし)'}"`);

        if (element.innerText && element.innerText.trim()) {
          results.push({
            方法: "方法1 - DOM",
            セレクタ: selector,
            成功: "○",
            チャンネル名: element.innerText.trim(),
            URL: element.href || ""
          });
          method1Success = true;
          break;
        }
      }
    }
    if (!method1Success) {
      results.push({
        方法: "方法1 - DOM",
        セレクタ: "すべて失敗",
        成功: "×",
        チャンネル名: "",
        URL: ""
      });
    }
    console.log("");

    // 方法2: iframe URLから動画IDを取得
    console.log("%c方法2: iframe URLから動画IDを取得", "color: cyan; font-weight: bold;");
    const urlParams = new URLSearchParams(window.location.search);
    const iframeVideoId = urlParams.get('v');
    console.log("  iframe URLの v パラメータ:", iframeVideoId || "(なし)");

    if (iframeVideoId) {
      results.push({
        方法: "方法2 - iframe URL",
        セレクタ: "URLパラメータ v",
        成功: "○",
        チャンネル名: `Video_${iframeVideoId}`,
        URL: `https://www.youtube.com/watch?v=${iframeVideoId}`
      });
    } else {
      results.push({
        方法: "方法2 - iframe URL",
        セレクタ: "URLパラメータ v",
        成功: "×",
        チャンネル名: "",
        URL: ""
      });
    }
    console.log("");

    // 方法3: 親URLから動画IDを取得
    console.log("%c方法3: 親URL (referrer) から動画IDを取得", "color: cyan; font-weight: bold;");
    const parentUrl = document.referrer;
    console.log("  親URL:", parentUrl || "(なし)");

    if (parentUrl) {
      // YouTube URL
      const youtubeMatch = parentUrl.match(/[?&]v=([^&]+)/);
      if (youtubeMatch) {
        const parentVideoId = youtubeMatch[1];
        console.log("  YouTube動画ID:", parentVideoId);
        results.push({
          方法: "方法3 - 親URL (YouTube)",
          セレクタ: "referrer の v パラメータ",
          成功: "○",
          チャンネル名: `Video_${parentVideoId}`,
          URL: `https://www.youtube.com/watch?v=${parentVideoId}`
        });
      } else {
        console.log("  YouTube動画ID: (見つからない)");
        results.push({
          方法: "方法3 - 親URL (YouTube)",
          セレクタ: "referrer の v パラメータ",
          成功: "×",
          チャンネル名: "",
          URL: ""
        });
      }

      // Holodex URL
      if (parentUrl.includes("holodex.net")) {
        const holodexMatch = parentUrl.match(/holodex\.net\/watch\/([^/?]+)/);
        if (holodexMatch) {
          const holodexVideoId = holodexMatch[1];
          console.log("  Holodex動画ID:", holodexVideoId);
          results.push({
            方法: "方法3 - 親URL (Holodex特定)",
            セレクタ: "holodex.net/watch/ID",
            成功: "○",
            チャンネル名: `Holodex_${holodexVideoId}`,
            URL: parentUrl
          });
        } else {
          console.log("  Holodex動画ID: (見つからない、汎用名使用)");
          results.push({
            方法: "方法3 - 親URL (Holodex汎用)",
            セレクタ: "holodex.net (汎用)",
            成功: "△",
            チャンネル名: "Holodex_Chat",
            URL: parentUrl
          });
        }
      }
    } else {
      results.push({
        方法: "方法3 - 親URL",
        セレクタ: "referrer",
        成功: "×",
        チャンネル名: "",
        URL: ""
      });
    }
    console.log("");

    // 現在の getChannelInfo() の結果
    console.log("%c現在の getChannelInfo() の戻り値:", "color: lime; font-weight: bold;");
    const currentResult = Utils.getChannelInfo();
    console.log(currentResult);
    console.log("");

    // テーブル形式で結果を表示
    console.log("%c全方法の結果まとめ:", "color: yellow; font-weight: bold; font-size: 14px;");
    console.table(results);

    console.log("");
    console.log("%c重要な違い:", "color: red; font-weight: bold; font-size: 14px;");
    console.log("動画ID (Video ID): 個別の配信/動画を識別 (例: 6x6cYaz1kmE)");
    console.log("チャンネルID (Channel ID): チャンネルを識別 (例: UC... 形式)");
    console.log("");
    console.log("%c現在の動作:", "color: yellow; font-weight: bold;");
    console.log("✓ 動画ID: YouTube/Holodex両方で取得可能（統一済み）");
    console.log("? チャンネルID: DOMから取得できるか環境依存");
    console.log("");
    console.log("%cチャンネルIDの取得方法:", "color: cyan; font-weight: bold;");
    console.log("方法A: DOMから抽出（上記で試行済み）");
    console.log("  ✓ API不要、軽量");
    console.log("  × 環境により要素が存在しない可能性");
    console.log("");
    console.log("方法B: 動画IDからYouTube Data APIで取得");
    console.log("  ✓ 確実に取得可能");
    console.log("  × APIキーが必要、リクエスト制限あり");
    console.log("  例: https://www.googleapis.com/youtube/v3/videos?id={videoId}&key={apiKey}&part=snippet");
    console.log("");
    console.log("%c推奨:", "color: orange; font-weight: bold;");
    console.log("1. まずDOMからチャンネルIDが取得できるか確認（上記結果を参照）");
    console.log("2. YouTube/Holodex両方でチャンネルIDが取得できれば、それを使用");
    console.log("3. 取得できない場合は、動画ID使用 or YouTube Data API実装を検討");

    return results;
  },

  // ヘルプを表示
  help() {
    console.log("%c[ChatHelper] 利用可能なコマンド:", "color: blue; font-weight: bold; font-size: 14px;");
    console.log("  ChatHelperUtils.clearAllTemplates()      - すべてのテンプレートを削除");
    console.log("  ChatHelperUtils.clearGlobalTemplates()   - グローバルテンプレートのみ削除");
    console.log("  ChatHelperUtils.clearChannelTemplates('チャンネル名') - 特定チャンネルのテンプレートを削除");
    console.log("  ChatHelperUtils.showAllTemplates()       - 保存されているテンプレートを表示");
    console.log("  ChatHelperUtils.debugChannelInfo()       - チャンネル情報の取得方法をデバッグ");
    console.log("  ChatHelperUtils.help()                   - このヘルプを表示");
    console.log("");
    console.log("%c使用例:", "color: green; font-weight: bold;");
    console.log("  ChatHelperUtils.clearAllTemplates()");
    console.log("  ChatHelperUtils.clearChannelTemplates('Video_6x6cYaz1kmE')");
    console.log("  ChatHelperUtils.debugChannelInfo()");
  }
};

// 初回ヘルプメッセージ
console.log("%c[ChatHelper] ロードされました。使い方: ChatHelperUtils.help()", "color: blue; font-weight: bold;");
