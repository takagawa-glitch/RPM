// RPM の計算部分。画面や保存には触れない（node のテストからも読み込む）。
//
// 考え方
// - 教材は「ページ（または問題）」の並び。新しく進めた範囲を「まとまり（batch）」として記録する。
//   batch = { from, to, done: ['初めて学んだ日', '1回目の復習日', ...] }
// - 各ページを「目標の回転数」回やったら完了。1回目は新しく学ぶ日、2回目以降は復習。
// - 復習の日はエビングハウスの忘却曲線にもとづく間隔（既定 1→3→7→14→30日）で決める。
//   間隔は「前回やった日」から数える。遅れて復習したら、次はその日から数え直す。
// - 新しく進める量 = まだ学んでいないページ ÷ 新しく学ぶ締切日までの残り日数（今日を含む）。
//   締切日 = 目標日 − 復習間隔の合計。最後に学んだページの復習が目標日に終わるようにするため。
// - 期間が短くて間に合わないときは、新しく学ぶ期間が全体の半分は取れるよう、間隔を縮める。

export const DEFAULT_INTERVALS = [1, 3, 7, 14, 30];

/* ---------- 日付（'YYYY-MM-DD' の文字列で扱う） ---------- */
const pad = n => String(n).padStart(2, '0');
export const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayStr = () => fmt(new Date());
export const addDays = (s, n) => { const d = toDate(s); d.setDate(d.getDate() + n); return fmt(d); };
export const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000); // b − a
const sum = a => a.reduce((x, y) => x + y, 0);
const last = a => a[a.length - 1];

/* ---------- 復習の間隔 ---------- */
export function parseIntervals(text) {
  const iv = String(text).split(/[,、\s→]+/).filter(Boolean).map(Number);
  if (!iv.length || iv.some(x => !Number.isInteger(x) || x < 1 || x > 365)) return null;
  for (let i = 1; i < iv.length; i++) if (iv[i] < iv[i - 1]) return null;
  return iv;
}
/** 目標の回転数に必要な数だけの間隔（足りなければ最後の間隔の2倍ずつ足す） */
export function baseIntervals(m) {
  const iv = (m.intervals && m.intervals.length ? m.intervals : DEFAULT_INTERVALS).slice();
  while (iv.length < m.reps - 1) iv.push(last(iv) * 2);
  return iv.slice(0, Math.max(0, m.reps - 1));
}
/** 実際に使う間隔。期間に収まらないときは縮める */
export function effIntervals(m) {
  const iv = baseIntervals(m);
  const S = sum(iv);
  const limit = Math.floor(diffDays(m.start, m.target) / 2);
  if (S <= limit || S === 0) return iv;
  const f = limit / S;
  return iv.map(x => Math.max(1, Math.round(x * f)));
}
export const isCompressed = m => sum(effIntervals(m)) < sum(baseIntervals(m));
/** 新しく学ぶ締切日 */
export function newCutoff(m) {
  const c = addDays(m.target, -sum(effIntervals(m)));
  return c < m.start ? m.start : c;
}

/* ---------- 記録の読み取り ---------- */
const batches = m => (m.batches || []).slice().sort((a, b) => a.from - b.from);
/** d より前の日までに学んだ最後のページ */
export function learnedBefore(m, d) {
  let g = 0;
  for (const b of m.batches || []) if (b.done[0] < d) g = Math.max(g, b.to);
  return Math.min(g, m.total);
}
/** d の終わりまでに学んだ最後のページ */
export function learnedThrough(m, d) {
  let g = 0;
  for (const b of m.batches || []) if (b.done[0] <= d) g = Math.max(g, b.to);
  return Math.min(g, m.total);
}
/** 次の復習日（完了していれば null） */
export function nextDue(m, b) {
  const k = b.done.length;
  if (k >= m.reps) return null;
  return addDays(last(b.done), effIntervals(m)[k - 1]);
}
export const isComplete = (m, b) => b.done.length >= m.reps;
export function isFinished(m, d) {
  if (learnedThrough(m, d) < m.total) return false;
  return (m.batches || []).every(b => b.done.filter(x => x <= d).length >= m.reps);
}

/* ---------- 今日やること ---------- */
/** 新しく進める量 */
export function newQuota(m, d) {
  const g0 = learnedBefore(m, d);
  const cutoff = newCutoff(m);
  if (g0 >= m.total) return { g0, gT: m.total, units: 0, daysLeft: 0, cutoff, allLearned: true };
  const eff = d < m.start ? m.start : d;
  const daysLeft = Math.max(1, diffDays(eff, cutoff) + 1);
  const units = Math.ceil((m.total - g0) / daysLeft);
  return { g0, gT: Math.min(m.total, g0 + units), units, daysLeft, cutoff, overdue: d > cutoff, beforeStart: d < m.start };
}
/** 今日の復習。due: まだの分（遅れを含む）、doneToday: 今日終えた分 */
export function reviewsFor(m, d) {
  const due = [], doneToday = [];
  for (const b of batches(m)) {
    if (b.done.length >= 2 && last(b.done) === d) { doneToday.push({ b, rep: b.done.length }); continue; }
    const n = nextDue(m, b);
    if (n && n <= d && last(b.done) < d) due.push({ b, rep: b.done.length + 1, dueDate: n, late: diffDays(n, d) });
  }
  return { due, doneToday };
}
export const pagesOf = items => sum(items.map(x => x.b.to - x.b.from + 1));

/** 過去の日の達成状況（日ごとのモザイク用） */
export function dayStats(m, d) {
  const q = newQuota(m, d);
  const newDone = Math.max(0, learnedThrough(m, d) - q.g0);
  let revDue = 0, revDone = 0;
  const iv = effIntervals(m);
  for (const b of m.batches || []) {
    for (let k = 1; k < m.reps; k++) {
      const prev = b.done[k - 1];
      if (!prev || prev >= d) break;
      const due = addDays(prev, iv[k - 1]);
      if (due > d) break;
      const at = b.done[k];
      if (at === undefined || at >= d) { revDue++; if (at === d) revDone++; break; }
    }
  }
  return { newQuota: q.beforeStart ? 0 : q.units, newDone, revDue, revDone };
}
/** 'done'（完了済み）| 'full'（やることを全部やった）| 'part'（一部）| 'zero'（記録なし）| 'none'（やることがない日） */
export function dayStatus(m, d) {
  if (d < m.start) return 'none';
  if (isFinished(m, addDays(d, -1))) return 'done';
  const s = dayStats(m, d);
  const need = s.newQuota + s.revDue;
  if (need === 0) return 'none';
  if (s.newDone >= s.newQuota && s.revDone >= s.revDue) return 'full';
  if (s.newDone > 0 || s.revDone > 0) return 'part';
  return 'zero';
}
/** 新しく学ぶペース（昨日の終わりの位置と最初の計画の差。＋は先行） */
export function pace(m, d) {
  if (d <= m.start) return null;
  const days = diffDays(m.start, newCutoff(m)) + 1;
  const elapsed = Math.min(days, diffDays(m.start, d));
  return learnedBefore(m, d) - Math.round(m.total * elapsed / days);
}

/* ---------- タイル（回転モザイク） ---------- */
/** ページごとの回数と、今日やる・復習が遅れているかの印 */
export function pageStates(m, d) {
  const count = new Array(m.total + 1).fill(0);
  const mark = new Array(m.total + 1).fill('');
  for (const b of m.batches || []) {
    const c = b.done.filter(x => x <= d).length;
    const n = nextDue(m, b);
    const late = n && n < d && last(b.done) < d;
    const due = n && n <= d && last(b.done) < d;
    for (let p = b.from; p <= Math.min(b.to, m.total); p++) {
      count[p] = c;
      mark[p] = late ? 'late' : due ? 'today' : '';
    }
  }
  const q = newQuota(m, d);
  for (let p = Math.max(q.g0, learnedThrough(m, d)) + 1; p <= q.gT; p++) mark[p] = 'today';
  return { count, mark };
}

/* ---------- 記録の更新（新しいオブジェクトを返す） ---------- */
const cloneM = m => ({ ...m, batches: (m.batches || []).map(b => ({ ...b, done: b.done.slice() })) });

/** 「p まで進んだ」（日 d）。戻り値 { m } か { error } */
export function recordNew(m0, d, p) {
  const m = cloneM(m0);
  if (!Number.isInteger(p) || p < 0 || p > m.total) return { error: `0〜${m.total} の数字を入れてください` };
  const before = learnedBefore(m, d);
  const after = (m.batches || []).filter(b => b.done[0] > d);
  if (after.length) return { error: 'この日より後の記録があるため、この日の分は追加できません' };
  if (p < before) return { error: `前の日までに ${before} まで進んでいます。それより前に戻すときは、記録の一覧で取り消してください` };
  const i = m.batches.findIndex(b => b.done[0] === d && b.done.length === 1);
  if (i >= 0) {
    if (p <= m.batches[i].from - 1) m.batches.splice(i, 1);
    else m.batches[i].to = p;
  } else if (p > before) {
    if (m.batches.some(b => b.done[0] === d)) return { error: 'この日の分はすでに復習まで進んでいます。記録の一覧で取り消してから入れ直してください' };
    m.batches.push({ from: before + 1, to: p, done: [d] });
  }
  return { m };
}
/** まとまり（from で特定）の復習を日 d に終えた */
export function recordReview(m0, from, d) {
  const m = cloneM(m0);
  const b = m.batches.find(x => x.from === from);
  if (!b || isComplete(m, b) || last(b.done) >= d) return { m: m0 };
  b.done.push(d);
  return { m };
}
/** まとまりの最後の1回を取り消す（新しく学んだ日しかなければ、まとまりごと消す） */
export function undoLast(m0, from) {
  const m = cloneM(m0);
  const i = m.batches.findIndex(x => x.from === from);
  if (i < 0) return { m: m0 };
  const b = m.batches[i];
  if (b.done.length > 1) b.done.pop();
  else {
    if (m.batches.some(x => x.from > b.from)) return { error: 'これより後のページの記録があるため取り消せません。後の記録から順に取り消してください' };
    m.batches.splice(i, 1);
  }
  return { m };
}

/* ---------- 連続達成 ---------- */
export function streak(mats, d) {
  const allMet = day => {
    const act = mats.filter(m => dayStatus(m, day) !== 'none' && dayStatus(m, day) !== 'done');
    if (!act.length) return null;
    return act.every(m => dayStatus(m, day) === 'full');
  };
  let n = 0, day = d;
  if (allMet(day) !== true) day = addDays(day, -1);
  const first = mats.reduce((a, m) => (a && a < m.start ? a : m.start), null);
  for (let i = 0; i < 1500 && first && day >= first; i++, day = addDays(day, -1)) {
    const r = allMet(day);
    if (r === true) n++;
    else if (r === false) break;
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
  if (!v.intervals) return '復習の間隔は「1,3,7,14,30」のように、小さい順の日数で入れてください。';
  return '';
}
