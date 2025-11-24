// Content script - runs in extension context
const SETTINGS_KEY = "chatHelperSettings";

const defaultSettings = {
    ccpppEnabled: true,
    autoLoadStamps: true
};

// 設定をページに注入（postMessageを使用）
function injectSettings(settings) {
    window.postMessage({
        source: "chat-helper-content",
        type: "settings-init",
        settings: settings
    }, "*");
}

// メインスクリプトを注入
function injectScript(file) {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(file);
    script.onload = () => script.remove();
    document.documentElement.appendChild(script);
}

// 設定変更をページに通知
function notifySettingsChange(settings) {
    window.postMessage({
        source: "chat-helper-content",
        type: "settings-changed",
        settings: settings
    }, "*");
}

// 初期化
chrome.storage.local.get(SETTINGS_KEY, (result) => {
    const settings = { ...defaultSettings, ...result[SETTINGS_KEY] };

    // メインスクリプトを先に注入
    injectScript("inject.js");

    // スクリプト読み込み後に設定を送信
    setTimeout(() => {
        injectSettings(settings);
    }, 100);
});

// 設定変更を監視
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SETTINGS_KEY]) {
        const newSettings = { ...defaultSettings, ...changes[SETTINGS_KEY].newValue };
        notifySettingsChange(newSettings);
    }
});

// ストレージ用のメッセージリスナー（inject.jsからのメッセージを処理）
window.addEventListener("message", (event) => {
    // 同じウィンドウからのメッセージのみ処理
    if (event.source !== window) return;

    const message = event.data;

    // ChatHelperのメッセージのみ処理
    if (!message || message.source !== "chat-helper-page") return;

    console.log("[Content] メッセージを受信:", message.type);

    // 設定の保存
    if (message.type === "settings-save") {
        const dataToSave = {};
        dataToSave[SETTINGS_KEY] = message.settings;
        chrome.storage.local.set(dataToSave, () => {
            console.log("[Content] 設定を保存しました:", message.settings);
        });
        return;
    }

    // ストレージGET
    if (message.type === "storage-get") {
        console.log("[Content] ストレージGETリクエスト:", message.key, message.requestId);
        try {
            chrome.storage.local.get(message.key, (result) => {
                if (chrome.runtime.lastError) {
                    console.error("[Content] ストレージGETエラー:", chrome.runtime.lastError);
                    window.postMessage({
                        source: "chat-helper-content",
                        type: "storage-get-response",
                        requestId: message.requestId,
                        data: null,
                        error: chrome.runtime.lastError.message
                    }, "*");
                    return;
                }
                console.log("[Content] ストレージGET結果:", message.key, result);
                window.postMessage({
                    source: "chat-helper-content",
                    type: "storage-get-response",
                    requestId: message.requestId,
                    data: result[message.key]
                }, "*");
            });
        } catch (e) {
            console.error("[Content] 拡張機能コンテキストが無効化されました:", e);
            window.postMessage({
                source: "chat-helper-content",
                type: "storage-get-response",
                requestId: message.requestId,
                data: null,
                error: "Extension context invalidated. Please reload the page."
            }, "*");
        }
        return;
    }

    // ストレージSET
    if (message.type === "storage-set") {
        console.log("[Content] ストレージSETリクエスト:", message.key);
        try {
            const dataToSave = {};
            dataToSave[message.key] = message.value;
            chrome.storage.local.set(dataToSave, () => {
                const success = !chrome.runtime.lastError;
                console.log("[Content] ストレージSET結果:", success, chrome.runtime.lastError?.message);
                window.postMessage({
                    source: "chat-helper-content",
                    type: "storage-set-response",
                    requestId: message.requestId,
                    success: success,
                    error: chrome.runtime.lastError?.message
                }, "*");
            });
        } catch (e) {
            console.error("[Content] 拡張機能コンテキストが無効化されました:", e);
            window.postMessage({
                source: "chat-helper-content",
                type: "storage-set-response",
                requestId: message.requestId,
                success: false,
                error: "Extension context invalidated. Please reload the page."
            }, "*");
        }
        return;
    }
});
