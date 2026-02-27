// Popup script for YouTube Chat Helper
const SETTINGS_KEY = "chatHelperSettings";

const defaultSettings = {
    ccpppEnabled: true,
    autoLoadStamps: true,
    hideEmojiCategoryTitles: false,
    hideEmojiSearch: false,
    hideChatTopBanner: false,
    customInputPanelPosition: true,
    chatPanelPagesWidth: "var(--my-chat-panel-pages-width)",
    chatPanelPagesHeight: "var(--my-chat-panel-pages-height)",
    chatPanelPagesMaxHeight: "initial",
    chatPanelPagesMaxWidth: "450px",
    chatPanelPagesMinWidth: "300px",
    chatPanelPagesRight: "0",
    chatPanelPagesLeft: ""
};

// 設定を読み込み
function loadSettings() {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
        const settings = { ...defaultSettings, ...result[SETTINGS_KEY] };

        document.getElementById("ccppp-toggle").checked = settings.ccpppEnabled;
        document.getElementById("autoload-toggle").checked = settings.autoLoadStamps;
        document.getElementById("hide-emoji-titles-toggle").checked = settings.hideEmojiCategoryTitles;
        document.getElementById("hide-emoji-search-toggle").checked = settings.hideEmojiSearch;
        document.getElementById("hide-chat-header-toggle").checked = settings.hideChatTopBanner;
        document.getElementById("panel-position-toggle").checked = settings.customInputPanelPosition;
        document.getElementById("panel-pages-width").value = settings.chatPanelPagesWidth;
        document.getElementById("panel-pages-height").value = settings.chatPanelPagesHeight;
        document.getElementById("panel-pages-max-height").value = settings.chatPanelPagesMaxHeight;
        document.getElementById("panel-pages-max-width").value = settings.chatPanelPagesMaxWidth;
        document.getElementById("panel-pages-min-width").value = settings.chatPanelPagesMinWidth;
        document.getElementById("panel-pages-right").value = settings.chatPanelPagesRight;
        document.getElementById("panel-pages-left").value = settings.chatPanelPagesLeft;
    });
}

// 設定を保存
function saveSettings() {
    const settings = {
        ccpppEnabled: document.getElementById("ccppp-toggle").checked,
        autoLoadStamps: document.getElementById("autoload-toggle").checked,
        hideEmojiCategoryTitles: document.getElementById("hide-emoji-titles-toggle").checked,
        hideEmojiSearch: document.getElementById("hide-emoji-search-toggle").checked,
        hideChatTopBanner: document.getElementById("hide-chat-header-toggle").checked,
        customInputPanelPosition: document.getElementById("panel-position-toggle").checked,
        chatPanelPagesWidth: document.getElementById("panel-pages-width").value.trim() || defaultSettings.chatPanelPagesWidth,
        chatPanelPagesHeight: document.getElementById("panel-pages-height").value.trim() || defaultSettings.chatPanelPagesHeight,
        chatPanelPagesMaxHeight: document.getElementById("panel-pages-max-height").value.trim() || defaultSettings.chatPanelPagesMaxHeight,
        chatPanelPagesMaxWidth: document.getElementById("panel-pages-max-width").value.trim() || defaultSettings.chatPanelPagesMaxWidth,
        chatPanelPagesMinWidth: document.getElementById("panel-pages-min-width").value.trim() || defaultSettings.chatPanelPagesMinWidth,
        chatPanelPagesRight: document.getElementById("panel-pages-right").value.trim() || defaultSettings.chatPanelPagesRight,
        chatPanelPagesLeft: document.getElementById("panel-pages-left").value.trim()
    };

    chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
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
    document.getElementById("hide-emoji-titles-toggle").addEventListener("change", saveSettings);
    document.getElementById("hide-emoji-search-toggle").addEventListener("change", saveSettings);
    document.getElementById("hide-chat-header-toggle").addEventListener("change", saveSettings);
    document.getElementById("panel-position-toggle").addEventListener("change", saveSettings);

    [
        "panel-pages-width",
        "panel-pages-height",
        "panel-pages-max-height",
        "panel-pages-max-width",
        "panel-pages-min-width",
        "panel-pages-right",
        "panel-pages-left"
    ].forEach((id) => {
        document.getElementById(id).addEventListener("change", saveSettings);
    });
});
