// 現在のチャンネル情報を取得
function getChannelInfo() {
    const channelElement = document.querySelector("ytd-channel-name#channel-name yt-formatted-string#text a");
    if (!channelElement) return null;
    return { name: channelElement.innerText.trim(), href: channelElement.href };
}

// チャット入力を取得して保存
function readInput_helper(iframe) {
    const nodes = iframe.contentDocument.querySelector("yt-live-chat-text-input-field-renderer#input #input").childNodes;
    const inputData = [];

    nodes.forEach(node => {
        if (node.nodeType === 3) {
            inputData.push(node.textContent.trim());
        } else if (node.nodeType === 1 && node.alt) {
            inputData.push({ alt: node.alt,
                             src: node.src})
        }
    });

    saveData(inputData);
    const dataButton = createButton(`insert-btn-new`, `btn new`, () => {
        insertInput(entry.content, iframe);
    });

    const buttonWraper = iframe.contentDocument.querySelector("#categories-wrapper #chat-handler-button");
    if ( !buttonWraper ){
        const buttonWraper = iframe.querySelector("#categories-wrapper #chat-handler-button");
    }
    initarize(iframe);

}

// データを `localStorage` に保存
function saveData(newData) {
    const channelInfo = getChannelInfo();
    if (!channelInfo) {
        console.warn("チャンネル情報が取得できません。");
        return;
    }

    const storageKey = "chatData"; // すべてのチャンネルデータを1つのキーに保存
    const storedData = JSON.parse(localStorage.getItem(storageKey)) || { channels: [] };

    // チャンネルごとにデータを保存する
    let channels = storedData.channels;
    let channelIndex = channels.findIndex(ch => ch.name === channelInfo.name);

    if (channelIndex === -1) {
        // 新規チャンネル追加
        channels.push({
            name: channelInfo.name,
            href: channelInfo.href,
            data: [{ timestamp: new Date().toISOString(), content: newData, caption: newData }]
        });
    } else {
        // 既存チャンネルにデータ追加
        channels[channelIndex].data.push({ timestamp: new Date().toISOString(), content: newData });
    }

    localStorage.setItem(storageKey, JSON.stringify({ channels }));

}

// 保存されたデータを挿入
function insertInput(data, iframe) {
    const channelInfo = getChannelInfo();
    if (!channelInfo) return;

    const inputPanel = iframe.contentDocument.querySelector("#input-panel")
    const cat = inputPanel.querySelector("tp-yt-iron-pages #categories")
    const inputField = inputPanel.querySelector("yt-live-chat-text-input-field-renderer#input")


    if (!inputField) {
        console.warn("入力欄が見つかりません。");
        return;
    }

    data.forEach((item) => {
        if (typeof item === "string") {
            inputField.insertText(item);
        } else if (typeof item === "object" && item.alt) {
            var button = cat.querySelector(`[alt="${item.alt}"]`);
            if (button) {
                button.click();
            }
        }
    });

}

// YouTubeのURL変更を監視し、チャットフレームを取得
function observeChatFrame() {
    let lastUrl = location.href;

    function checkUrlChange() {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            waitForChatFrame_helper();
        }
    }

    setInterval(checkUrlChange, 1000);
}

function waitForChatFrame_helper() {
    console.log("チャットフレームを探しています...");
    const chatFrame = document.querySelector("iframe#chatframe");

    if (chatFrame) {
        chatFrame.addEventListener("load", () => {
            console.log("チャットフレームがロードされました！");
            initarize(chatFrame);
        });
    } else {
        setTimeout(waitForChatFrame_helper, 1000);
    }
}


function createButton(id, caption, handler) {
    const button = document.createElement("button");
    button.id = id;

    if (typeof caption === "string") {
        button.textContent = caption;
    } else if (typeof caption === "object") {
        caption.forEach(item => {
            if (typeof item === "string") {
                button.append(item)
            } else if (typeof item === "object" && item.src) {
                const img = document.createElement('img')
                img.src = item.src
                button.append(img)
            }
        })
    } else {
        button.textContent = "button";
    }

    button.addEventListener("click", handler);
    return button;
}

function initarize(iframe) {
    console.log("initiarizee...")
    const buttonWrapper = iframe.contentDocument.querySelector("#chat-helper-buttons");
    if (buttonWrapper) {
        buttonWrapper.remove();
    }
    setupChatButtons(iframe);
    addStyleToElement(iframe);
}

// ボタンをチャット欄に追加
function setupChatButtons(iframe) {
    const chatContainer = iframe.contentDocument.querySelector("#chat-messages #input-panel #container");
    if (!chatContainer) return;

    const readButton = createButton("read-input-btn", "Save", () => {
        readInput_helper(iframe)
    });

    // ラッパー要素を作成
    const buttonWrapper = document.createElement("div");
    buttonWrapper.id = "chat-helper-buttons";
    buttonWrapper.style.cssText = "display: flex; gap: 3px; flex-wrap: wrap;";

    // 初回ロード時に保存データを取得
    const storageKey = "chatData";
    const storedData = JSON.parse(localStorage.getItem(storageKey)) || { channels: [] };
    const channelInfo = getChannelInfo();

    if (channelInfo) {
        const channel = storedData.channels.find(ch => ch.name === channelInfo.name);
        if (channel && channel.data.length > 0) {
            channel.data.forEach((entry, index) => {
                const dataButton = createButton(`insert-btn-${index}`, entry.content, () => {
                    insertInput(entry.content, iframe);

                });

                // 右クリックで削除メニュー表示
                dataButton.addEventListener("contextmenu", (event) => {
                    event.preventDefault(); // デフォルトの右クリックメニューを無効化
                    showDeleteMenu(event, channelInfo.name, index, iframe);
                });
                buttonWrapper.appendChild(dataButton)
            });
        }
    }

    // ボタンを追加
    buttonWrapper.appendChild(readButton);

    // ラッパーをチャットコンテナに追加
    chatContainer.appendChild(buttonWrapper);
}

function showDeleteMenu(event, channelName, index, iframe) {
    const menu = document.createElement("div");
    menu.textContent = "このデータを削除";
    menu.style.cssText = `
        position: absolute;
        background-color: white;
        padding: 5px 10px;
        border: 1px solid #ccc;
        box-shadow: 2px 2px 10px rgba(0, 0, 0, 0.2);
        cursor: pointer;
        z-index: 1000;a
  `;

    document.body.appendChild(menu);

    const rect = iframe.getBoundingClientRect();
    const menuX = event.clientX + rect.left + window.scrollX;
    const menuY = event.clientY + rect.top + window.scrollY;


    menu.style.left = `${menuX}px`;
    menu.style.top = `${menuY}px`;

    // 削除処理
    menu.addEventListener("click", () => {
        deleteData(channelName, index, iframe);
        document.body.removeChild(menu); // メニューを削除
    });

    // メニュー外をクリックしたら消す
    document.addEventListener("click", () => {
        if (document.body.contains(menu)) {
            document.body.removeChild(menu);
        }
    }, { once: true });
     iframe.contentDocument.addEventListener("click", () => {
        if (document.body.contains(menu)) {
            document.body.removeChild(menu);
        }
     }, { once: true });
}

function deleteData(channelName, index, iframe) {
    const storageKey = "chatData";
    let storedData = JSON.parse(localStorage.getItem(storageKey)) || { channels: [] };

    const channel = storedData.channels.find(ch => ch.name === channelName);
    if (!channel) return;

    // 指定のデータを削除
    channel.data.splice(index, 1);

    // 空になったらチャンネルごと削除
    if (channel.data.length === 0) {
        storedData.channels = storedData.channels.filter(ch => ch.name !== channelName);
    }

    localStorage.setItem(storageKey, JSON.stringify(storedData));

    // ボタンを更新
    iframe.contentDocument.querySelector("#chat-helper-buttons").remove();
    setupChatButtons(iframe);
}

function addStyleToElement(parentElement) {
    const myClass = "myclass"
    if (parentElement.contentDocument.querySelector("." + myClass)){
        return;
        }
    if (!parentElement || !(parentElement instanceof HTMLElement)) {
        console.error("有効な親要素を指定してください。");
        return;
    }

    const styleContent = `
#chat-helper-buttons {
    position: absolute;
    top: 0;
    margin-top: 36px;
    visibility: hidden;
    z-index: 1;
    background: rgba(144, 238, 144, 0.2);
    height: auto;
    width: 100%;
    overflow: hidden;
    transition-delay:  0.2s;
}

#chat-helper-buttons button {
    visibility: hidden;
    height: 0;
    margin: 0px;
    padding: 0px;
    font-size: 12px;
    background-color: #0073e6;
    color: white;
    border: none;
    border-radius: 10px; cursor: pointer;
    transition-delay:  0.2s;
}

#input-panel>yt-live-chat-message-input-renderer[emoji-open] #chat-helper-buttons{
    visibility:visible;
    margin-top: 36px;
    padding-bottom: 10px;
}
#chat-helper-buttons:hover {
    height: auto;
    transition-delay:  0.2s;
    opacity: 0.8;
    padding: 4px 0;
    /*background-color: rgba(0 0 0 / 0.5);*/
}

#chat-helper-buttons:hover  button {
    padding: 2px 5px;
    visibility: visible;
    height: 19px;
    transition-delay:  0.2s;
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
}
    `;

    // `<style>` タグを作成
    const styleTag = document.createElement("style");
    styleTag.classList.add(myClass)
    styleTag.textContent = styleContent;

    // 親要素の最初の子要素として追加
    parentElement.contentDocument.querySelector('html').prepend(styleTag);
}


// 初期化
observeChatFrame();
waitForChatFrame_helper();
