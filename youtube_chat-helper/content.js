// Content script - runs in extension context
const SETTINGS_KEY = "chatHelperSettings";

const defaultSettings = {
    ccpppEnabled: true,
    autoLoadStamps: true
};

// 設定をページに注入（DOM属性を使用してCSP違反を回避）
function injectSettings(settings) {
    const settingsElement = document.createElement("div");
    settingsElement.id = "__chat_helper_settings__";
    settingsElement.style.display = "none";
    settingsElement.setAttribute("data-settings", JSON.stringify(settings));
    document.documentElement.appendChild(settingsElement);
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
