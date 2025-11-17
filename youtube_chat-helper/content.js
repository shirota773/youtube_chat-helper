// Content script - runs in extension context
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
