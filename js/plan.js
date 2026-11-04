// RPM の計算部分。画面や保存には触れない（node のテストからも読み込む）。
//
// 考え方（周回型）
// - 教材を p.1 から最後まで1周し、終わったらまた p.1 から2周目……と「目標の回転数」まで回る。
//   1周目が終わるまで、前のページの復習は出さない。
// - 後の周ほど速く回る前提にする。n周目の1ページの負担 = 速さ^(n-1)（下限 0.1）。
//   速さ 0.5 なら 2周目は1周目の半分、3周目は4分の1の負担。忘れる前に間隔を詰めて回せるようにするため。
// - 今日のノルマ = 昨日までに残った負担 ÷ 今日を含む残り日数 を、ページ数に戻したもの。毎日組み直す。
// - 記録は「その日の終わりに何周目の何ページまで進んだか」。log = { 'YYYY-MM-DD': [周目, ページ] }

export const SPEEDS = [[0.5, '半分（標準）'], [0.7, '7割'], [1, '同じ']];
export const DEFAULT_SPEED = 0.5;

/* ---------- 日付（'YYYY-MM-DD' の文字列で扱う） ---------- */
const pad = n => String(n).padStart(2, '0');
export const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayStr = () => fmt(new Date());
export const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return fmt(d); };
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000); // b − a

/* ---------- 量と負担 ---------- */
export const TU = m => m.total * m.reps;                    // 全部で何ページ分か
const speedOf = m => (typeof m.speed === 'number' && m.speed > 0 ? m.speed : DEFAULT_SPEED);
export const weight = (m, r) => Math.max(0.1, Math.pow(speedOf(m), r - 1));
export function workAt(m, g) {
  let w = 0;
  for (let r = 1; r <= m.reps; r++) w += Math.min(Math.max(g - (r - 1) * m.total, 0), m.total) * weight(m, r);
  return w;
}
export function posAt(m, w) {
  for (let r = 1; r <= m.reps; r++) {
    const cap = m.total * weight(m, r);
    if (w <= cap + 1e-9) return (r - 1) * m.total + w / weight(m, r);
    w -= cap;
  }
  return TU(m);
}
/** 通し番号 u（1始まり）が何周目の何ページか */
export const where = (m, u) => { const r = Math.min(m.reps, Math.max(1, Math.ceil(u / m.total))); return { r, p: u - (r - 1) * m.total }; };

/* ---------- 記録の読み取り ---------- */
const entryG = (m, e) => Math.min(TU(m), Math.max(0, (Math.min(e[0], m.reps) - 1) * m.total + Math.min(e[1], m.total)));
export const logList = m => Object.entries(m.log || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1));
/** d より前の日の終わりまでに進んだ位置（通し） */
export function posBefore(m, d) { let g = 0; for (const [k, e] of logList(m)) { if (k < d) g = entryG(m, e); else break; } return g; }
/** d の終わりまでに進んだ位置（通し） */
export function posThrough(m, d) { let g = 0; for (const [k, e] of logList(m)) { if (k <= d) g = entryG(m, e); else break; } return g; }
export const isFinished = (m, d) => posThrough(m, d) >= TU(m);
/** いま取り組んでいる周（全部終わっていれば最後の周） */
export const curRound = (m, g) => Math.min(m.reps, Math.floor(g / m.total) + 1);

/* ---------- 区切り（科目ごとの開始日） ----------
   sections = [{ name, from, to, start }]。1周目は、開始日が来た区切りまでしか進めない。
   2周目からは全部を回す。区切りは from の順に並び、開始日も同じ順か後になる。 */
export const sectionsOf = m => (Array.isArray(m.sections) && m.sections.length ? m.sections : null);
/** 「名前・数・開始日」の並びから区切りを作る */
export function buildSections(rows) {
  let from = 1;
  return rows.map(r => { const sec = { name: r.name, from, to: from + r.count - 1, start: r.start }; from = sec.to + 1; return sec; });
}
/** 日 d に1周目で進めてよい最後のページ（区切りがなければ全部） */
export function availableAt(m, d) {
  const ss = sectionsOf(m);
  if (!ss) return m.total;
  let a = 0;
  for (const sec of ss) { if (sec.start <= d) a = Math.min(m.total, sec.to); else break; }
  return a;
}
/** 日 d のあとで最初に始まる区切り */
export const nextSection = (m, d) => { const ss = sectionsOf(m); return ss ? ss.find(sec => sec.start > d) || null : null; };
/** ページ p が入っている区切り */
export const sectionAt = (m, p) => { const ss = sectionsOf(m); return ss ? ss.find(sec => p >= sec.from && p <= sec.to) || null : null; };

/* ---------- 曜日ごとの量 ----------
   dayWeights = [日, 月, 火, 水, 木, 金, 土] の比率（0 は休み）。無ければ毎日同じ。 */
export function dayWeight(m, day) {
  const w = m.dayWeights;
  if (!Array.isArray(w) || w.length !== 7) return 1;
  const v = Number(w[toDate(day).getDay()]);
  return Number.isFinite(v) && v >= 0 ? v : 1;
}
/** from〜to（両端を含む）の比率の合計 */
export function weightSum(m, from, to) {
  const n = diffDays(from, to) + 1;
  if (n <= 0) return 0;
  const w = m.dayWeights;
  if (!Array.isArray(w) || w.length !== 7) return n;
  const week = [0, 1, 2, 3, 4, 5, 6].reduce((a, i) => a + Math.max(0, Number(w[i]) || 0), 0);
  let sum = Math.floor(n / 7) * week;
  for (let i = 0, d = addDays(from, Math.floor(n / 7) * 7); i < n % 7; i++, d = addDays(d, 1)) sum += dayWeight(m, d);
  return sum;
}

/* ---------- 今日のノルマ ---------- */
export function quota(m, d) {
  const T = TU(m);
  const g0 = posBefore(m, d);
  if (g0 >= T) return { g0, gT: T, units: 0, daysLeft: 0, finished: true };
  const eff = d < m.start ? m.start : d;
  const overdue = d > m.target;
  const base = { g0, daysLeft: Math.max(1, diffDays(eff, m.target) + 1), overdue, beforeStart: d < m.start };
  // 1周目は、開始日が来た区切りまで
  const cap = sectionsOf(m) && g0 < m.total ? availableAt(m, eff) : T;
  if (cap <= g0) return { ...base, gT: g0, units: 0, waiting: true, next: nextSection(m, eff) };
  const wToday = dayWeight(m, eff);
  if (!overdue && wToday === 0) return { ...base, gT: g0, units: 0, rest: true };
  // 残りの負担を、今日から目標日までの曜日の比率で分ける
  const W = workAt(m, T), w0 = workAt(m, g0);
  const wsum = overdue ? 1 : weightSum(m, eff, m.target);
  const share = overdue ? 1 : (wsum > 0 ? wToday / wsum : 1);
  let target = posAt(m, w0 + (W - w0) * share);
  // 区切りがあるときは、いま開いている分を、次の区切りが始まる前日までに終える量にする
  const nx = g0 < m.total ? nextSection(m, eff) : null;
  if (nx && !overdue) {
    const wn = weightSum(m, eff, addDays(nx.start, -1));
    target = Math.max(target, wn > 0 ? g0 + (cap - g0) * wToday / wn : cap);
  }
  const gT = Math.min(cap, Math.max(Math.ceil(target - 1e-6), g0 + 1));
  return { ...base, gT, units: gT - g0 };
}
/** 昨日の終わりの位置と、最初の計画との差（＋は先行。単位はページ） */
export function pace(m, d) {
  if (d <= m.start) return null;
  const totalDays = diffDays(m.start, m.target) + 1;
  const elapsed = Math.min(totalDays, diffDays(m.start, d));
  const planned = Math.round(posAt(m, workAt(m, TU(m)) * elapsed / totalDays));
  return posBefore(m, d) - planned;
}
/** 'done'（終わった後）| 'full'（ノルマ達成）| 'part'（一部）| 'zero'（記録なし）| 'none'（開始前・休み・区切り待ち） */
export function dayStatus(m, d) {
  if (d < m.start) return 'none';
  if (posBefore(m, d) >= TU(m)) return 'done';
  const q = quota(m, d);
  if (q.units === 0) return 'none'; // 休みの日・次の区切りを待っている日
  const done = posThrough(m, d) - q.g0;
  if (done >= q.units) return 'full';
  if (done > 0) return 'part';
  return 'zero';
}

/* ---------- 周回の予定 ---------- */
/** 周ごとの状態。終わった周はその日、残りの周は今のペースで計算した終わる予定日 */
export function roundPlan(m, d) {
  const out = [];
  const list = logList(m);
  const g0 = posBefore(m, d);
  const q = quota(m, d);
  const perDay = q.finished ? 0 : (workAt(m, TU(m)) - workAt(m, g0)) / q.daysLeft;
  const from = d < m.start ? m.start : d;
  for (let r = 1; r <= m.reps; r++) {
    const endG = r * m.total;
    const hit = list.find(([, e]) => entryG(m, e) >= endG);
    if (hit) { out.push({ r, state: 'done', date: hit[0] }); continue; }
    const days = perDay ? (workAt(m, endG) - workAt(m, g0)) / perDay : 0;
    let date = addDays(from, Math.max(0, Math.ceil(days - 1e-9) - 1));
    const ss = sectionsOf(m);
    if (ss && r === 1 && ss[ss.length - 1].start > date) date = ss[ss.length - 1].start; // 最後の区切りが始まる前には終わらない
    if (out.length && out[out.length - 1].date > date) date = out[out.length - 1].date;
    out.push({ r, state: posThrough(m, d) > (r - 1) * m.total ? 'now' : 'plan', date });
  }
  return out;
}

/* ---------- タイル（回転モザイク） ---------- */
/** ページごとの回数と、今日やる範囲の印 */
export function pageStates(m, d) {
  const g = posThrough(m, d);
  const full = Math.floor(g / m.total), rem = g - full * m.total;
  const count = new Array(m.total + 1).fill(0);
  const mark = new Array(m.total + 1).fill('');
  for (let p = 1; p <= m.total; p++) count[p] = Math.min(m.reps, full + (p <= rem ? 1 : 0));
  const q = quota(m, d);
  if (!q.finished) for (let u = Math.max(q.g0, g) + 1; u <= q.gT; u++) mark[where(m, u).p] = 'today';
  if (sectionsOf(m) && g < m.total) for (let p = availableAt(m, d) + 1; p <= m.total; p++) mark[p] = 'lock'; // まだ始まっていない区切り
  return { count, mark };
}

/* ---------- 記録の更新（新しいオブジェクトを返す） ---------- */
const cloneM = m => ({ ...m, log: { ...(m.log || {}) } });
/** 日 d に「r周目の p まで進んだ」。戻り値 { m } か { error } */
export function recordProgress(m0, d, r, p) {
  if (!Number.isInteger(r) || r < 1 || r > m0.reps) return { error: `周目は 1〜${m0.reps} で選んでください` };
  if (!Number.isInteger(p) || p < 0 || p > m0.total) return { error: `0〜${m0.total} の数字を入れてください` };
  if (logList(m0).some(([k]) => k > d)) return { error: 'この日より後の記録があるため、この日の分は入れられません。記録の一覧で後の日を取り消してから入れてください' };
  const before = posBefore(m0, d);
  const g = (r - 1) * m0.total + p;
  if (g < before) {
    const w = where(m0, before);
    return { error: `前の日までに ${w.r}周目の${w.p}まで進んでいます。それより前に戻すときは、記録の一覧で取り消してください` };
  }
  const m = cloneM(m0);
  if (g === before) delete m.log[d]; else m.log[d] = [r, p];
  return { m };
}
/** 日 d の記録を取り消す */
export function undoDay(m0, d) { const m = cloneM(m0); delete m.log[d]; return { m }; }

/* ---------- 前の形（毎日復習）の記録を引き継ぐ ---------- */
/** batches（新しく学んだ範囲と復習の記録）を「1周目のどこまで進んだか」の記録に置き換える */
export function migrate(m) {
  if (!m.batches) return m;
  const out = { ...m, log: { ...(m.log || {}) }, speed: typeof m.speed === 'number' ? m.speed : DEFAULT_SPEED };
  const days = [...new Set(m.batches.map(b => b.done[0]))].sort();
  for (const day of days) {
    const g = Math.min(m.total, Math.max(...m.batches.filter(b => b.done[0] <= day).map(b => b.to)));
    if (!out.log[day]) out.log[day] = [1, g];
  }
  delete out.batches;
  delete out.intervals;
  return out;
}

/* ---------- 連続達成・連続未達成 ---------- */
/** その日、進行中の教材すべてでノルマを達成したか（true / false）。進行中の教材がなければ null */
function allMet(mats, day) {
  const act = mats.filter(m => { const s = dayStatus(m, day); return s !== 'none' && s !== 'done'; });
  if (!act.length) return null;
  return act.every(m => dayStatus(m, day) === 'full');
}
/** 連続達成の日数。今日がまだ途中なら昨日から数える（今日やれば続く） */
export function streak(mats, d) {
  let n = 0, day = d;
  if (allMet(mats, day) !== true) day = addDays(day, -1);
  const first = mats.reduce((a, m) => (a && a < m.start ? a : m.start), null);
  for (let i = 0; i < 1500 && first && day >= first; i++, day = addDays(day, -1)) {
    const r = allMet(mats, day);
    if (r === true) n++;
    else if (r === false) break;
  }
  return n;
}
/** ノルマに届かなかった日（記録なし・一部だけ）が、昨日まで何日続いているか。今日ノルマを達成していれば 0 */
export function missStreak(mats, d) {
  if (allMet(mats, d) === true) return 0;
  let n = 0, day = addDays(d, -1);
  for (let i = 0; i < 1500; i++, day = addDays(day, -1)) {
    if (allMet(mats, day) === false) n++;
    else break; // 達成した日・開始前の日で止める
  }
  return n;
}

/* ---------- 入力チェック ---------- */
export function validateMaterial(v) {
  if (!v.name) return '教材の名前を入れてください。';
  if (!Number.isInteger(v.total) || v.total < 1 || v.total > 5000) return 'ページ数・問題数は 1〜5000 の数字で入れてください。';
  if (!v.start || !v.target) return '開始日と目標日を入れてください。';
  if (diffDays(v.start, v.target) < 1) return '目標日は開始日より後の日にしてください。';
  if (!Number.isInteger(v.reps) || v.reps < 1 || v.reps > 10) return '目標の回転数は 1〜10 の数字で入れてください。';
  if (!SPEEDS.some(([s]) => s === v.speed)) return '2周目以降の速さを選んでください。';
  if (v.sections) {
    let prev = '';
    for (const [i, sec] of v.sections.entries()) {
      if (!sec.name) return `区切り ${i + 1} の名前を入れてください。`;
      if (!Number.isInteger(sec.to - sec.from + 1) || sec.to < sec.from) return `区切り「${sec.name}」の数は 1 以上の数字で入れてください。`;
      if (!sec.start) return `区切り「${sec.name}」の開始日を入れてください。`;
      if (sec.start < prev) return `区切り「${sec.name}」の開始日は、上の区切りと同じ日か後の日にしてください。`;
      prev = sec.start;
    }
    if (v.sections[v.sections.length - 1].to !== v.total) return '区切りの数の合計が、ページ数・問題数と合いません。';
  }
  return '';
}
