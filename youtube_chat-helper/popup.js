// Popup script for YouTube Chat Helper
const SETTINGS_KEY = "chatHelperSettings";

const defaultSettings = {
    ccpppEnabled: true,
    autoLoadStamps: true
};

// 設定を読み込み
function loadSettings() {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
        const settings = { ...defaultSettings, ...result[SETTINGS_KEY] };

        document.getElementById("ccppp-toggle").checked = settings.ccpppEnabled;
        document.getElementById("autoload-toggle").checked = settings.autoLoadStamps;
    });
}

// 設定を保存
function saveSettings() {
    const settings = {
        ccpppEnabled: document.getElementById("ccppp-toggle").checked,
        autoLoadStamps: document.getElementById("autoload-toggle").checked
    };

    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
        // 保存完了メッセージ表示
        const status = document.getElementById("status");
        status.style.display = "block";
        setTimeout(() => {
            status.style.display = "none";
        }, 1500);
    });
}

// イベントリスナー設定
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();

    document.getElementById("ccppp-toggle").addEventListener("change", saveSettings);
    document.getElementById("autoload-toggle").addEventListener("change", saveSettings);
});
