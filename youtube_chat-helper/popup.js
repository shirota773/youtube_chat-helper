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
        const status = document.getElementById("status");
        status.style.display = "block";
        setTimeout(() => {
            status.style.display = "none";
        }, 1500);
    });
}

// --- 診断ツール ---

// アクティブタブにメッセージを送信（接続失敗時はコンテンツスクリプトを動的注入してリトライ）
async function sendToActiveTab(message) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error("アクティブタブが見つかりません");

    try {
        return await chrome.tabs.sendMessage(tab.id, message);
    } catch (e) {
        if (!e.message?.includes("Could not establish connection")) throw e;

        // コンテンツスクリプトが未注入 → 動的に注入してリトライ
        await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: ["content.js"]
        });
        // inject.js の初期化を待つ
        await new Promise(r => setTimeout(r, 1500));
        return await chrome.tabs.sendMessage(tab.id, message);
    }
}

// 診断結果の表示エリア
function getResultEl() {
    const el = document.getElementById("diag-result");
    el.style.display = "block";
    return el;
}

// HTML安全な文字列にエスケープ
function esc(str) {
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
}

// span で色付きテキストを生成
function span(cls, text) {
    return `<span class="${cls}">${esc(text)}</span>`;
}

// 状態確認（Diagnostics.run）
async function runDiagnostics() {
    const el = getResultEl();
    const btn = document.getElementById("btn-diag");
    btn.disabled = true;
    el.innerHTML = "取得中...";

    try {
        const r = await sendToActiveTab({ type: "runDiagnostics" });

        if (r.error) {
            el.innerHTML = span("fail", r.error);
            return;
        }

        let html = "";

        // ページ情報
        html += span("section", "--- ページ ---") + "\n";
        html += span("label", "URL: ") + span("value", r.page.url) + "\n";
        const pageType = r.page.isYouTubeChatIframe ? "YouTube live_chat iframe"
            : r.page.isIframe ? "iframe (その他)"
            : r.page.isYouTube ? "YouTube メインページ"
            : r.page.isHolodex ? "Holodex メインページ"
            : "不明";
        html += span("label", "種別: ") + span("value", pageType) + "\n";
        html += span("label", "初期化: ") + (r.chatHelper.initialized ? span("ok", "完了") : span("fail", "未初期化")) + "\n";

        // チャンネル情報
        html += "\n" + span("section", "--- チャンネル ---") + "\n";
        const ch = r.channelInfo.cache;
        if (ch) {
            if (ch.id) html += span("label", "ID: ") + span("ok", ch.id) + "\n";
            if (ch.handle) html += span("label", "Handle: ") + span("ok", ch.handle) + "\n";
            if (ch.name) html += span("label", "名前: ") + span("value", ch.name) + "\n";
            if (ch.videoId) html += span("label", "VideoID: ") + span("value", ch.videoId) + "\n";
        } else {
            html += span("fail", "キャッシュなし（非同期取得未完了？）") + "\n";
            const sync = r.channelInfo.sync;
            if (sync) {
                html += span("label", "同期検出: ") + span("value", sync.name || JSON.stringify(sync)) + "\n";
            }
        }

        // CCPPP
        html += "\n" + span("section", "--- CCPPP ---") + "\n";
        html += span("label", "有効: ") + (r.ccppp.enabled ? span("ok", "ON") : span("fail", "OFF")) + "\n";
        html += span("label", "絵文字数: ") + span("value", String(r.ccppp.emojiMapSize)) + "\n";

        // ストレージ
        html += "\n" + span("section", "--- テンプレート ---") + "\n";
        html += span("label", "グローバル: ") + span("value", String(r.storage.globalTemplateCount) + "個") + "\n";
        html += span("label", "チャンネル数: ") + span("value", String(r.storage.channelCount)) + "\n";
        r.storage.channels.forEach(ch => {
            const name = ch.name || ch.handle || ch.id || "???";
            html += "  " + span("value", name) + " (" + span("label", ch.templateCount + "個");
            if (ch.id) html += ", " + span("ok", "ID有");
            if (ch.handle) html += ", " + span("ok", "Handle有");
            html += ")\n";
        });

        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = formatConnectionError(e);
    } finally {
        btn.disabled = false;
    }
}

// チャンネル検出テスト（Diagnostics.runChannelDetection）
async function runChannelDetection() {
    const el = getResultEl();
    const btn = document.getElementById("btn-channel");
    btn.disabled = true;
    el.innerHTML = "チャンネル検出中...（最大15秒）";

    try {
        const r = await sendToActiveTab({ type: "runChannelDetection" });

        if (r.error) {
            el.innerHTML = span("fail", r.error);
            return;
        }

        let html = span("section", "--- チャンネル検出結果 ---") + "\n\n";

        r.steps.forEach(step => {
            const icon = step.success ? span("ok", "[OK]") : span("fail", "[NG]");
            html += icon + " " + span("label", step.name) + "\n";

            if (typeof step.result === "object" && step.result !== null) {
                Object.entries(step.result).forEach(([k, v]) => {
                    html += "   " + span("label", k + ": ") + span("value", String(v)) + "\n";
                });
            } else {
                html += "   " + span("value", String(step.result)) + "\n";
            }
            html += "\n";
        });

        el.innerHTML = html;
    } catch (e) {
        el.innerHTML = formatConnectionError(e);
    } finally {
        btn.disabled = false;
    }
}

// 接続エラーのフォーマット
function formatConnectionError(e) {
    const msg = e.message || "";
    if (msg.includes("Could not establish connection") || msg.includes("Receiving end does not exist")) {
        return span("fail", "接続エラー") + "\n"
            + span("label", "コンテンツスクリプトに接続できません。") + "\n"
            + span("label", "対処法: ページをリロードしてください（F5）");
    }
    return span("fail", "エラー: " + msg) + "\n"
        + span("label", "YouTube または Holodex ページで実行してください");
}

// イベントリスナー設定
document.addEventListener("DOMContentLoaded", () => {
    loadSettings();

    document.getElementById("ccppp-toggle").addEventListener("change", saveSettings);
    document.getElementById("autoload-toggle").addEventListener("change", saveSettings);

    document.getElementById("btn-diag").addEventListener("click", runDiagnostics);
    document.getElementById("btn-channel").addEventListener("click", runChannelDetection);
});
