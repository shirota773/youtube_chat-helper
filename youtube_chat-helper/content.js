function injectScript(file) {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(file);
  script.onload = () => script.remove(); // 実行後に削除
  document.documentElement.appendChild(script);
}

// inject.js を YouTube ページに挿入して実行
injectScript("inject.js");
