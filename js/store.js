// 記録の保存先。
// - ログインしていないとき: この端末のブラウザの中（localStorage）
// - ログインしているとき: Firebase（Firestore）の
//     users/<uid>/goals/<目標ID>      目標（例: 社労士試験）
//     users/<uid>/materials/<教材ID>  教材と学習記録
//   通信できないあいだも端末に控えを持ち、つながったら自動で送る。
import { firebaseConfig } from './firebase-config.js?v=20261029a';

const COLS = ['materials', 'goals'];
const LS_KEY = { materials: 'rpm-v2-materials', goals: 'rpm-v2-goals' };
const PROP = { materials: 'mats', goals: 'goals' };
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';

export const cloudAvailable = () => !!(firebaseConfig && firebaseConfig.apiKey);

const AUTH_MSG = {
  'auth/invalid-email': 'メールアドレスの形が正しくありません。',
  'auth/invalid-credential': 'メールアドレスかパスワードが違います。',
  'auth/wrong-password': 'メールアドレスかパスワードが違います。',
  'auth/user-not-found': 'メールアドレスかパスワードが違います。',
  'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。「ログイン」から入ってください。',
  'auth/weak-password': 'パスワードは6文字以上にしてください。',
  'auth/too-many-requests': '何度も失敗したため、しばらく使えません。時間をおいてからもう一度お試しください。',
  'auth/network-request-failed': 'インターネットにつながっていません。通信を確かめてください。'
};
export const authMessage = e => AUTH_MSG[e && e.code] || `うまくいきませんでした（${(e && e.code) || '不明なエラー'}）。`;

export function createStore(onChange) {
  const s = {
    mode: 'local',        // 'local' | 'cloud'
    user: null,           // { uid, email }
    mats: [],
    goals: [],
    ready: false,
    error: '',
    fb: null,
    unsubs: []
  };
  const emit = () => onChange(s);

  const loadLocal = col => { try { return JSON.parse(localStorage.getItem(LS_KEY[col]) || '[]'); } catch (e) { return []; } };
  const saveLocal = (col, list) => { try { localStorage.setItem(LS_KEY[col], JSON.stringify(list)); return true; } catch (e) { return false; } };
  /** この端末だけに保存されている件数 */
  s.localCounts = () => ({ materials: loadLocal('materials').length, goals: loadLocal('goals').length });

  async function loadFirebase() {
    if (s.fb) return s.fb;
    const [appM, authM, fsM] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js')
    ]);
    const app = appM.initializeApp(firebaseConfig);
    const auth = authM.getAuth(app);
    let db;
    try { db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache() }); }
    catch (e) { db = fsM.getFirestore(app); }
    s.fb = { authM, fsM, auth, db };
    return s.fb;
  }

  function stop() { s.unsubs.forEach(u => u()); s.unsubs = []; }
  function useLocal() {
    stop();
    s.mode = 'local'; s.user = null;
    s.mats = loadLocal('materials'); s.goals = loadLocal('goals');
    s.ready = true; emit();
  }
  function useCloud(user) {
    const { fsM, db } = s.fb;
    stop();
    s.mode = 'cloud'; s.user = { uid: user.uid, email: user.email }; s.ready = false; s.mats = []; s.goals = []; emit();
    const got = {};
    s.unsubs = COLS.map(col => fsM.onSnapshot(fsM.collection(db, 'users', user.uid, col), snap => {
      s[PROP[col]] = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      got[col] = true; s.ready = COLS.every(c => got[c]); s.error = ''; emit();
    }, e => {
      got[col] = true; s.ready = COLS.every(c => got[c]);
      s.error = e && e.code === 'permission-denied'
        ? `${col === 'goals' ? '目標' : '教材'}を読み込めませんでした。管理者は Firestore のルールが最新か確かめてください（permission-denied）。`
        : '記録を読み込めませんでした。ページを開き直してください。（' + ((e && e.code) || '') + '）';
      emit();
    }));
  }

  s.init = async () => {
    if (!cloudAvailable()) return useLocal();
    useLocal(); // 先に端末の記録で表示しておく
    try {
      const { authM, auth } = await loadFirebase();
      authM.onAuthStateChanged(auth, u => (u ? useCloud(u) : useLocal()));
    } catch (e) {
      s.error = '同期の準備ができませんでした（インターネットにつながっていない可能性があります）。この端末の記録で表示しています。';
      emit();
    }
  };

  s.signup = async (email, pw) => { const { authM, auth } = await loadFirebase(); await authM.createUserWithEmailAndPassword(auth, email, pw); };
  s.login = async (email, pw) => { const { authM, auth } = await loadFirebase(); await authM.signInWithEmailAndPassword(auth, email, pw); };
  s.logout = async () => { const { authM, auth } = await loadFirebase(); await authM.signOut(auth); };
  s.resetPassword = async email => { const { authM, auth } = await loadFirebase(); await authM.sendPasswordResetEmail(auth, email); };

  /** 保存（全体を書き換え）。col は 'materials' か 'goals' */
  s.save = async (col, obj) => {
    obj = { ...obj, updatedAt: Date.now() };
    const list = s[PROP[col]];
    const i = list.findIndex(x => x.id === obj.id);
    if (i >= 0) list[i] = obj; else list.push(obj);
    emit();
    if (s.mode === 'cloud') {
      const { fsM, db } = s.fb;
      const body = { ...obj }; delete body.id;
      await fsM.setDoc(fsM.doc(db, 'users', s.user.uid, col, obj.id), body);
    } else if (!saveLocal(col, list)) throw new Error('local-save-failed');
  };
  s.remove = async (col, id) => {
    s[PROP[col]] = s[PROP[col]].filter(x => x.id !== id);
    emit();
    if (s.mode === 'cloud') {
      const { fsM, db } = s.fb;
      await fsM.deleteDoc(fsM.doc(db, 'users', s.user.uid, col, id));
    } else saveLocal(col, s[PROP[col]]);
  };
  /** この端末だけの記録をログイン中のアカウントへ移す */
  s.moveLocalToCloud = async () => {
    let n = 0;
    for (const col of COLS) {
      const list = loadLocal(col);
      for (const x of list) await s.save(col, x);
      saveLocal(col, []);
      if (col === 'materials') n = list.length;
    }
    return n;
  };
  /** バックアップから読み込む（同じIDは上書き） */
  s.importAll = async ({ materials = [], goals = [] }) => {
    for (const g of goals) await s.save('goals', g);
    for (const m of materials) await s.save('materials', m);
  };
  return s;
}
