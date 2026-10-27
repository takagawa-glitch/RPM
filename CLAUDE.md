# RPM（回転数で進める学習ノルマ）— 開発メモ

複数の人が使う学習用Webアプリ。顧問先データは扱わない。共通ルールの「Python/tkinter」ではなく、ユーザーの指示で Web（GitHub Pages）として作り、将来 iPhone アプリにする（`docs/iPhoneアプリ化.md`）。
claude.ai のログインは使わない（ユーザーの指示）。

- GitHub: https://github.com/takagawa-glitch/RPM.git（main ブランチ。リポジトリのルート＝このフォルダ）
- 公開: GitHub Pages（main / root）

## 構成
```
学習WEBアプリ/
├─ index.html            入口
├─ manifest.webmanifest  ホーム画面に追加したときの名前・アイコン
├─ css/style.css         見た目（色は :root の変数だけを使う。ダークモード対応）
├─ js/plan.js            計算（画面・保存に触れない。テスト対象）
├─ js/store.js           保存（端末の localStorage／Firebase）
├─ js/firebase-config.js Firebase の接続先（空なら同期なし）
├─ js/app.js             画面と操作
├─ firestore.rules       Firestore のルール（本人だけ読み書き）
├─ icons/                アイコン（tools/make_icons.py で作る）
├─ tests/plan.test.js    計算のテスト（node:test）
├─ tools/make_icons.py
├─ docs/iPhoneアプリ化.md
└─ 旧版/                 claude.ai 版（Git 対象外・参照のみ）
```
ライブラリ: なし。Firebase SDK 10.12.2 は gstatic から、同期を使うときだけ読み込む。フォントは Google Fonts。

## データ
教材1件 = 1オブジェクト:
`{ id, name, unit('p'|'q'), total, start, target(YYYY-MM-DD), reps, intervals[], createdAt, updatedAt, batches[] }`
- `batches` = 新しく進めた範囲ごとの記録 `{ from, to, done: ['学んだ日', '1回目の復習日', ...] }`。`done.length` がそのページの回数。
- 保存先: ログインなし → localStorage `rpm-v2-materials`。ログイン → Firestore `users/<uid>/materials/<id>`（オフライン用の控えあり）。
- バックアップ: `{ app:'RPM', version:2, exportedAt, materials[] }` の JSON。

## 計算（plan.js）
- 復習の日 = 前回やった日 + 間隔（既定 1,3,7,14,30）。遅れたら、やった日から数え直す。
- 回転数が間隔の数より多いときは、最後の間隔の2倍ずつ足す。
- 新しく学ぶ締切 = 目標日 − 間隔の合計。新しく進める量 = 残りページ ÷ 締切までの残り日数（今日を含む）。毎日組み直す（リスケ）。
- 期間が短く間隔の合計が期間の半分を超えるときは、間隔を比例して縮める（`effIntervals`、最低1日）。
- `dayStatus`: 新しい分と、その日に期限の来ていた復習を全部やったら 'full'。`streak` は全教材が 'full' の日の連続数（今日が途中なら昨日から）。

## 処理記録・起動エラー
共通ルールの処理記録・error.log は、顧問先データを扱う Windows の業務ツール向けのため対象外。エラーは画面のメッセージで知らせる。

## テスト
```
npm test
```
画面の確認は、架空の教材（「サンプル教材で試す」）で行う。ローカルでは `py -m http.server 8000`。

## Git
- `.gitignore` で 旧版/、バックアップ JSON、ログ、`.env` などを除外。
- `firebase-config.js` は公開前提の識別子なのでコミットしてよい。サービスアカウントの鍵（`*-service-account*.json`）は絶対にコミットしない。
- このフォルダは Box で同期されている。`.git` の同期中に Git 操作が失敗したら、Box の同期が終わってからやり直す。

## できないこと（Web の制約）
- ページを閉じている間の通知、他のアプリの使用制限。→ iPhone アプリ化で対応（docs/iPhoneアプリ化.md）。
