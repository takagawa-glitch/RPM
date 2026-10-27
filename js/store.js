// 記録の保存先。
// - ログインしていないとき: この端末のブラウザの中（localStorage）
// - ログインしているとき: Firebase（Firestore）の users/<uid>/materials/<教材ID>。
//   通信できないあいだも端末に控えを持ち、つながったら自動で送る。
import { firebaseConfig } from './firebase-config.js';

const LS_KEY = 'rpm-v2-materials';
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
    ready: false,
    error: '',
    fb: null,
    unsub: null
  };
  const emit = () => onChange(s);

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function saveLocal(list) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
  }
  s.localMats = loadLocal;

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

  function useLocal() {
    if (s.unsub) { s.unsub(); s.unsub = null; }
    s.mode = 'local'; s.user = null; s.mats = loadLocal(); s.ready = true; emit();
  }
  function useCloud(user) {
    const { fsM, db } = s.fb;
    s.mode = 'cloud'; s.user = { uid: user.uid, email: user.email }; s.ready = false; emit();
    if (s.unsub) s.unsub();
    s.unsub = fsM.onSnapshot(fsM.collection(db, 'users', user.uid, 'materials'), snap => {
      s.mats = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      s.ready = true; s.error = ''; emit();
    }, e => { s.error = '記録を読み込めませんでした。ページを開き直してください。（' + (e.code || '') + '）'; s.ready = true; emit(); });
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

  /** 教材を保存（全体を書き換え） */
  s.save = async m => {
    m = { ...m, updatedAt: Date.now() };
    const i = s.mats.findIndex(x => x.id === m.id);
    if (i >= 0) s.mats[i] = m; else s.mats.push(m);
    if (s.mode === 'cloud') {
      const { fsM, db } = s.fb;
      const body = { ...m }; delete body.id;
      emit();
      await fsM.setDoc(fsM.doc(db, 'users', s.user.uid, 'materials', m.id), body);
    } else {
      emit();
      if (!saveLocal(s.mats)) throw new Error('local-save-failed');
    }
  };
  s.remove = async id => {
    s.mats = s.mats.filter(x => x.id !== id);
    emit();
    if (s.mode === 'cloud') {
      const { fsM, db } = s.fb;
      await fsM.deleteDoc(fsM.doc(db, 'users', s.user.uid, 'materials', id));
    } else saveLocal(s.mats);
  };
  /** この端末だけの記録をログイン中のアカウントへ移す */
  s.moveLocalToCloud = async () => {
    const list = loadLocal();
    for (const m of list) await s.save(m);
    saveLocal([]);
    return list.length;
  };
  /** バックアップから読み込む（同じIDは上書き） */
  s.importAll = async list => { for (const m of list) await s.save(m); };
  return s;
}
