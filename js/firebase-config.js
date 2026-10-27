// Firebase の設定。Firebase のコンソール（プロジェクトの設定 → マイアプリ → ウェブアプリ）に
// 表示される firebaseConfig の値をそのまま貼り付ける。手順は README.md の「同期の準備」。
//
// この値はブラウザに配る前提の「識別子」でパスワードではない（公開されても、
// firestore.rules で本人しか自分の記録を読めないようにしているため問題ない）。
//
// apiKey が空のあいだは同期の機能を出さず、端末の中だけで動く。
export const firebaseConfig = {
  apiKey: 'AIzaSyDD9cqWzk6eOCVy_UdczQH0vmU2m7s2uN0',
  authDomain: 'rpm-c7e54.firebaseapp.com',
  projectId: 'rpm-c7e54',
  storageBucket: 'rpm-c7e54.firebasestorage.app',
  messagingSenderId: '1019094691410',
  appId: '1:1019094691410:web:9c1d1b508dcd29cc0df98b'
};
