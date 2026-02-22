// Content script - runs in extension context
// IIFE + 二重注入ガード（拡張機能更新時の動的注入対策）
(() => {
    if (window.__CHAT_HELPER_CONTENT_LOADED__) return;
    window.__CHAT_HELPER_CONTENT_LOADED__ = true;

    const SETTINGS_KEY = "chatHelperSettings";

    const defaultSettings = {
        ccpppEnabled: true,
        autoLoadStamps: true
    };

    function getRootElement() {
        return document.documentElement || document.head || document.body;
    }

    // 設定をDOM属性として共有（CSPでブロックされるinline scriptを使わない）
    function injectSettings(settings) {
        const root = getRootElement();
        if (!root) return;
        root.setAttribute("data-chat-helper-settings", JSON.stringify(settings));
    }

    // メインスクリプトを注入
    function injectScript(file) {
        const root = getRootElement();
        if (!root) return;
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL(file);
        script.onload = () => script.remove();
        root.appendChild(script);
    }

    // 設定変更をページに通知
    function notifySettingsChange(settings) {
        const event = new CustomEvent("chatHelperSettingsChanged", {
            detail: settings
        });
        window.dispatchEvent(event);
    }

    // 初期化
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
        const settings = { ...defaultSettings, ...result[SETTINGS_KEY] };

        // 設定を先に注入
        injectSettings(settings);

        // メインスクリプトを注入
        injectScript("inject.js");
    });

    // 設定変更を監視
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === "local" && changes[SETTINGS_KEY]) {
            const newSettings = { ...defaultSettings, ...changes[SETTINGS_KEY].newValue };
            injectSettings(newSettings);
            notifySettingsChange(newSettings);
        }
    });

    // 診断メッセージのハンドリング（popup.js からのリクエストを inject.js に転送）
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "runDiagnostics") {
            // 診断は live_chat iframe のみ応答（複数フレーム時の結果ぶれ防止）
            const isChatFrame = window.location.href.includes("youtube.com/live_chat");
            if (!isChatFrame) return false;

            const handler = (e) => {
                clearTimeout(timeoutId);
                sendResponse(e.detail);
            };
            window.addEventListener("chatHelperDiagnosticsResult", handler, { once: true });
            window.dispatchEvent(new CustomEvent("chatHelperRunDiagnostics"));

            const timeoutId = setTimeout(() => {
                window.removeEventListener("chatHelperDiagnosticsResult", handler);
                sendResponse({ error: "inject.jsからの応答なし" });
            }, 5000);

            return true; // 非同期レスポンス
        }

        if (message.type === "runChannelDetection") {
            const isChatFrame = window.location.href.includes("youtube.com/live_chat");
            if (!isChatFrame) return false;

            const handler = (e) => {
                clearTimeout(timeoutId);
                sendResponse(e.detail);
            };
            window.addEventListener("chatHelperChannelDetectionResult", handler, { once: true });
            window.dispatchEvent(new CustomEvent("chatHelperRunChannelDetection"));

            const timeoutId = setTimeout(() => {
                window.removeEventListener("chatHelperChannelDetectionResult", handler);
                sendResponse({ error: "タイムアウト" });
            }, 15000);

            return true;
        }
    });
})();
