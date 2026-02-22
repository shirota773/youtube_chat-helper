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

    // 設定をページに注入
    function injectSettings(settings) {
        const script = document.createElement("script");
        script.textContent = `window.__CHAT_HELPER_SETTINGS__ = ${JSON.stringify(settings)};`;
        document.documentElement.appendChild(script);
        script.remove();
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
            notifySettingsChange(newSettings);
        }
    });

    // 診断メッセージのハンドリング（popup.js からのリクエストを inject.js に転送）
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "runDiagnostics") {
            // live_chat iframe または メインフレームのみ応答
            const isChatFrame = window.location.href.includes("youtube.com/live_chat");
            const isMainFrame = window.self === window.top;
            if (!isChatFrame && !isMainFrame) return false;

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
            const isMainFrame = window.self === window.top;
            if (!isChatFrame && !isMainFrame) return false;

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
