# iPhone アプリ化の進め方

今の Web 版（HTML・CSS・JavaScript）をそのまま中身に使い、iPhone アプリの「入れ物」で包む方式（Capacitor）をすすめる。作り直しが少なく、Web 版と同じ計算・画面を使い続けられる。

## 必要なもの
| もの | 理由 | 費用の目安 |
|---|---|---|
| Mac（Xcode が動くもの） | iPhone アプリは Mac の Xcode でしか作れない。Windows しかない場合は、クラウドの Mac（MacinCloud など）か、ビルドを代行するサービス（Codemagic など）を使う | Mac 本体、または月額のクラウド料金 |
| Apple Developer Program | 複数の人に配る（TestFlight・App Store）のに必要 | 年額 12,980円（税込・2026年時点の目安。申込時に確認） |
| iPhone（確認用） | 実機での動作確認 | — |

## 段階
1. **Capacitor で包む**: `npm i @capacitor/core @capacitor/ios` → `npx cap add ios` → Xcode で実行。データは端末の中か、今と同じ Firebase。
2. **しつこい通知**: `@capacitor/local-notifications` で、毎日決まった時刻と夜に「今日の分が残っています」を出す。記録したらその日の通知を取り消す。サーバーは不要（端末の中で予約する）。
3. **アプリ制限**: Apple の「スクリーンタイム API」（FamilyControls / ManagedSettings / DeviceActivity）を Swift で書き、Capacitor のプラグインとしてつなぐ。「今日の分が終わるまで SNS などを止める」ができる。
   - Apple に「Family Controls」の利用許可（entitlement）を申請する必要がある。審査があり、許可されない場合もある。
   - 止めるアプリは、利用者が iPhone の画面で自分で選ぶ（アプリから勝手には選べない）。
4. **配布**: TestFlight で事務所内に配り、問題がなければ App Store に出す。App Store に出す場合、Google などのログインを使うなら「Apple でサインイン」も必要（メール/パスワードだけなら不要）。

## 今の Web 版で気をつけていること
- 計算（`js/plan.js`）は画面と保存から切り離してあるので、そのまま使える。
- 保存（`js/store.js`）を差し替えれば、端末のデータベースや iCloud にも移せる。
