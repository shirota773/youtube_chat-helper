# YouTube Chat Helper - 要件定義書

## 1. プロジェクト概要

YouTubeライブチャットでコメント入力用テンプレートをチャンネル毎に登録し、ボタンクリックで入力可能にするChrome拡張機能。
通常テキスト、YouTube標準スタンプ、メンバーシップ限定スタンプに対応。
holodex.net上でも動作する。

## 2. 既存機能（実装済み）

| 機能 | 状態 | 説明 |
|------|------|------|
| テンプレート保存・挿入 | 安定 | チャット入力内容をボタンとして保存、クリックで再入力 |
| グローバルテンプレート | 安定 | 全チャンネル共通のテンプレート |
| チャンネル別テンプレート | 安定 | チャンネル名ベースで紐付け |
| 別名表示（エイリアス） | 安定 | テンプレートにカスタム表示名を設定 |
| ドラッグ&ドロップ並び替え | 安定 | ボタン・リストの順序変更 |
| 右クリックコンテキストメニュー | 安定 | 削除、グローバル/ローカル移動、エイリアス設定 |
| 設定UI（モーダル） | 安定 | タブ式管理画面 |
| Holodex基本動作 | 部分的 | iframe内で自己初期化するが、チャンネル検出に問題あり |
| CCPPP | 不完全 | コード実装済みだが動作に問題あり |

## 3. 課題と対応策

### 課題1: CCPPP（スタンプコピペ変換）が動作しない

**症状**: スタンプをコピペすると`:stamp_name:`というプロパティ名がテキストとして入力される。CCPPPはこれを検知してスタンプ変換ボタンに置換するはずだが動作しない。

**調査結果（Phase 1デバッグ）**:
- `buildEmojiMap()`のセレクタ `tp-yt-iron-pages #categories img[alt]` は**正常動作**（152件検出）
- 問題は`processInput`のMutationObserverまたは`createEmojiButton`のクリック処理側にある

**対応策（v3.0で実装済み）**:
1. `observeInput`にpasteイベントリスナー追加（MutationObserverの補完）
2. paste後100ms + 500msの2段階タイミングでprocessInputを呼び出し
3. `processInput`でMutationObserverを一時停止/再開し無限ループ防止
4. 既存CCPPPボタンがある場合のスキップ処理
5. `createEmojiButton`で絵文字ピッカーが閉じている場合に自動オープン
6. デバッグログ追加（検出/未登録の絵文字名をコンソール出力）

**未解決の可能性**:
- ペースト時にYouTubeが`:name:`形式でテキストを挿入しない場合、regex `/:([^:\s]+):/g` がマッチしない
- メンバーシップスタンプが`#categories`外にある場合、emojiMapに含まれない
- **次のアクション**: 実機テストで`:name:`形式で入力されるか確認。されない場合はregexの調整が必要

### 課題2: Holodexでのチャンネル検出不良

**症状**: Holodex上でchat helperは動作するが、チャンネル名/IDが正しく取得できず、保存テンプレートと対応が取れない。

**調査結果（Phase 1デバッグ）**:

| 方法 | 結果 | 詳細 |
|------|------|------|
| DOM解析 | **失敗** | live_chatヘッダーにチャンネル情報要素なし。`Video_{videoId}`にフォールバック |
| oEmbed API | **成功** | `author_name: "Miko Ch. さくらみこ"`, `author_url: "@SakuraMiko"` |
| Holodex API | **失敗** | 403 Forbidden（CORS/認証制限） |
| embed iframe DOM | **部分成功** | `UC-hM6YJuNYVAmUWxeIr9FeA`が取得可能だが、別iframe（live_chatからアクセス不可） |
| videoId抽出 | **成功** | URLパラメータ`?v=`から常に取得可能 |

**対応策（v3.0で実装済み）**:
1. `fetchChannelFromOEmbed(videoId)`: oEmbed APIで@handleとチャンネル名を取得
2. `resolveChannelId(handle)`: @handleからUCxxxx形式に解決（YouTube同一オリジンfetch + HTML解析）
3. `getChannelInfoAsync()`: 非同期チャンネル情報取得（キャッシュ機構付き）
4. 初期化時に非同期取得開始 → 完了後にボタンを再描画
5. URL変更時のキャッシュクリア

**注意事項**:
- oEmbed APIは`@handle`形式を返す（`UCxxxx`ではない）
- `resolveChannelId`はYouTubeチャンネルページのHTMLを丸ごとfetchするため、レスポンスが大きい
- Holodex APIは403で使用不可（live_chat iframe内からは認証が通らない）

### 課題3: テンプレートのチャンネル紐付け方式

**旧方式**: チャンネル名（`ch.name`）でマッチング → 名前変更に弱い、Holodexで取得不能

**対応策（v3.0で実装済み）**:

データ構造の拡張:
```javascript
// Before
{ channels: [{ name: "ChName", href: "...", data: [...] }] }
// After
{ channels: [{ id: "UCxxxx", handle: "@Handle", name: "ChName", href: "...", data: [...] }] }
```

マッチング優先順: **id > handle > name**
- `Storage.findChannel(data, channelInfo)`: 3段階フォールバック検索
- 既存データとの後方互換性: nameのみのデータもマッチ可能
- 新規保存時にid/handleを自動付与。既存データにも逐次付与

## 4. アーキテクチャ

```
content.js (extension context)
  ├── chrome.storage.local から設定読み込み
  ├── window.__CHAT_HELPER_SETTINGS__ に設定注入
  └── inject.js を page context に注入

inject.js (page context) - 主要モジュール:
  ├── Utils       - DOM操作、チャンネル検出、oEmbed API
  ├── Settings    - 設定管理（global変数 + localStorage）
  ├── Storage     - テンプレートCRUD（localStorage "chatData"）
  ├── CCPPP       - :emoji_name: → スタンプ変換
  ├── UI          - ボタン生成、コンテキストメニュー、設定モーダル
  ├── StampLoader - スタンプ自動読み込み
  └── ChatHelper  - 初期化、iframe検出、MutationObserver

popup.html/popup.js - ポップアップUI（CCPPP/スタンプ自動読み込みのON/OFF）
```

### 動作フロー

```
ページロード
  ↓
content.js: 設定注入 → inject.js注入
  ↓
inject.js: ChatHelper.init()
  ├── iframe内(live_chat)の場合 → initializeCurrentFrame()
  │   ├── pseudoIframe作成 → UI/CCPPP/StampLoader初期化
  │   └── getChannelInfoAsync() → oEmbed → resolveChannelId → ボタン再描画
  └── 通常ページ(YouTube/Holodex)の場合
      ├── MutationObserverでiframe検出
      └── getChannelInfoAsync()
```

## 5. ファイル一覧

| ファイル | 役割 |
|----------|------|
| `manifest.json` | 拡張機能設定（v3, all_frames: true） |
| `content.js` | bridge: 設定注入 + inject.js注入 |
| `inject.js` | メインロジック（~1900行） |
| `popup.html` | ポップアップUI |
| `popup.js` | ポップアップロジック |

## 6. 今後の課題・検討事項

- [ ] CCPPP実機テスト: ペースト時の実際のテキスト形式を確認
- [ ] メンバーシップスタンプ: `#categories`外にある場合のbuildEmojiMap拡張
- [ ] resolveChannelIdの最適化: HTMLを丸ごと取得するのは重い。軽量な代替手段の検討
- [ ] Holodex multiview: 複数チャンネル同時表示時の動作確認
- [ ] 既存データマイグレーション: name-onlyデータを一括でid/handle付与するユーティリティ
- [ ] エラーハンドリング: oEmbed/resolveChannelId失敗時のユーザー通知

## 7. ブランチ構成

| ブランチ | 目的 | 状態 |
|----------|------|------|
| `main` | 安定版（YouTube上で正常動作） | 基準 |
| `debug/holodex-channel-detection` | Phase 1デバッグコード | コミット済み |
| `feature/ccppp-and-channel-id` | CCPPP修正 + チャンネルID検出 + Storage変更 | コミット済み（テスト待ち） |
