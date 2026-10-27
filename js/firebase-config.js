// Firebase の設定。Firebase のコンソール（プロジェクトの設定 → マイアプリ → ウェブアプリ）に
// 表示される firebaseConfig の値をそのまま貼り付ける。手順は README.md の「同期の準備」。
//
// この値はブラウザに配る前提の「識別子」でパスワードではない（公開されても、
// firestore.rules で本人しか自分の記録を読めないようにしているため問題ない）。
//
// apiKey が空のあいだは同期の機能を出さず、端末の中だけで動く。
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};
