# RPM（回転数で進める学習ノルマ）— 開発メモ

複数の人が使う学習用Webアプリ。顧問先データは扱わない。共通ルールの「Python/tkinter」ではなく、ユーザーの指示で Web（GitHub Pages）として作り、将来 iPhone アプリにする（`docs/iPhoneアプリ化.md`）。
claude.ai のログインは使わない（ユーザーの指示）。

- GitHub: https://github.com/takagawa-glitch/RPM.git（main ブランチ。リポジトリのルート＝このフォルダ）
- 公開: GitHub Pages（main / root）https://takagawa-glitch.github.io/RPM/
- Firebase: プロジェクト `rpm-c7e54`（Authentication はメール/パスワードのみ、Firestore は asia-northeast1、ルールは firestore.rules）。2026-10-27 に端末間の同期を確認済み。

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
目標1件 = `{ id, name, examDate(YYYY-MM-DD), createdAt, updatedAt }`。
教材1件 = 1オブジェクト（`goalId` と `followGoal` を持つ。followGoal が true なら、計算の前に target を目標の examDate に置き換える＝app.js の `resolve`）:
`{ id, goalId, followGoal, name, unit('p'|'q'), total, start, target(YYYY-MM-DD), reps, speed, createdAt, updatedAt, log }`
- `log` = `{ 'YYYY-MM-DD': [周目, ページ] }`。その日の終わりにどこまで進んだか。
- 2026-10-29 に「毎日復習（忘却曲線）」から「周回型」に変更。前の形の `batches`（と `intervals`）は `P.migrate` で1周目の進みとして読み替え、次に保存したときに新しい形になる。
- 保存先: ログインなし → localStorage `rpm-v2-materials`・`rpm-v2-goals`。ログイン → Firestore `users/<uid>/materials/<id>`・`users/<uid>/goals/<id>`（オフライン用の控えあり）。
- 目標を削除しても教材は消さず「目標なし」へ移す（試験日に合わせていた教材は、試験日を自分の目標日として残す）。
- バックアップ: `{ app:'RPM', version:4, exportedAt, goals[], materials[] }` の JSON（前の版も読める。前の形の教材は読み込んだあと読み替える）。
- 画面の明るさ: localStorage `rpm-theme`（light〔標準〕/ dark / auto）。index.html の先頭で data-theme を付ける。
- 色の根拠は css/style.css の先頭のコメント。赤は削除・エラーだけに使い、遅れはオレンジ（--late）。

## 計算（plan.js・周回型）
- 1周目を p.1 から最後まで終えてから2周目を p.1 から……と `reps` 周回る。1周目の途中で復習は出さない（ユーザーの指示）。
- n周目の1ページの負担 = speed^(n-1)（下限0.1。speed は 0.5〔標準〕/0.7/1）。後の周ほど短い日数で回る。
- 今日のノルマ = 昨日までに残った負担 ÷ 今日を含む目標日までの残り日数 を、ページ数に戻したもの（`quota`）。毎日組み直す（リスケ）。目標日を過ぎたら残り全部。
- `roundPlan`: 周ごとの終わった日／いまのペースでの終わる予定日。`pace`: 最初の計画（負担を毎日均等）との差。
- `dayStatus`: その日のノルマを達成したら 'full'。`streak` は全教材が 'full' の日の連続数（今日が途中なら昨日から）。

## 処理記録・起動エラー
共通ルールの処理記録・error.log は、顧問先データを扱う Windows の業務ツール向けのため対象外。エラーは画面のメッセージで知らせる。

## テスト
```
npm test
```
画面の確認は、架空の教材（「サンプル教材で試す」）で行う。ローカルでは `py -m http.server 8000`。

## 更新するとき（キャッシュ対策）
GitHub Pages はファイルを10分間ブラウザに保存させる。更新したら、`index.html`・`js/app.js`・`js/store.js` の `?v=` の値（例: 20261027b）を全部同じ新しい値に変えてからプッシュする。

## Git
- `.gitignore` で 旧版/、バックアップ JSON、ログ、`.env` などを除外。
- `firebase-config.js` は公開前提の識別子なのでコミットしてよい。サービスアカウントの鍵（`*-service-account*.json`）は絶対にコミットしない。
- このフォルダは Box で同期されている。`.git` の同期中に Git 操作が失敗したら、Box の同期が終わってからやり直す。

## できないこと（Web の制約）
- ページを閉じている間の通知、他のアプリの使用制限。→ iPhone アプリ化で対応（docs/iPhoneアプリ化.md）。
