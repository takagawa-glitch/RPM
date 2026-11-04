// RPM の画面。計算は plan.js、保存は store.js。
// 目標（例: 社労士試験・試験日）の中に教材をまとめる。教材の目標日は、試験日と同じにするか、教材ごとに決める。
// 教材は周回型: p.1 から最後まで回り、2周目、3周目……と後の周ほど速く回る（plan.js）。
import * as P from './plan.js?v=20261104f';
import { createStore, cloudAvailable, authMessage } from './store.js?v=20261104f';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = s => { const d = P.toDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = s => { const d = P.toDate(s); return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; };
const ymdw = s => { const d = P.toDate(s); return `${d.getFullYear()}年${mdw(s)}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uw = m => (m.unit === 'q' ? '問' : m.unit === 'k' ? '回' : 'ページ');
const pos = (m, p) => (m.unit === 'q' ? `問${p}` : m.unit === 'k' ? `第${p}回` : `p.${p}`);
const range = (m, a, b) => (a === b ? pos(m, a) : m.unit === 'k' ? `第${a}〜${b}回` : `${pos(m, a)}〜${b}`);
const uid = () => Math.random().toString(36).slice(2, 10);
// 本試験の科目（点数の記録で使う）。足切りの目安は 択一=各科目4点未満、選択=各科目3点未満（年によって補正あり）
const TAKU = ['労基・安衛', '労災・徴収', '雇用・徴収', '一般常識', '健保', '厚年', '国年'];
const SEN = ['労基・安衛', '労災', '雇用', '労一', '社一', '健保', '厚年', '国年'];
const KINDS = { taku: { label: '択一式（模試・本試験）', max: 70, subj: TAKU, per: 10, cut: 4 }, sen: { label: '選択式（模試・本試験）', max: 40, subj: SEN, per: 5, cut: 3 }, ans: { label: '答練・小テスト', max: '', subj: null } };
const WEIGHT_OPTS = [0, 0.5, 1, 1.5, 2, 2.5, 3];
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
// 版: index.html で読み込むときの ?v= の値（例: 20261104f → 2026.11.04d）。更新のたびに変える（CLAUDE.md の「更新するとき」）
const VER_RAW = new URL(import.meta.url).searchParams.get('v') || '';
const verText = v => (/^\d{8}/.test(v) ? `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6, 8)}${v.slice(8)}` : (v || '開発中'));
const VERSION = verText(VER_RAW);

const ui = { newVer: '', view: 'home', id: null, confirmDel: false, formErr: '', acctMsg: '', acctErr: '', busy: false, presetGoal: null, scorePrefill: null, pendingImport: null };
// 記録が届いたら描き直す（入力中の登録画面は消さない）
const store = createStore(() => { if (ui.view !== 'form' && ui.view !== 'goalform') render(); });

/* ---------- 目標と教材 ---------- */
const goalById = id => store.goals.find(g => g.id === id) || null;
const goalOf = m => (m.goalId ? goalById(m.goalId) : null);
/** 試験日に合わせる教材は、目標日を試験日に置き換えて計算する */
// 前の形（毎日復習）の記録は、1周目の進みとして読み替える（次に保存したときに新しい形で保存される）
// 目標の「曜日ごとの量」も教材の計算に渡す
const resolve = m0 => { const m = P.migrate(m0); const g = goalOf(m); if (!g) return m; return { ...m, target: m.followGoal ? g.examDate : m.target, dayWeights: g.dayWeights || null }; };
const allMats = () => store.mats.map(resolve).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
const byId = id => { const m = store.mats.find(x => x.id === id); return m ? resolve(m) : null; };
const goalsSorted = () => store.goals.slice().sort((a, b) => (a.examDate < b.examDate ? -1 : a.examDate > b.examDate ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
const matsOfGoal = g => allMats().filter(m => m.goalId === g.id);

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}
function save(col, obj, msg) {
  store.save(col, obj).catch(() => toast(store.mode === 'cloud'
    ? '保存できませんでした。通信状態を確かめて、もう一度お試しください。'
    : 'この端末に保存できませんでした。ブラウザの設定（プライベートモードなど）を確かめてください。'));
  if (msg) toast(msg);
}
const saveMat = (m, msg) => save('materials', m, msg);

/* ---------- 画面の明るさ ---------- */
const THEME_KEY = 'rpm-theme';
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'light'; } catch (e) { return 'light'; } };
function setTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 保存できなくても表示は変える */ }
  document.documentElement.dataset.theme = t;
}

/* ---------- 部品 ---------- */
function tileColor(m, c) {
  if (c <= 0) return '';
  const pct = m.reps === 1 ? 100 : Math.round(28 + 72 * (c - 1) / (m.reps - 1));
  return `background:color-mix(in oklch, var(--rev) ${pct}%, var(--rev-lo))`;
}
function tiles(m, count, mark, from, to, k) {
  let html = '';
  for (let s = from; s <= to; s += k) {
    const e = Math.min(to, s + k - 1);
    let c = Infinity, mk = '';
    for (let p = s; p <= e; p++) { c = Math.min(c, count[p]); if (mark[p] && mk !== 'today') mk = mark[p]; }
    const ls = local(m, s), le = local(m, e);
    const tip = `${m.name} ${ls.sec ? `${ls.sec.name} ${range(m, ls.n, ls.sec === le.sec ? le.n : ls.sec.to - ls.sec.from + 1)}` : range(m, s, e)}：${mk === 'lock' ? 'まだ始まっていない区切り' : `${c}回${mk === 'today' ? '・今日やる' : ''}`}`;
    html += `<i class="${mk}" style="${mk === 'lock' ? '' : tileColor(m, c)}" title="${esc(tip)}"></i>`;
  }
  return html;
}
function mosaic(m, d, size) {
  const { count, mark } = P.pageStates(m, d);
  const k = Math.ceil(m.total / (size === 'mini' ? 240 : 600)); // 多いときは数ページを1タイルにまとめる
  const ss = P.sectionsOf(m);
  if (ss && !size) {
    return `<div class="secm">${ss.map(sec => `<div class="gm-row"><span class="gm-name">${esc(sec.name)} <small>${md(sec.start)}〜</small></span><div class="mosaic">${tiles(m, count, mark, sec.from, Math.min(sec.to, m.total), k)}</div></div>`).join('')}</div>`;
  }
  return `<div class="mosaic ${size || ''}" role="img" aria-label="${esc(m.name)}の回転モザイク">${tiles(m, count, mark, 1, m.total, k)}</div>`;
}
function mosaicLegend(reps) {
  const m = { reps };
  const steps = reps <= 6 ? [...Array(reps)].map((_, i) => i + 1) : [1, Math.ceil(reps / 2), reps];
  return `<div class="legend"><span><i></i>まだ</span>${steps.map(c => `<span><i style="${tileColor(m, c)}"></i>${c}回</span>`).join('')}
    <span><i class="today"></i>今日やる</span><span><i class="lock"></i>まだ始まっていない区切り</span></div>`;
}
const legendRel = `<div class="legend"><span><i></i>まだ</span><span><i style="background:color-mix(in oklch, var(--rev) 28%, var(--rev-lo))"></i>1回</span><span><i style="background:color-mix(in oklch, var(--rev) 64%, var(--rev-lo))"></i>半分</span><span><i style="background:var(--rev)"></i>目標の回数</span>
  <span><i class="today"></i>今日やる</span><span><i class="lock"></i>まだ始まっていない区切り</span></div>`;

/** 日ごとのモザイク。statusOf(day) が 'full'|'part'|'zero'|'none'|'done' を返す */
function calendar(start, end, d, statusOf, marks) {
  let html = '';
  for (let i = 0; i < P.toDate(start).getDay(); i++) html += '<i class="blank"></i>';
  const names = { full: '全部できた', part: '一部だけ', zero: '記録なし', none: 'やる分なし（開始前・休み・区切り待ち）', done: '完了後' };
  for (let i = 0; i <= P.diffDays(start, end); i++) {
    const day = P.addDays(start, i);
    let cls, tip;
    if (day > d) { cls = 'future'; tip = '予定'; }
    else { const st = statusOf(day); cls = 's-' + st; tip = day === d && (st === 'part' || st === 'zero') ? '今日（途中）' : names[st]; }
    if (day === d) cls += ' is-today';
    if (marks[day]) { cls += ' is-mark'; tip += '・' + marks[day]; }
    html += `<i class="${cls}" title="${mdw(day)}：${tip}"></i>`;
  }
  const dl = WD.map((w, i) => `<span>${i % 2 ? w : ''}</span>`).join('');
  return `<div class="cal-wrap"><div class="cal-days">${dl}</div><div class="cal-scroll"><div class="cal" role="img" aria-label="日ごとの達成モザイク">${html}</div></div></div>
  <div class="legend"><span><i class="s-full"></i>全部できた</span><span><i class="s-part"></i>一部だけ</span><span><i class="s-zero"></i>記録なし</span><span><i class="s-none"></i>やる分なし</span><span><i class="future"></i>これから</span><span><i class="future is-mark"></i>${Object.values(marks).some(v => v.includes('試験日')) ? '試験日・予定' : '目標日'}</span></div>`;
}
function goalDayStatus(mats, day) {
  const sts = mats.map(m => P.dayStatus(m, day)).filter(s => s !== 'none' && s !== 'done');
  if (!sts.length) return mats.length && mats.every(m => P.isFinished(m, P.addDays(day, -1))) ? 'done' : 'none';
  if (sts.every(s => s === 'full')) return 'full';
  if (sts.some(s => s === 'full' || s === 'part')) return 'part';
  return 'zero';
}
/** 周回の予定（帯と一覧） */
function roundsPanel(m, d, withList = true) {
  const plan = P.roundPlan(m, d);
  const segs = plan.map((x, i) => {
    const s = i === 0 ? m.start : P.addDays(plan[i - 1].date, 1);
    return { ...x, s, days: Math.max(1, P.diffDays(s, x.date) + 1) };
  });
  const bar = segs.map(x => `<i class="rp-${x.state}" style="flex-grow:${x.days};${tileColor(m, x.r)}" title="${x.r}周目 ${md(x.s)}〜${md(x.date)}"><span>${x.r}</span></i>`).join('');
  const rows = segs.map(x => `<li class="rp-${x.state}"><b>${x.r}周目</b><span>${x.state === 'done' ? `✓ ${mdw(x.date)}に終わりました`
    : x.state === 'now' ? `いまここ・${mdw(x.date)}ごろ終わる予定`
    : `${md(x.s)}〜${md(x.date)}（${x.days}日）の予定`}</span></li>`).join('');
  return `<div class="rp" role="img" aria-label="周回の予定">${bar}</div>${withList ? `<ol class="rp-list">${rows}</ol>` : ''}`;
}
function today(m, d) {
  const q = P.quota(m, d);
  const done = Math.max(0, P.posThrough(m, d) - q.g0);
  return { q, done, left: Math.max(0, q.units - done), finished: P.isFinished(m, d) };
}
function statusPill(m, d) {
  const t = today(m, d);
  if (t.finished) return '<span class="pill rev">完了</span>';
  if (t.q.beforeStart) return `<span class="pill muted">${md(m.start)}から開始</span>`;
  if (t.q.rest) return '<span class="pill muted">休みの日</span>';
  if (t.q.waiting) return `<span class="pill good">${t.q.next ? `次は${md(t.q.next.start)}から` : '開いている分は完了'}</span>`;
  let s;
  if (!t.left) s = '<span class="pill good">今日のノルマ達成</span>';
  else s = `<span class="pill hot">あと ${t.left}${uw(m)}</span>`;
  if (t.q.overdue) s += ' <span class="pill late">目標日を過ぎています</span>';
  return s;
}
function paceText(m, d) {
  const p = P.pace(m, d);
  if (p === null || P.isFinished(m, d)) return '';
  if (p === 0) return 'ペース: 予定どおり';
  return p > 0 ? `ペース: 予定より ${p}${uw(m)} 先行` : `ペース: 予定より ${-p}${uw(m)} 遅れ`;
}
const sumCount = (m, d) => { const { count } = P.pageStates(m, d); let s = 0; for (let p = 1; p <= m.total; p++) s += count[p]; return s; };
const avgRot = (m, d) => sumCount(m, d) / m.total;
function daysTo(date, d) {
  const n = P.diffDays(d, date);
  return n > 0 ? `あと <b class="num">${n}</b> 日` : n === 0 ? '<b>今日</b>' : '終了';
}
/** 区切りがあるときは、区切りの中の番号（例: 労基2 の問3）で表す */
const local = (m, p) => { const sec = P.sectionAt(m, p); return sec ? { sec, n: p - sec.from + 1 } : { sec: null, n: p }; };
const lpos = (m, p) => { const l = local(m, p); return `${l.sec ? `［${esc(l.sec.name)}］` : ''}${pos(m, l.n)}`; };
const at = (m, u) => { const w = P.where(m, u); return `${w.r}周目 ${lpos(m, w.p)}`; };
function quotaBlock(m, d, t) {
  if (t.q.rest) return `<div class="task"><div class="task-h"><span class="label">今日のノルマ</span></div><div class="sub">今日は休みの日です（目標の「曜日ごとの量」で0にしている曜日）。</div>${recForm(m, d, false)}</div>`;
  if (t.q.waiting) return `<div class="task"><div class="task-h"><span class="label">今日のノルマ</span><span class="ok">✓ 開いている分は完了</span></div>
    <div class="sub">いま解ける範囲は1周目を終えました。${t.q.next ? `次は <b>${mdw(t.q.next.start)}</b> から「${esc(t.q.next.name)}」が始まります。` : ''}</div>${recForm(m, d, false)}</div>`;
  const bar = t.q.units ? Math.min(100, Math.round(t.done / t.q.units * 100)) : 100;
  return `<div class="task">
    <div class="task-h"><span class="label">${t.q.beforeStart ? '開始日のノルマ' : '今日のノルマ'}</span>${t.left || t.q.beforeStart ? '' : '<span class="ok">✓ 達成</span>'}</div>
    <div class="big"><span class="n num">${t.q.units}</span><span class="u">${uw(m)}</span></div>
    <div class="rg"><b>${at(m, t.q.g0 + 1)}</b> から <b>${at(m, t.q.gT)}</b> まで</div>
    <div class="bar" title="今日の進み ${t.done}/${t.q.units}"><i style="width:${bar}%"></i></div>
    ${t.q.beforeStart ? '' : recForm(m, d, false)}
  </div>`;
}
function recForm(m, d, withDate) {
  const g = P.posThrough(m, d);
  const q = P.quota(m, d);
  const r = P.curRound(m, Math.max(g, q.g0));
  const opts = [...Array(m.reps)].map((_, i) => `<option value="${i + 1}"${i + 1 === r ? ' selected' : ''}>${i + 1}周目</option>`).join('');
  const ph = q.finished ? m.total : P.where(m, q.gT).p;
  const ss = P.sectionsOf(m);
  const cur = ss ? local(m, Math.max(1, ph)) : null;
  return `<form class="rec" data-rec="${m.id}">
    ${withDate ? `<input type="date" id="rd-${m.id}" value="${d}" max="${P.todayStr()}" min="${m.start}" aria-label="日付">` : ''}
    <select id="rr-${m.id}" aria-label="周目">${opts}</select>
    ${ss ? `<select id="rs-${m.id}" aria-label="区切り">${ss.map((sec, i) => `<option value="${i}"${sec === cur.sec ? ' selected' : ''}>${esc(sec.name)}</option>`).join('')}</select>` : ''}
    <span class="lbl">${m.unit === 'q' ? '問' : m.unit === 'k' ? '第' : 'p.'}</span>
    <input type="number" id="rp-${m.id}" min="0" max="${ss ? cur.sec.to - cur.sec.from + 1 : m.total}" inputmode="numeric" placeholder="${ss ? cur.n : ph}" aria-label="どこまで進んだか">
    <span class="lbl">${m.unit === 'k' ? '回' : ''}まで進んだ</span>
    <button class="btn primary" type="submit">記録</button>
  </form>`;
}

/* ---------- 予定（答練・模試など） ---------- */
const eventsOf = g => (g.events || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
/** 最初の画面に出す予定: 過ぎたのにまだの分（2週間以内）と、これから1週間の分 */
function weekEvents(g, d) {
  const from = P.addDays(d, -14), to = P.addDays(d, 6);
  return eventsOf(g).filter(ev => !ev.done && ev.date >= from && ev.date <= to);
}
function eventItem(g, ev, d, withTools) {
  const late = !ev.done && ev.date < d;
  return `<li class="ev${ev.done ? ' done' : ''}${late ? ' late' : ''}${ev.date === d ? ' now' : ''}">
    <label class="check"><input type="checkbox" data-evdone="${g.id}|${ev.id}"${ev.done ? ' checked' : ''}> <span class="ev-d num">${mdw(ev.date)}</span> <span class="ev-t">${esc(ev.title)}</span></label>
    ${late ? '<span class="late-t">まだ</span>' : ''}
    ${withTools ? `<span class="ev-tools"><button class="btn ghost sm" data-act="scorefrom" data-id="${g.id}" data-ev="${ev.id}">点数を記録</button><button class="btn ghost sm" data-act="delev" data-id="${g.id}" data-ev="${ev.id}" aria-label="予定を削除">削除</button></span>` : ''}
  </li>`;
}
function eventsPanel(g, d) {
  const list = eventsOf(g);
  const next = list.filter(ev => ev.date >= d && !ev.done)[0];
  // まだの分（過ぎたもの）と、これからの5件だけを先に出す。全部は「すべての予定」を開く
  const soon = [...list.filter(ev => ev.date < d && !ev.done), ...list.filter(ev => ev.date >= d && !ev.done).slice(0, 5)];
  return `<section class="panel" id="events">
    <h2>予定 <span class="label">答練・模試・講座など。終わったらチェック</span></h2>
    ${next ? `<div class="sub">次の予定: ${mdw(next.date)} ${esc(next.title)}（${daysTo(next.date, d)}）</div>` : ''}
    ${soon.length ? `<ul class="evs">${soon.map(ev => eventItem(g, ev, d, true)).join('')}</ul>` : (list.length ? '' : '<div class="sub">まだ予定がありません。</div>')}
    ${list.length ? `<details class="evall"><summary>すべての予定（${list.length}件・済み ${list.filter(ev => ev.done).length}件）</summary><ul class="evs">${list.map(ev => eventItem(g, ev, d, true)).join('')}</ul></details>` : ''}
    <form class="rec" id="evform" data-goal="${g.id}">
      <input type="date" id="ev-date" value="${d}" aria-label="予定の日付">
      <input id="ev-title" maxlength="40" placeholder="例: 山川答練 労基1" aria-label="予定の名前" class="grow">
      <button class="btn" type="submit">予定を追加</button>
    </form>
  </section>`;
}

/* ---------- 点数の記録 ---------- */
const scoresOf = g => (g.scores || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
/** 点数の推移（得点率）の折れ線 */
function scoreChart(g) {
  const list = scoresOf(g).filter(x => x.max > 0);
  if (list.length < 1) return '';
  const W = 640, H = 200, L = 36, R = 12, T = 12, B = 28;
  const x = i => L + (list.length === 1 ? (W - L - R) / 2 : i * (W - L - R) / (list.length - 1));
  const y = v => T + (1 - v) * (H - T - B);
  const series = kind => list.map((s, i) => ({ s, i })).filter(o => o.s.kind === kind);
  const line = (pts, cls) => pts.length > 1 ? `<polyline class="${cls}" points="${pts.map(o => `${x(o.i)},${y(o.s.score / o.s.max)}`).join(' ')}"/>` : '';
  const dots = (pts, cls) => pts.map(o => `<circle class="${cls}" cx="${x(o.i)}" cy="${y(o.s.score / o.s.max)}" r="4"><title>${esc(`${md(o.s.date)} ${o.s.title}：${o.s.score}/${o.s.max}`)}</title></circle>`).join('');
  const grid = [0, 0.25, 0.5, 0.75, 1].map(v => `<line class="sc-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="sc-ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join('');
  const tgt = g.scoreTarget ? `<line class="sc-tgt" x1="${L}" x2="${W - R}" y1="${y(g.scoreTarget / 70)}" y2="${y(g.scoreTarget / 70)}"/><text class="sc-tgtt" x="${W - R}" y="${y(g.scoreTarget / 70) - 5}" text-anchor="end">択一の目標 ${g.scoreTarget}点</text>` : '';
  const xl = list.map((s, i) => (list.length <= 12 || i % Math.ceil(list.length / 12) === 0) ? `<text class="sc-ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${md(s.date)}</text>` : '').join('');
  const kinds = ['taku', 'sen', 'ans'];
  return `<div class="sc-wrap"><svg class="sc" viewBox="0 0 ${W} ${H}" role="img" aria-label="点数の推移（得点率）">${grid}${tgt}${kinds.map(k => line(series(k), 'sc-l ' + k)).join('')}${kinds.map(k => dots(series(k), 'sc-p ' + k)).join('')}${xl}</svg></div>
  <div class="legend"><span><i class="sc-k taku"></i>択一式</span><span><i class="sc-k sen"></i>選択式</span><span><i class="sc-k ans"></i>答練・小テスト</span>${g.scoreTarget ? '<span><i class="sc-k tgt"></i>択一の目標点</span>' : ''}</div>`;
}
/** いちばん新しい模試・本試験の科目別の点と足切りの目安 */
function cutCheck(g, kind) {
  const K = KINDS[kind];
  const last = scoresOf(g).filter(x => x.kind === kind && x.subjects && Object.keys(x.subjects).length).pop();
  if (!last) return '';
  const rows = K.subj.map(name => {
    const v = last.subjects[name];
    if (v === undefined || v === null || v === '') return '';
    const bad = v < K.cut;
    return `<div class="cmp-row"><span class="cmp-name">${esc(name)}</span><div class="cmp-bar cut" style="--cut:${K.cut / K.per * 100}%"><i class="r${bad ? ' bad' : ''}" style="width:${Math.min(100, v / K.per * 100)}%"></i></div><span class="cmp-v num${bad ? ' miss-s' : ''}">${v}<small>/${K.per}</small></span></div>`;
  }).join('');
  return `<div class="cutbox"><div class="label">${esc(last.title)}（${md(last.date)}）の${kind === 'taku' ? '択一式' : '選択式'}・科目別 <span class="sub">縦の線が足切りの目安（${K.cut}点）。赤は目安より下</span></div><div class="cmp">${rows}</div></div>`;
}
function scoresPanel(g, d) {
  const list = scoresOf(g).reverse();
  const pf = ui.scorePrefill && ui.scorePrefill.goal === g.id ? ui.scorePrefill : null;
  const kind = pf ? pf.kind : 'taku';
  const subjInputs = k => KINDS[k].subj.map((n, i) => `<label class="sj"><span>${esc(n)}</span><input type="number" min="0" max="${KINDS[k].per}" step="1" inputmode="numeric" id="sj-${k}-${i}" aria-label="${esc(n)}の点数"><small>/${KINDS[k].per}</small></label>`).join('');
  const rows = list.map(x => `<tr><td>${mdw(x.date)}</td><td>${esc(x.title)}</td><td>${esc(KINDS[x.kind] ? KINDS[x.kind].label.replace(/（.*）/, '') : '')}</td><td class="num">${x.score}/${x.max}</td><td class="num">${Math.round(x.score / x.max * 100)}%</td><td><button class="btn ghost sm" data-act="delscore" data-id="${g.id}" data-sc="${x.id}">削除</button></td></tr>`).join('');
  return `<section class="panel" id="scores">
    <h2>点数の記録 <span class="label">答練・模試・本試験の点数。推移と足切りの目安を表示</span></h2>
    ${scoreChart(g)}
    ${cutCheck(g, 'taku')}${cutCheck(g, 'sen')}
    <form class="form" id="scoreform" data-goal="${g.id}">
      <div class="field"><label for="sc-date">日付</label><input id="sc-date" type="date" value="${pf ? pf.date : d}" required></div>
      <div class="field"><label for="sc-title">名前</label><input id="sc-title" maxlength="40" value="${esc(pf ? pf.title : '')}" placeholder="例: アドバンス模試" required></div>
      <div class="field"><label for="sc-kind">種類</label><select id="sc-kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="field"><label>点数 / 満点</label><div class="rec"><input id="sc-score" type="number" min="0" step="1" inputmode="numeric" aria-label="点数"> <span class="lbl">/</span> <input id="sc-max" type="number" min="1" step="1" inputmode="numeric" value="${KINDS[kind].max}" aria-label="満点"></div><span class="hint">科目別の点を入れると、合計は自動で計算します。</span></div>
      <div class="full sjbox" data-kind="taku"${kind === 'taku' ? '' : ' hidden'}><div class="label">科目別（任意）</div><div class="sjs">${subjInputs('taku')}</div></div>
      <div class="full sjbox" data-kind="sen"${kind === 'sen' ? '' : ' hidden'}><div class="label">科目別（任意）</div><div class="sjs">${subjInputs('sen')}</div></div>
      <div class="actions full"><button class="btn primary" type="submit">点数を記録</button></div>
    </form>
    ${rows ? `<div class="table-scroll"><table class="log"><thead><tr><th>日付</th><th>名前</th><th>種類</th><th>点数</th><th>得点率</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
  </section>`;
}

/* ---------- 画面 ---------- */
/** 連続達成の日数。できなかった日が続いているときは「-3日」のようにマイナスで赤く出す（ユーザーの指示） */
function streakHtml(mats, d) {
  const st = P.streak(mats, d);
  if (st > 0) return `<span class="streak ok-s">連続達成 <b class="num">${st}</b> 日</span>`;
  const miss = P.missStreak(mats, d);
  if (miss > 0) return `<span class="streak miss-s" title="ノルマに届かなかった日が${miss}日続いています">連続達成 <b class="num">-${miss}</b> 日</span>`;
  return '<span class="streak">連続達成 <b class="num">0</b> 日</span>';
}
function header() {
  const acct = !cloudAvailable() ? '設定' : store.mode === 'cloud' ? '設定（同期中）' : '設定・ログイン';
  return `<div class="top">
    <button class="brand" data-act="home" aria-label="一覧へ"><b>R<i>P</i>M</b><span>回転数で進める学習ノルマ</span></button>
    <div class="top-r">
      <div class="today">今日<strong>${mdw(P.todayStr())}</strong></div>
      <button class="btn sm${store.mode === 'cloud' ? ' synced' : ''}" data-act="account">${acct}</button>
    </div>
  </div>${store.error ? `<div class="note err">${esc(store.error)}</div>` : ''}${ui.newVer ? `<div class="note newver">新しい版（${esc(verText(ui.newVer))}）が公開されています。今は ${esc(VERSION)} です。<div class="actions"><button class="btn primary sm" data-act="reload">新しい版に切り替える</button></div></div>` : ''}`;
}
/** 公開されている最新の版を調べる（index.html の ?v= を読む）。違えば上に知らせる */
async function checkNewVersion() {
  if (!VER_RAW) return;
  try {
    const html = await (await fetch('index.html', { cache: 'no-store' })).text();
    const m = html.match(/js\/app\.js\?v=([\w.-]+)/);
    const latest = m ? m[1] : '';
    if (latest && latest !== VER_RAW && latest !== ui.newVer) { ui.newVer = latest; render(); }
  } catch (e) { /* 通信できないときは何もしない */ }
}
function nag(mats, d) {
  const act = mats.filter(m => { const t = today(m, d); return !t.finished && !t.q.beforeStart && !t.q.rest && !t.q.waiting; });
  if (!act.length) return '';
  const left = act.map(m => ({ m, t: today(m, d) })).filter(x => x.t.left);
  const st = P.streak(mats, d);
  const head = `<div class="summary"><div class="gauge" aria-hidden="true">${act.map((m, i) => `<i class="${i < act.length - left.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="txt">今日の分 <b class="num">${act.length - left.length}</b> / ${act.length} 教材 完了</div><div class="txt streak-wrap">${streakHtml(mats, d)}</div></div>`;
  if (!left.length) return head + '<div class="nag done">今日の分はすべて終わりました。明日もこの調子で。</div>';
  const h = new Date().getHours();
  const miss = P.missStreak(mats, d);
  const keep = st > 0 ? `今日やらないと、${st}日続いた連続達成が 0 に戻ります。` : miss >= 2 ? `${miss}日続けてノルマに届いていません。今日で流れを止めましょう。` : miss === 1 ? '昨日はノルマに届きませんでした。今日取り戻しましょう。' : '';
  const late = left.some(x => (P.pace(x.m, d) || 0) < 0) ? '予定より遅れています。今日の分で取り戻しましょう。' : '';
  let lv, msg;
  if (h < 12) { lv = miss ? 2 : 1; msg = miss ? `${keep}朝のうちに片付けませんか。` : '今日の分を朝のうちに片付けませんか。'; }
  else if (h < 18) { lv = 2; msg = `まだ今日の分が残っています。${late || keep}`; }
  else if (h < 22) { lv = 3; msg = `夜になりました。${keep || late || '今からやりましょう。'}`; }
  else { lv = 4; msg = `今日が終わるまであと${24 - h}時間もありません。${keep}5分だけでも開きましょう。`; }
  const list = left.map(x => `${esc(x.m.name)}（あと${x.t.left}${uw(x.m)}）`).join('、');
  return head + `<div class="nag lv${lv}"><b>${msg}</b><span>${list}</span></div>`;
}
function card(m, d) {
  const t = today(m, d);
  let main;
  if (t.finished) main = `<div class="big"><span class="n num">${m.reps}</span><span class="u">回転 完了</span></div><div class="sub">おつかれさまでした。すべてのページを目標の回数やり終えました。</div>`;
  else main = quotaBlock(m, d, t);
  const own = goalOf(m) && !m.followGoal ? `<span>この教材の目標日 <b class="num">${md(m.target)}</b></span>` : (!goalOf(m) ? `<span>目標日 <b class="num">${md(m.target)}</b></span>` : '');
  return `<article class="card">
    <div class="head"><h3>${esc(m.name)}</h3>${statusPill(m, d)}</div>
    <div class="quota">${main}</div>
    <div class="side">
      ${mosaic(m, d, 'mini')}
      <div class="meta"><span><b class="num">${avgRot(m, d).toFixed(1)}</b> / ${m.reps} 回転</span>${own}</div>
      <div class="meta"><span>${esc(paceText(m, d))}</span>${P.missStreak([m], d) >= 2 ? `<span class="miss-s">連続達成 -${P.missStreak([m], d)}日</span>` : ''}</div>
    </div>
    <button class="btn ghost more" data-act="open" data-id="${m.id}">詳しく見る・記録を直す →</button>
  </article>`;
}
function goalSection(g, mats, d) {
  const n = P.diffDays(d, g.examDate);
  return `<section class="gsec">
    <div class="ghead">
      <div class="gname"><h2>${esc(g.name)}</h2><span class="sub">試験日 ${ymdw(g.examDate)}</span></div>
      <div class="count${n >= 0 && n <= 30 ? ' near' : ''}">${n > 0 ? `<span class="label">試験まで</span><span><b class="num">${n}</b>日</span>` : n === 0 ? '<b>今日が試験日</b>' : '<span class="label">試験日を過ぎました</span>'}</div>
      <button class="btn sm" data-act="goal" data-id="${g.id}">目標を見る →</button>
    </div>
    ${weekEvents(g, d).length ? `<div class="weekev"><span class="label">今週の予定</span><ul class="evs">${weekEvents(g, d).map(ev => eventItem(g, ev, d, false)).join('')}</ul></div>` : ''}
    ${mats.length ? `<div class="cards">${mats.map(m => card(m, d)).join('')}</div>`
      : `<div class="empty sm"><p>この目標にはまだ教材がありません。</p><button class="btn primary sm" data-act="add" data-goal="${g.id}">教材を登録する</button></div>`}
  </section>`;
}
function home() {
  const d = P.todayStr();
  if (!store.ready) return header() + '<div class="note">読み込み中です…</div>';
  const mats = allMats();
  const goals = goalsSorted();
  if (!mats.length && !goals.length) {
    return header() + `<div class="empty">
      <h2>まず目標を作りましょう</h2>
      <p>「社労士試験」のような目標と試験日を決めて、その中に使う教材（テキスト・問題集）を登録します。教材は1周目を最後まで進めてから2周目、3周目と回り、後の周ほど速く回る計画で、今日やる範囲が毎日出ます。</p>
      <div class="actions"><button class="btn primary" data-act="addgoal">目標を作る</button><button class="btn" data-act="sample">サンプルで試す</button></div>
    </div>`;
  }
  const loose = mats.filter(m => !goalOf(m));
  return header() + nag(mats, d)
    + goals.map(g => goalSection(g, matsOfGoal(g), d)).join('')
    + (loose.length ? `<section class="gsec"><div class="ghead"><div class="gname"><h2>目標なし</h2><span class="sub">「設定を変える」から目標に入れられます</span></div></div><div class="cards">${loose.map(m => card(m, d)).join('')}</div></section>` : '')
    + `<div class="actions"><button class="btn" data-act="addgoal">＋ 目標を作る</button><button class="btn" data-act="add">＋ 教材を登録する</button></div>`;
}
/* ---------- 全体スケジュール（公式のカリキュラム図のような横の帯） ---------- */
/** 予定を行に分ける: 名前の最初の言葉（例: 山川答練）が3件以上あれば1行、それ以外は「講座・模試など」 */
function eventRows(g) {
  const evs = eventsOf(g);
  const key = ev => ev.title.split(/[\s　（(]/)[0];
  const count = {};
  evs.forEach(ev => { count[key(ev)] = (count[key(ev)] || 0) + 1; });
  const rows = new Map();
  evs.forEach(ev => {
    const k = count[key(ev)] >= 3 ? key(ev) : '講座・模試など';
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push(ev);
  });
  return [...rows.entries()];
}
function timeline(g, mats, d) {
  const phases = Array.isArray(g.phases) ? g.phases : [];
  const evs = eventsOf(g);
  const dates = [d, g.examDate, ...mats.map(m => m.start), ...mats.map(m => m.target), ...phases.map(x => x.from), ...phases.map(x => x.to), ...evs.map(ev => ev.date)].filter(Boolean).sort();
  const start = dates[0], end = dates[dates.length - 1];
  const span = Math.max(1, P.diffDays(start, end) + 1);
  const x = day => Math.max(0, Math.min(100, P.diffDays(start, day) / span * 100));
  const bar = (a, b, cls, style, label, tip) => `<i class="tl-bar ${cls}" style="left:${x(a)}%;width:${Math.max(0.4, x(P.addDays(b, 1)) - x(a))}%;${style || ''}" title="${esc(tip || label)}"><span>${esc(label || '')}</span></i>`;
  const lines = `<i class="tl-today" style="left:${x(d)}%"></i><i class="tl-exam" style="left:${x(g.examDate)}%"></i>`;
  const row = (label, inner, cls = '') => `<div class="tl-row ${cls}"><span class="tl-lab" title="${esc(label)}">${esc(label)}</span><div class="tl-track">${inner}${lines}</div></div>`;
  // 月の目盛り
  let months = '', lastX = -100, first = true;
  for (let m0 = P.toDate(start), mm = new Date(m0.getFullYear(), m0.getMonth(), 1); P.fmt(mm) <= end; mm.setMonth(mm.getMonth() + 1)) {
    const day = P.fmt(mm) < start ? start : P.fmt(mm);
    if (x(day) - lastX < 6) continue; // 近すぎる目盛り（はじめの月の途中など）は出さない
    if (P.fmt(mm) < start && P.diffDays(start, P.fmt(new Date(mm.getFullYear(), mm.getMonth() + 1, 1))) < 12) continue;
    months += `<span class="tl-mon" style="left:${x(day)}%">${mm.getMonth() === 0 || first ? `${mm.getFullYear()}年` : ''}${mm.getMonth() + 1}月</span>`;
    lastX = x(day); first = false;
  }
  const head = `<div class="tl-row tl-head"><span class="tl-lab"></span><div class="tl-track">${months}<span class="tl-mark today" style="left:${x(d)}%">今日</span><span class="tl-mark exam${x(g.examDate) > 95 ? ' end' : ''}" style="left:${x(g.examDate)}%">試験</span></div></div>`;
  // 時期（矢印の帯）
  const ph = phases.length ? row('時期', phases.map((f, i) => bar(f.from, f.to, `tl-ph ph${i % 4}`, '', f.name, `${f.name}：${md(f.from)}〜${md(f.to)}`)).join(''), 'tl-phases') : '';
  // 教材: 1周目は区切りごと、2周目からは周ごと
  const matRows = mats.map(m => {
    const plan = P.roundPlan(m, d);
    let inner = '';
    plan.forEach((r, i) => {
      const a = i === 0 ? m.start : P.addDays(plan[i - 1].date, 1);
      const b = r.date < a ? a : r.date;
      const ss = P.sectionsOf(m);
      if (i === 0 && ss) {
        ss.forEach((sec, j) => {
          const sa = j === 0 ? a : sec.start;
          const sb = j + 1 < ss.length ? P.addDays(ss[j + 1].start, -1) : b;
          if (sb >= sa) inner += bar(sa, sb, `tl-sec${j % 2 ? ' alt' : ''}${r.state === 'done' ? ' done' : ''}`, tileColor(m, 1), sec.name, `1周目 ${sec.name}：${md(sa)}〜${md(sb)}`);
        });
      } else inner += bar(a, b, `tl-round${r.state === 'done' ? ' done' : ''}`, tileColor(m, r.r), `${r.r}周目`, `${r.r}周目：${md(a)}〜${md(b)}${r.state === 'done' ? '（終わりました）' : r.state === 'now' ? '（いまここ）' : '（予定）'}`);
    });
    return row(m.name, inner);
  }).join('');
  // 予定
  const evRows = eventRows(g).map(([k, list]) => row(k, list.map(ev => {
    const short = ev.title.startsWith(k) ? ev.title.slice(k.length).trim() : ev.title.replace(/（.*$/, '');
    const lab = k === '講座・模試など' || list.length < 3 ? (short.replace(/（.*$/, '').replace(/(完全)?マスター|対策|講座|アドバンス|公開/g, '').trim().split(/\s/)[0] || short) : ''; // 短い名前（例: 改正法・白書・模試）
    return `<i class="tl-ev${ev.done ? ' done' : ''}${!ev.done && ev.date < d ? ' late' : ''}" style="left:${x(ev.date)}%" title="${esc(`${mdw(ev.date)} ${ev.title}${ev.done ? '（済み）' : ''}`)}"></i>${lab ? `<span class="tl-evl" style="left:${x(ev.date)}%">${esc(lab)}</span>` : ''}`;
  }).join(''), 'tl-evrow')).join('');
  return `<div class="tl-scroll"><div class="tl" role="img" aria-label="全体スケジュール">${head}${ph}${matRows}${evRows}</div></div>
  <div class="legend"><span><i class="tl-k today"></i>今日</span><span><i class="tl-k exam"></i>試験日</span><span><i class="tl-k ev"></i>予定</span><span><i class="tl-k evdone"></i>済み</span><span><i class="tl-k late"></i>過ぎたのにまだ</span>
  <span class="sub">教材の帯は、いまのペースで計算した予定です。帯や印に指を置く（マウスを重ねる）と日付が出ます。</span></div>`;
}
/** カレンダーの印: 試験日と予定 */
function goalMarks(g) {
  const marks = { [g.examDate]: '試験日' };
  for (const ev of g.events || []) marks[ev.date] = marks[ev.date] ? `${marks[ev.date]}・${ev.title}` : ev.title;
  return marks;
}
function goalView() {
  const g = goalById(ui.id);
  if (!g) { ui.view = 'home'; return home(); }
  const d = P.todayStr();
  const mats = matsOfGoal(g);
  const n = P.diffDays(d, g.examDate);
  const totalUnits = mats.reduce((a, m) => a + m.total * m.reps, 0);
  const doneUnits = mats.reduce((a, m) => a + Math.min(sumCount(m, d), m.total * m.reps), 0);
  const leftToday = mats.reduce((a, m) => { const t = today(m, d); return a + (t.finished || t.q.beforeStart ? 0 : t.left); }, 0);
  const start = mats.reduce((a, m) => (a && a < m.start ? a : m.start), null) || d;
  const end = [g.examDate, d, ...mats.map(m => m.target)].sort().pop();
  const cmp = mats.map(m => {
    const a = avgRot(m, d), learned = Math.min(1, P.posThrough(m, d) / m.total) * 100;
    return `<div class="cmp-row"><span class="cmp-name">${esc(m.name)}</span>
      <div class="cmp-bar" title="1回目が終わったページ ${Math.round(learned)}%・回転 ${a.toFixed(1)}/${m.reps}"><i class="l" style="width:${learned}%"></i><i class="r" style="width:${Math.min(100, a / m.reps * 100)}%"></i></div>
      <span class="cmp-v num">${a.toFixed(1)}<small>/${m.reps}</small></span></div>`;
  }).join('');
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="home">← 一覧へ</button></div>
  <div class="dhead"><h1>${esc(g.name)}</h1><button class="btn sm" data-act="editgoal" data-id="${g.id}">目標を編集</button></div>
  <div class="stats">
    <div class="stat hero"><span class="label">試験まで</span><span class="v num">${n > 0 ? n : n === 0 ? '今日' : '—'}<small>${n > 0 ? '日' : ''}</small></span><span class="s">${ymdw(g.examDate)}</span></div>
    <div class="stat"><span class="label">全体の進み</span><span class="v num">${totalUnits ? Math.round(doneUnits / totalUnits * 100) : 0}<small>%</small></span><span class="s">全教材 × 目標の回数のうち</span></div>
    <div class="stat"><span class="label">今日の残り</span><span class="v num">${leftToday}</span><span class="s">ページ・問の合計</span></div>
    <div class="stat"><span class="label">教材</span><span class="v num">${mats.length}<small>冊</small></span><span class="s">${streakHtml(mats, d)}</span></div>
  </div>
  <section class="panel">
    <h2>全体スケジュール <span class="label">${md(g.examDate)}の試験までの流れ</span></h2>
    ${timeline(g, mats, d)}
    ${(g.phases || []).length ? '' : '<div class="sub">「目標を編集」で時期（例: 基礎・直前）を入れると、いちばん上に矢印の帯で出ます。</div>'}
  </section>
  ${mats.length ? `
  <section class="panel">
    <h2>教材ごとの進み具合 <span class="label">濃い色＝回転の進み・薄い色＝1回目が終わったページ</span></h2>
    <div class="cmp">${cmp}</div>
  </section>
  <section class="panel">
    <h2>回転モザイク <span class="label">1タイル＝1ページ（問）・色が濃いほど目標の回数に近い</span></h2>
    <div class="gm">${mats.map(m => `<div class="gm-row"><span class="gm-name">${esc(m.name)}</span>${mosaic(m, d, 'mid')}</div>`).join('')}</div>
    ${legendRel}
  </section>
  <section class="panel">
    <h2>日ごとの達成 <span class="label">この目標の教材を全部やった日が緑</span></h2>
    ${calendar(start, end, d, day => goalDayStatus(mats.filter(m => m.start <= day), day), goalMarks(g))}
  </section>
  <section class="panel">
    <h2>周回の予定 <span class="label">教材ごと・いまのペースで計算</span></h2>
    <div class="gm">${mats.map(m => `<div class="gm-row"><span class="gm-name">${esc(m.name)}</span><div>${roundsPanel(m, d, false)}</div></div>`).join('')}</div>
  </section>` : ''}
  ${eventsPanel(g, d)}
  ${scoresPanel(g, d)}
  <section class="panel">
    <div class="dhead"><h2>教材</h2><button class="btn primary sm" data-act="add" data-goal="${g.id}">＋ この目標に教材を登録</button></div>
    ${mats.length ? `<div class="cards">${mats.map(m => card(m, d)).join('')}</div>` : '<div class="sub">まだ教材がありません。</div>'}
  </section>
  <section class="panel">
    <h2>この目標を削除</h2>
    <div class="actions">${ui.confirmDel
      ? `<span class="err-text">目標「${esc(g.name)}」と、その予定・点数の記録を削除します（元に戻せません）。中の教材と学習の記録は消えずに「目標なし」に移ります。</span><button class="btn danger solid" data-act="delgoal" data-id="${g.id}">削除する</button><button class="btn" data-act="nodel">やめる</button>`
      : '<button class="btn danger" data-act="askdel">この目標を削除</button>'}</div>
  </section>`;
}
function detail() {
  const m = byId(ui.id);
  if (!m) { ui.view = 'home'; return home(); }
  const d = P.todayStr();
  const t = today(m, d);
  const g = goalOf(m);
  const now = P.posThrough(m, d);
  const gOf = e => (Math.min(e[0], m.reps) - 1) * m.total + Math.min(e[1], m.total);
  const list = P.logList(m).reverse();
  const rows = list.map(([k, e], i) => {
    const prev = i + 1 < list.length ? gOf(list[i + 1][1]) : 0;
    return `<tr><td>${mdw(k)}</td><td>${e[0]}周目 ${e[1] ? lpos(m, e[1]) : '（はじめ）'} まで</td><td class="num">+${Math.max(0, gOf(e) - prev)}</td>
      <td><button class="btn ghost sm" data-act="undoday" data-id="${m.id}" data-date="${k}">取り消す</button></td></tr>`;
  }).join('');
  const marks = { [m.target]: g && m.followGoal ? '試験日' : '目標日' };
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="${g ? 'goal' : 'home'}" data-id="${g ? g.id : ''}">← ${g ? esc(g.name) : '一覧へ'}</button></div>
  <div class="dhead"><h1>${esc(m.name)}</h1>${statusPill(m, d)}</div>
  <div class="stats">
    <div class="stat"><span class="label">回転数</span><span class="v num">${(now / m.total).toFixed(2)}<small>/ ${m.reps}</small></span><span class="s">全体の ${Math.round(now / P.TU(m) * 100)}%</span></div>
    <div class="stat"><span class="label">今日のノルマ</span><span class="v num">${t.finished ? '—' : t.q.units}<small>${t.finished ? '' : uw(m)}</small></span><span class="s">${t.finished ? '完了しました' : `あと ${t.left}${uw(m)}`}</span></div>
    <div class="stat"><span class="label">いまの位置</span><span class="v num" style="font-size:20px">${now ? at(m, now) : '未着手'}</span><span class="s">${esc(paceText(m, d)) || '—'}</span></div>
    <div class="stat"><span class="label">${g && m.followGoal ? '試験日' : '目標日'}</span><span class="v num">${md(m.target)}</span><span class="s">${daysTo(m.target, d)}</span></div>
  </div>
  <section class="panel">
    <h2>回転モザイク <span class="label">1タイル＝1${uw(m)}・色が濃いほど回数が多い</span></h2>
    ${mosaic(m, d)}
    ${mosaicLegend(m.reps)}
  </section>
  <section class="panel">
    <h2>周回の予定 <span class="label">いまのペースで計算。後の周ほど短い日数で回ります</span></h2>
    ${roundsPanel(m, d)}
  </section>
  <section class="panel">
    <h2>日ごとの達成 <span class="label">${md(m.start)} 〜 ${md(m.target)}</span></h2>
    ${calendar(m.start, m.target > d ? m.target : d, d, day => P.dayStatus(m, day), marks)}
  </section>
  <section class="panel">
    <h2>記録する・直す</h2>
    <div class="sub">日付を変えると、記録し忘れた日の分も入れられます（その日より後の記録がない場合のみ）。</div>
    ${recForm(m, d, true)}
    ${rows ? `<div class="table-scroll"><table class="log"><thead><tr><th>日付</th><th>進んだところ</th><th>その日の量</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="sub">まだ記録がありません。</div>'}
  </section>
  <section class="panel">
    <h2>設定</h2>
    ${P.sectionsOf(m) ? `<div class="table-scroll"><table class="log"><thead><tr><th>区切り</th><th>範囲</th><th>数</th><th>開始日</th></tr></thead><tbody>${P.sectionsOf(m).map(sec => `<tr><td>${esc(sec.name)}</td><td>${range(m, sec.from, sec.to)}</td><td class="num">${sec.to - sec.from + 1}</td><td>${mdw(sec.start)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="meta"><span>目標 <b>${g ? esc(g.name) : 'なし'}</b></span><span>全 <b class="num">${m.total}</b> ${uw(m)}</span><span>開始日 <b class="num">${md(m.start)}</b></span><span>${g && m.followGoal ? '目標日（試験日）' : '目標日'} <b class="num">${md(m.target)}</b></span><span>目標 <b class="num">${m.reps}</b> 回転</span><span>2周目以降の速さ <b>${speedName(m.speed)}</b></span></div>
    <div class="actions">
      <button class="btn" data-act="edit" data-id="${m.id}">設定を変える</button>
      ${ui.confirmDel
        ? `<span class="err-text">「${esc(m.name)}」と記録をすべて削除します。元に戻せません。</span><button class="btn danger solid" data-act="del" data-id="${m.id}">削除する</button><button class="btn" data-act="nodel">やめる</button>`
        : '<button class="btn danger" data-act="askdel">この教材を削除</button>'}
    </div>
  </section>`;
}
const speedName = s => (P.SPEEDS.find(([v]) => v === s) || P.SPEEDS[0])[1];
function form() {
  const raw = ui.id ? store.mats.find(x => x.id === ui.id) : null;
  const m = raw ? P.migrate(raw) : null;
  const d = P.todayStr();
  const goals = goalsSorted();
  const preset = ui.presetGoal && goalById(ui.presetGoal) ? ui.presetGoal : (goals[0] ? goals[0].id : '');
  const v = m || { name: '', unit: 'p', total: '', start: d, target: P.addDays(d, 90), reps: 3, speed: P.DEFAULT_SPEED, goalId: preset, followGoal: true };
  const gid = v.goalId && goalById(v.goalId) ? v.goalId : '';
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="${m ? 'open' : 'home'}" data-id="${m ? m.id : ''}">← もどる</button></div>
  <section class="panel">
    <h2>${m ? '設定を変える' : '教材を登録する'}</h2>
    <form class="form" id="matform">
      <div class="field full"><label for="f-name">教材の名前</label><input id="f-name" required maxlength="60" value="${esc(v.name)}" placeholder="例: 社労士 過去問題集 2027年版"></div>
      <div class="field full"><label for="f-goal">目標</label><select id="f-goal"><option value="">目標なし</option>${goals.map(g => `<option value="${g.id}"${g.id === gid ? ' selected' : ''}>${esc(g.name)}（試験日 ${md(g.examDate)}）</option>`).join('')}</select></div>
      <div class="field"><label>数える単位</label>
        <div class="seg">
          <label><input type="radio" name="f-unit" value="p"${v.unit !== 'q' && v.unit !== 'k' ? ' checked' : ''}><span>ページ</span></label>
          <label><input type="radio" name="f-unit" value="q"${v.unit === 'q' ? ' checked' : ''}><span>問題</span></label>
          <label><input type="radio" name="f-unit" value="k"${v.unit === 'k' ? ' checked' : ''}><span>回（講義）</span></label>
        </div></div>
      <div class="field"><label for="f-total">ページ数・問題数・回数</label><input id="f-total" type="number" min="1" max="5000" inputmode="numeric" required value="${esc(v.total)}" placeholder="例: 320"><span class="hint" id="f-total-hint" hidden>区切りの数の合計です（区切りを消すと入力できます）。</span></div>
      <div class="field"><label for="f-start">開始日</label><input id="f-start" type="date" required value="${v.start}"></div>
      <div class="field"><label for="f-target">目標日</label>
        <label class="check" id="f-follow-wrap"><input type="checkbox" id="f-follow"${v.followGoal !== false ? ' checked' : ''}> <span id="f-follow-txt">試験日と同じ</span></label>
        <input id="f-target" type="date" required value="${v.target}"><span class="hint">この日までに、すべてのページを目標の回数やり終える計画にします。試験より前に仕上げたい教材は、チェックを外して早い日にします。</span></div>
      <div class="field"><label for="f-reps">目標の回転数</label><input id="f-reps" type="number" min="1" max="10" inputmode="numeric" required value="${v.reps}"><span class="hint">教材を何周するか。1周目を最後まで終えてから、2周目を p.1 から始めます。</span></div>
      <div class="field"><label for="f-speed">2周目以降の速さ</label><select id="f-speed">${P.SPEEDS.map(([s, t]) => `<option value="${s}"${(v.speed ?? P.DEFAULT_SPEED) === s ? ' selected' : ''}>${t}</option>`).join('')}</select><span class="hint">「半分」なら、2周目は1周目の半分、3周目はさらに半分の日数で回る計画にします。忘れる前に次の周が来るようにするためです。</span></div>
      <div class="field full"><label>科目ごとの区切り（任意）</label>
        <span class="hint">科目ごとに解き始める日を決めたいときに使います。1周目は、開始日が来た区切りの分だけ今日のノルマに入ります。2周目からは全部を回します。上から順に、名前・数・開始日を入れてください。</span>
        <div id="secrows">${(P.sectionsOf(v) || []).map(sec => secRow(sec.name, sec.to - sec.from + 1, sec.start)).join('')}</div>
        <div><button class="btn sm" type="button" data-act="addsec">＋ 区切りを追加</button></div></div>
      <div class="full plan-preview" id="preview" aria-live="polite"></div>
      ${ui.formErr ? `<div class="full err-text">${esc(ui.formErr)}</div>` : ''}
      <div class="actions full"><button class="btn primary" type="submit">${m ? '変更を保存' : '登録する'}</button></div>
    </form>
  </section>`;
}
function secRow(name = '', count = '', start = '') {
  return `<div class="sec-row"><input class="sr-name" maxlength="20" value="${esc(name)}" placeholder="例: 労災" aria-label="区切りの名前"><input class="sr-count" type="number" min="1" inputmode="numeric" value="${esc(count)}" placeholder="数" aria-label="区切りの数"><input class="sr-start" type="date" value="${esc(start)}" aria-label="区切りの開始日"><button class="btn ghost sm" type="button" data-act="delsec" aria-label="この区切りを消す">消す</button></div>`;
}
/** 目標と「試験日と同じ」に合わせて、目標日の欄を切り替える */
function syncFollow() {
  const sel = document.getElementById('f-goal');
  if (!sel) return;
  const g = goalById(sel.value);
  const wrap = document.getElementById('f-follow-wrap');
  const cb = document.getElementById('f-follow');
  const tgt = document.getElementById('f-target');
  wrap.hidden = !g;
  if (g) document.getElementById('f-follow-txt').textContent = `試験日（${ymdw(g.examDate)}）と同じ`;
  const follow = !!g && cb.checked;
  if (follow) tgt.value = g.examDate;
  tgt.disabled = follow;
  tgt.hidden = follow;
}
function readForm() {
  const val = id => document.getElementById(id).value.trim();
  const goalId = val('f-goal') || null;
  const g = goalById(goalId);
  const followGoal = !!g && document.getElementById('f-follow').checked;
  const rows = [...document.querySelectorAll('#secrows .sec-row')].map(r => ({ name: r.querySelector('.sr-name').value.trim(), count: Number(r.querySelector('.sr-count').value), start: r.querySelector('.sr-start').value }));
  const sections = rows.length ? P.buildSections(rows) : null;
  // 区切りがあるときは、数の合計を全体の数にする
  const totalEl = document.getElementById('f-total');
  if (sections) { const sum = rows.reduce((a, r) => a + (Number.isInteger(r.count) && r.count > 0 ? r.count : 0), 0); totalEl.value = sum || ''; }
  totalEl.readOnly = !!sections;
  document.getElementById('f-total-hint').hidden = !sections;
  return {
    sections, name: val('f-name'), total: Number(val('f-total')), start: val('f-start'),
    target: followGoal ? g.examDate : val('f-target'),
    reps: Number(val('f-reps')), speed: Number(val('f-speed')),
    unit: document.querySelector('input[name="f-unit"]:checked').value,
    goalId, followGoal
  };
}
function updatePreview() {
  const el = document.getElementById('preview');
  if (!el) return;
  syncFollow();
  const v = readForm();
  if (P.validateMaterial(v)) { el.textContent = ''; return; }
  const m = { ...v, log: {} };
  const plan = P.roundPlan(m, m.start);
  el.innerHTML = `この計画では: はじめは1日あたり約 <b>${P.quota(m, m.start).units}${uw(m)}</b>。`
    + plan.map(x => `${x.r}周目は <b>${md(x.date)}</b> まで`).join('、') + '。';
}
function goalForm() {
  const g = ui.id ? goalById(ui.id) : null;
  const v = g || { name: '', examDate: '' };
  const wts = Array.isArray(v.dayWeights) && v.dayWeights.length === 7 ? v.dayWeights : [1, 1, 1, 1, 1, 1, 1];
  const wsel = i => `<label class="wd"><span>${WD[i]}</span><select id="g-w${i}" aria-label="${WD[i]}曜日の量">${WEIGHT_OPTS.map(o => `<option value="${o}"${Number(wts[i]) === o ? ' selected' : ''}>${o === 0 ? '休み' : `×${o}`}</option>`).join('')}</select></label>`;
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="${g ? 'goal' : 'home'}" data-id="${g ? g.id : ''}">← もどる</button></div>
  <section class="panel">
    <h2>${g ? '目標を編集' : '目標を作る'}</h2>
    <form class="form" id="goalform">
      <div class="field full"><label for="g-name">目標の名前</label><input id="g-name" required maxlength="40" value="${esc(v.name)}" placeholder="例: 社労士試験 2027"></div>
      <div class="field"><label for="g-exam">試験日</label><input id="g-exam" type="date" required value="${v.examDate}"><span class="hint">「試験日と同じ」にした教材は、この日に合わせて計画します。試験日を変えると、その教材の計画も組み直します。</span></div>
      <div class="field"><label for="g-target">択一式の目標点（任意）</label><input id="g-target" type="number" min="1" max="70" inputmode="numeric" value="${esc(v.scoreTarget || '')}" placeholder="例: 50"><span class="hint">点数の記録のグラフに線を引きます。</span></div>
      <div class="field full"><label>曜日ごとの量</label><div class="wds">${[1, 2, 3, 4, 5, 6, 0].map(wsel).join('')}</div>
        <span class="hint">この目標の教材の、曜日ごとのノルマの比率です。「×2」の日は「×1」の日の2倍、「休み」の日はノルマが出ません。例: 平日×1、土日×2.5（平日2時間・土日5時間のとき）。</span></div>
      <div class="field full"><label>時期（任意）</label>
        <span class="hint">全体スケジュールのいちばん上に矢印の帯で出ます。例: 基礎（11/4〜4/3）→ 2周目と弱点つぶし → 実戦 → 直前の仕上げ。</span>
        <div id="phrows">${(v.phases || []).map(f => phRow(f.name, f.from, f.to)).join('')}</div>
        <div><button class="btn sm" type="button" data-act="addph">＋ 時期を追加</button></div></div>
      ${ui.formErr ? `<div class="full err-text">${esc(ui.formErr)}</div>` : ''}
      <div class="actions full"><button class="btn primary" type="submit">${g ? '変更を保存' : '作る'}</button></div>
    </form>
  </section>`;
}
function phRow(name = '', from = '', to = '') {
  return `<div class="ph-row"><input class="ph-name" maxlength="20" value="${esc(name)}" placeholder="例: 基礎" aria-label="時期の名前"><input class="ph-from" type="date" value="${esc(from)}" aria-label="時期のはじめ"><span class="lbl">〜</span><input class="ph-to" type="date" value="${esc(to)}" aria-label="時期の終わり"><button class="btn ghost sm" type="button" data-act="delph" aria-label="この時期を消す">消す</button></div>`;
}
function account() {
  const local = store.localCounts();
  const th = getTheme();
  let body;
  if (!cloudAvailable()) {
    body = '<div class="sub">同期の機能はまだ準備されていません。今の記録はこの端末の中だけにあります。</div>';
  } else if (store.mode === 'cloud') {
    body = `<div class="meta"><span>ログイン中: <b>${esc(store.user.email)}</b></span></div>
      <div class="sub">記録はアカウントに保存され、同じメールアドレスでログインしたスマホ・PCで同じ内容が見えます。</div>
      ${local.materials || local.goals ? `<div class="note">この端末だけに保存された教材が ${local.materials} 件、目標が ${local.goals} 件あります。<div class="actions"><button class="btn primary" data-act="move">アカウントに移す</button></div></div>` : ''}
      <div class="actions"><button class="btn" data-act="logout">ログアウト</button></div>`;
  } else {
    body = `<div class="sub">ログインすると、スマホとPCで同じ記録を使えます。ログインしなくても、この端末の中だけで使えます。</div>
      <form class="form" id="loginform">
        <div class="field"><label for="a-email">メールアドレス</label><input id="a-email" type="email" autocomplete="username" required></div>
        <div class="field"><label for="a-pw">パスワード（6文字以上）</label><input id="a-pw" type="password" autocomplete="current-password" minlength="6"></div>
        <div class="actions full">
          <button class="btn primary" type="submit" data-mode="login"${ui.busy ? ' disabled' : ''}>ログイン</button>
          <button class="btn" type="submit" data-mode="signup"${ui.busy ? ' disabled' : ''}>はじめて使う（登録）</button>
          <button class="btn ghost" type="button" data-act="reset">パスワードを忘れた</button>
        </div>
      </form>`;
  }
  const opt = (val, label, hint) => `<label><input type="radio" name="theme" value="${val}"${th === val ? ' checked' : ''}><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</label>`;
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="home">← 一覧へ</button></div>
  <h1 class="ptitle">設定</h1>
  <section class="panel"><h2>ログイン・同期</h2>${body}
    ${ui.acctErr ? `<div class="err-text">${esc(ui.acctErr)}</div>` : ''}${ui.acctMsg ? `<div class="ok">${esc(ui.acctMsg)}</div>` : ''}
  </section>
  <section class="panel"><h2>このアプリの版</h2>
    <div class="meta"><span>今の版 <b class="num">${esc(VERSION)}</b></span></div>
    <div class="sub">更新したのに画面が変わらないときは、このボタンで読み込み直してください（PC は Ctrl+F5 でも同じです）。</div>
    <div class="actions"><button class="btn sm" data-act="reload">最新の版を読み込み直す</button></div>
  </section>
  <section class="panel"><h2>画面の明るさ</h2>
    <div class="seg theme">${opt('light', '明るい', 'おすすめ。文字が読みやすい')}${opt('dark', '暗い', '夜・暗い部屋で')}${opt('auto', '端末に合わせる', '')}</div>
  </section>
  ${ui.pendingImport ? `<section class="panel" id="importbox"><h2>計画ファイルの読み込み</h2>
    <div class="sub">「${esc(ui.pendingImport.goal.name)}」の計画（教材 ${ui.pendingImport.materials.length} 件・予定 ${(ui.pendingImport.goal.events || []).length} 件）を読み込みます。入れる目標を選んでください。すでにある予定と同じ日・同じ名前のものは入れません。</div>
    <div class="field"><label for="imp-goal">入れる目標</label><select id="imp-goal"><option value="new">新しい目標を作る（${esc(ui.pendingImport.goal.name)}・試験日 ${md(ui.pendingImport.goal.examDate)}）</option>${goalsSorted().map(g => `<option value="${g.id}">${esc(g.name)}（試験日 ${md(g.examDate)}）</option>`).join('')}</select></div>
    ${(ui.pendingImport.replaceNames || []).length ? `<label class="check"><input type="checkbox" id="imp-replace" checked> 読み込んだあと、入れる目標の中の次の教材を削除する（記録はこのファイルの教材に引き継ぎ済み）: ${ui.pendingImport.replaceNames.map(esc).join('、')}</label>` : ''}
    <div class="sub">入れる目標に同じ名前の教材があるときは、その教材は入れません（二重に入らないように）。</div>
    <div class="actions"><button class="btn primary" data-act="importgo">読み込む</button><button class="btn" data-act="importcancel">やめる</button></div>
  </section>` : ''}
  <section class="panel"><h2>バックアップ</h2>
    <div class="sub">記録をファイルに書き出しておくと、機種変更のときや、まちがえて消したときに戻せます。</div>
    <div class="actions"><button class="btn" data-act="export">ファイルに書き出す</button>
      <label class="btn" for="importfile">ファイルから読み込む</label><input type="file" id="importfile" accept=".json,application/json" hidden></div>
  </section>`;
}

function render() {
  const app = document.getElementById('app');
  const y = window.scrollY;
  const views = { detail, form, goal: goalView, goalform: goalForm, account };
  app.innerHTML = (views[ui.view] || home)() + `<footer class="foot">RPM 版 ${esc(VERSION)}</footer>`;
  if (ui.view === 'form') updatePreview();
  window.scrollTo(0, y);
}
function go(view, id, extra) {
  ui.view = view; ui.id = id || null; ui.confirmDel = false; ui.formErr = ''; ui.acctErr = ''; ui.acctMsg = '';
  ui.presetGoal = (extra && extra.goal) || null;
  render(); window.scrollTo(0, 0);
}

/* ---------- 操作 ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  const m = id ? byId(id) : null;
  if (act === 'home') go('home');
  else if (act === 'open') go('detail', id);
  else if (act === 'goal') go('goal', id);
  else if (act === 'add') go('form', null, { goal: b.dataset.goal });
  else if (act === 'addgoal') go('goalform');
  else if (act === 'edit') go('form', id);
  else if (act === 'editgoal') go('goalform', id);
  else if (act === 'account') go('account');
  else if (act === 'askdel') { ui.confirmDel = true; render(); }
  else if (act === 'nodel') { ui.confirmDel = false; render(); }
  else if (act === 'del') {
    store.remove('materials', id).catch(() => toast('削除できませんでした。もう一度お試しください。'));
    const g = goalOf(m);
    go(g ? 'goal' : 'home', g ? g.id : null); toast(`「${m.name}」を削除しました`);
  }
  else if (act === 'delgoal') deleteGoal(id);
  else if (act === 'undoday') {
    saveMat(P.undoDay(m, b.dataset.date).m, `${mdw(b.dataset.date)}の記録を取り消しました`);
  }
  else if (act === 'sample') addSample();
  else if (act === 'addph') document.getElementById('phrows').insertAdjacentHTML('beforeend', phRow());
  else if (act === 'delph') b.closest('.ph-row').remove();
  else if (act === 'addsec') { document.getElementById('secrows').insertAdjacentHTML('beforeend', secRow()); updatePreview(); }
  else if (act === 'delsec') { b.closest('.sec-row').remove(); updatePreview(); }
  else if (act === 'delev') { const g = goalById(id); save('goals', { ...g, events: (g.events || []).filter(x => x.id !== b.dataset.ev) }, '予定を削除しました'); }
  else if (act === 'delscore') { const g = goalById(id); save('goals', { ...g, scores: (g.scores || []).filter(x => x.id !== b.dataset.sc) }, '点数の記録を削除しました'); }
  else if (act === 'scorefrom') {
    const g = goalById(id); const ev = (g.events || []).find(x => x.id === b.dataset.ev);
    ui.scorePrefill = { goal: id, date: ev.date, title: ev.title, kind: /模試|本試験/.test(ev.title) ? 'taku' : 'ans' };
    render(); document.getElementById('scores').scrollIntoView({ behavior: 'smooth' }); document.getElementById('sc-score').focus();
  }
  else if (act === 'importgo') applyImport();
  else if (act === 'importcancel') { ui.pendingImport = null; render(); }
  else if (act === 'logout') store.logout().then(() => toast('ログアウトしました。この端末だけの記録を表示しています'));
  else if (act === 'move') store.moveLocalToCloud().then(n => { toast(`${n}件の教材をアカウントに移しました`); render(); }).catch(() => toast('移せませんでした。通信を確かめてください'));
  else if (act === 'reset') {
    const email = document.getElementById('a-email').value.trim();
    if (!email) { ui.acctErr = 'メールアドレスを入れてから「パスワードを忘れた」を押してください。'; render(); return; }
    store.resetPassword(email).then(() => { ui.acctErr = ''; ui.acctMsg = 'パスワードを設定し直すためのメールを送りました。'; render(); })
      .catch(err => { ui.acctErr = authMessage(err); render(); });
  }
  else if (act === 'export') exportAll();
  else if (act === 'reload') { const u = new URL(location.href); u.searchParams.set('r', Date.now()); location.replace(u.toString()); }
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'matform') return saveForm();
  if (f.id === 'goalform') return saveGoalForm();
  if (f.id === 'loginform') return doLogin(e.submitter && e.submitter.dataset.mode);
  if (f.id === 'evform') return addEvent(f.dataset.goal);
  if (f.id === 'scoreform') return addScore(f.dataset.goal);
  const id = f.dataset.rec;
  const m = id && byId(id);
  if (!m) return;
  const raw = document.getElementById('rp-' + id).value.trim();
  const r = Number(document.getElementById('rr-' + id).value);
  const dateEl = document.getElementById('rd-' + id);
  const day = dateEl ? dateEl.value : P.todayStr();
  if (!day || day > P.todayStr()) return toast('日付は今日までの日を選んでください');
  if (raw === '') return toast('どこまで進んだか、数字を入れてください');
  // 区切りがあるときは、区切りの中の番号を全体の番号に直す
  const secSel = document.getElementById('rs-' + id);
  let pnum = Number(raw);
  if (secSel) {
    const sec = P.sectionsOf(m)[Number(secSel.value)];
    const size = sec.to - sec.from + 1;
    if (!Number.isInteger(pnum) || pnum < 0 || pnum > size) return toast(`「${sec.name}」は 0〜${size} の数字で入れてください`);
    pnum = sec.from - 1 + pnum;
  }
  const res = P.recordProgress(m, day, r, pnum);
  if (res.error) return toast(res.error);
  const t = today(res.m, P.todayStr());
  const g = P.posThrough(res.m, day);
  const roundDone = g > P.posBefore(m, day) && g % m.total === 0;
  saveMat(res.m, day !== P.todayStr() ? `${mdw(day)}の分を記録しました`
    : t.finished ? `${m.reps}回転、すべて終わりました！おつかれさまでした`
    : roundDone ? `${g / m.total}周目が終わりました！次は${g / m.total + 1}周目の${pos(m, 1)}からです`
    : !t.left ? '今日のノルマ達成です' : `記録しました。今日はあと${t.left}${uw(m)}`);
});
document.addEventListener('input', e => {
  if (e.target.closest('#matform')) updatePreview();
  if (e.target.closest('.sjbox')) { // 科目別の点から合計を出す
    const box = e.target.closest('.sjbox');
    const vals = [...box.querySelectorAll('input')].map(i => i.value === '' ? null : Number(i.value)).filter(v => v !== null);
    if (vals.length) document.getElementById('sc-score').value = vals.reduce((a, b) => a + b, 0);
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'importfile') importFile(e.target.files[0]);
  if (e.target.dataset.evdone) {
    const [gid, evid] = e.target.dataset.evdone.split('|');
    const g = goalById(gid);
    save('goals', { ...g, events: (g.events || []).map(x => (x.id === evid ? { ...x, done: e.target.checked } : x)) }, e.target.checked ? '予定を「済み」にしました' : '予定を「まだ」に戻しました');
  }
  if (e.target.id === 'sc-kind') {
    const k = e.target.value;
    document.querySelectorAll('.sjbox').forEach(el => { el.hidden = el.dataset.kind !== k; });
    document.getElementById('sc-max').value = KINDS[k].max;
  }
  if (e.target.name === 'theme') setTheme(e.target.value);
});

async function doLogin(mode) {
  const email = document.getElementById('a-email').value.trim();
  const pw = document.getElementById('a-pw').value;
  if (!email || pw.length < 6) { ui.acctErr = 'メールアドレスと、6文字以上のパスワードを入れてください。'; render(); return; }
  ui.busy = true; ui.acctErr = ''; render();
  try {
    if (mode === 'signup') await store.signup(email, pw); else await store.login(email, pw);
    ui.busy = false; toast(mode === 'signup' ? '登録しました。記録はアカウントに保存されます' : 'ログインしました');
    go('account');
  } catch (err) { ui.busy = false; ui.acctErr = authMessage(err); render(); }
}
function saveForm() {
  const v = readForm();
  const err = P.validateMaterial(v);
  if (err) { ui.formErr = err; render(); return; }
  const raw = ui.id ? store.mats.find(x => x.id === ui.id) : null;
  const old = raw ? P.migrate(raw) : null;
  if (old && P.logList(old).some(([, e]) => e[1] > v.total || e[0] > v.reps)) { ui.formErr = 'これまでの記録より少ないページ数・回転数にはできません。'; render(); return; }
  if (v.sections && v.sections[0].start < v.start) v.start = v.sections[0].start;
  const m = old ? { ...old, ...v } : { id: newId('m'), createdAt: Date.now(), log: {}, ...v };
  saveMat(m, old ? '設定を保存しました。今日の量を計算し直しました' : `「${v.name}」を登録しました`);
  const g = goalById(m.goalId);
  if (old) go('detail', m.id); else if (g) go('goal', g.id); else go('home');
}
function saveGoalForm() {
  const name = document.getElementById('g-name').value.trim();
  const examDate = document.getElementById('g-exam').value;
  const old = ui.id ? goalById(ui.id) : null;
  let err = '';
  if (!name) err = '目標の名前を入れてください。';
  else if (!examDate) err = '試験日を入れてください。';
  else if (old) {
    const bad = store.mats.find(m => m.goalId === old.id && m.followGoal && P.diffDays(m.start, examDate) < 1);
    if (bad) err = `教材「${bad.name}」の開始日（${md(bad.start)}）より後の日にしてください。`;
  }
  if (err) { ui.formErr = err; render(); return; }
  const dayWeights = [0, 1, 2, 3, 4, 5, 6].map(i => Number(document.getElementById('g-w' + i).value));
  const scoreTarget = Number(document.getElementById('g-target').value) || null;
  if (!err && dayWeights.every(w => w === 0)) err = '曜日ごとの量が全部「休み」になっています。どこかの曜日を休み以外にしてください。';
  const phases = [...document.querySelectorAll('#phrows .ph-row')].map(r => ({ name: r.querySelector('.ph-name').value.trim(), from: r.querySelector('.ph-from').value, to: r.querySelector('.ph-to').value }));
  const badPh = phases.find(f => !f.name || !f.from || !f.to || f.to < f.from);
  if (!err && badPh) err = `時期「${badPh.name || '（名前なし）'}」の名前・はじめ・終わりを入れてください（終わりは、はじめと同じ日か後）。`;
  if (err) { ui.formErr = err; render(); return; }
  phases.sort((a, b) => (a.from < b.from ? -1 : 1));
  const g = old ? { ...old, name, examDate, dayWeights, scoreTarget, phases } : { id: newId('g'), createdAt: Date.now(), name, examDate, dayWeights, scoreTarget, phases, events: [], scores: [] };
  save('goals', g, old ? '目標を保存しました。教材の計画を組み直しました' : `目標「${name}」を作りました。教材を登録しましょう`);
  if (old) go('goal', g.id); else go('form', null, { goal: g.id });
}
function addEvent(gid) {
  const g = goalById(gid);
  const date = document.getElementById('ev-date').value;
  const title = document.getElementById('ev-title').value.trim();
  if (!date || !title) return toast('予定の日付と名前を入れてください');
  save('goals', { ...g, events: [...(g.events || []), { id: uid(), date, title, done: false }] }, `${mdw(date)}に「${title}」を追加しました`);
}
function addScore(gid) {
  const g = goalById(gid);
  const kind = document.getElementById('sc-kind').value;
  const date = document.getElementById('sc-date').value;
  const title = document.getElementById('sc-title').value.trim();
  const score = Number(document.getElementById('sc-score').value);
  const max = Number(document.getElementById('sc-max').value);
  if (!date || !title) return toast('日付と名前を入れてください');
  if (document.getElementById('sc-score').value === '' || !(score >= 0)) return toast('点数を入れてください');
  if (!(max > 0) || score > max) return toast('満点は点数以上の数で入れてください');
  const subjects = {};
  if (KINDS[kind].subj) KINDS[kind].subj.forEach((n, i) => { const el = document.getElementById(`sj-${kind}-${i}`); if (el && el.value !== '') subjects[n] = Number(el.value); });
  if (Object.values(subjects).some(v => !(v >= 0) || v > KINDS[kind].per)) return toast(`科目別の点は 0〜${KINDS[kind].per} で入れてください`);
  ui.scorePrefill = null;
  const cut = KINDS[kind].subj ? Object.entries(subjects).filter(([, v]) => v < KINDS[kind].cut).map(([n]) => n) : [];
  save('goals', { ...g, scores: [...(g.scores || []), { id: uid(), date, title, kind, score, max, subjects }] },
    cut.length ? `記録しました。足切りの目安より下: ${cut.join('・')}` : `記録しました（${score}/${max}点）`);
}
function deleteGoal(id) {
  const g = goalById(id);
  // 中の教材は消さずに「目標なし」へ。試験日に合わせていた教材は、試験日を自分の目標日として残す
  for (const m of store.mats.filter(x => x.goalId === id)) saveMat({ ...P.migrate(m), goalId: null, followGoal: false, target: m.followGoal ? g.examDate : m.target });
  store.remove('goals', id).catch(() => toast('削除できませんでした。もう一度お試しください。'));
  go('home'); toast(`目標「${g.name}」を削除しました。教材は「目標なし」に移しました`);
}
function addSample() {
  const d = P.todayStr();
  const g = { id: newId('g'), createdAt: Date.now(), name: '【サンプル】社労士試験', examDate: P.addDays(d, 120) };
  save('goals', g);
  const sim = (m, skip) => {
    for (let day = m.start; day < d; day = P.addDays(day, 1)) {
      if (skip.includes(P.diffDays(day, d))) continue;
      const q = P.quota(m, day);
      if (q.finished) break;
      const w = P.where(m, Math.min(P.TU(m), q.gT + (P.diffDays(day, d) % 5 === 0 ? -2 : 1)));
      m = P.recordProgress(m, day, w.r, w.p).m;
    }
    return m;
  };
  const a = sim({ id: newId('m'), createdAt: Date.now(), name: '【サンプル】過去問題集', unit: 'q', total: 300, start: P.addDays(d, -40), target: g.examDate, followGoal: true, goalId: g.id, reps: 3, speed: 0.5, log: {} }, [9, 4]);
  const b = sim({ id: newId('m'), createdAt: Date.now() + 1, name: '【サンプル】労働基準法テキスト', unit: 'p', total: 180, start: P.addDays(d, -30), target: P.addDays(d, 20), followGoal: false, goalId: g.id, reps: 3, speed: 0.5, log: {} }, [1]);
  saveMat(a); saveMat(b, 'サンプルを入れました。いらなくなったら、目標の画面から削除できます');
}
function exportAll() {
  const data = JSON.stringify({ app: 'RPM', version: 4, exportedAt: new Date().toISOString(), goals: store.goals, materials: store.mats }, null, 1);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  a.download = `RPM_バックアップ_${P.todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('バックアップのファイルを書き出しました');
}
function importFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const j = JSON.parse(rd.result);
      if (j && j.app === 'RPM' && j.kind === 'plan') { // 計画ファイル: 入れる目標を選んでから読み込む
        if (!j.goal || !j.goal.name || !Array.isArray(j.materials)) throw new Error('bad');
        ui.pendingImport = j; render(); document.getElementById('importbox').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const materials = j && j.app === 'RPM' && Array.isArray(j.materials) ? j.materials : null;
      const goals = j && Array.isArray(j.goals) ? j.goals : [];
      if (!materials || materials.some(m => !m.id || !m.name || !Number.isInteger(m.total)) || goals.some(g => !g.id || !g.name || !g.examDate)) throw new Error('bad');
      store.importAll({ materials, goals }).then(() => toast(`教材 ${materials.length} 件・目標 ${goals.length} 件を読み込みました`)).catch(() => toast('読み込んだ記録を保存できませんでした'));
    } catch (err) { toast('RPM のバックアップファイルではないため、読み込めませんでした'); }
  };
  rd.onerror = () => toast('ファイルを開けませんでした');
  rd.readAsText(file);
}
/** 計画ファイルを、選んだ目標（または新しい目標）に入れる */
function applyImport() {
  const j = ui.pendingImport;
  if (!j) return;
  const sel = document.getElementById('imp-goal').value;
  let g;
  if (sel === 'new') g = { id: newId('g'), createdAt: Date.now(), name: j.goal.name, examDate: j.goal.examDate, dayWeights: j.goal.dayWeights || null, scoreTarget: j.goal.scoreTarget || null, phases: j.goal.phases || [], events: [], scores: [] };
  else { g = { ...goalById(sel) }; if (!Array.isArray(g.dayWeights) && j.goal.dayWeights) g.dayWeights = j.goal.dayWeights; if (!g.scoreTarget && j.goal.scoreTarget) g.scoreTarget = j.goal.scoreTarget; if (!(g.phases || []).length && j.goal.phases) g.phases = j.goal.phases; }
  // 置き換える教材（記録は計画ファイルの教材に引き継ぎ済み）を削除し、同じ名前の教材は二重に入れない
  const replace = new Set(document.getElementById('imp-replace') && document.getElementById('imp-replace').checked ? (j.replaceNames || []) : []);
  const inGoal = store.mats.filter(m => m.goalId === g.id);
  const removed = inGoal.filter(m => replace.has(m.name));
  removed.forEach(m => store.remove('materials', m.id).catch(() => toast('教材を削除できませんでした。あとで手で削除してください。')));
  const keepNames = new Set(inGoal.filter(m => !replace.has(m.name)).map(m => m.name));
  const adds = j.materials.filter(m => !keepNames.has(m.name));
  // 計画ファイルで置き換えると書かれた古い予定（まだ済みにしていないもの）を消す
  const dropEv = new Set(j.removeEventTitles || []);
  const dropped = (g.events || []).filter(ev => dropEv.has(ev.title) && !ev.done).length;
  g.events = (g.events || []).filter(ev => !(dropEv.has(ev.title) && !ev.done));
  const have = new Set((g.events || []).map(ev => ev.date + '|' + ev.title));
  const evs = (j.goal.events || []).filter(ev => !have.has(ev.date + '|' + ev.title)).map(ev => ({ id: uid(), date: ev.date, title: ev.title, done: false }));
  g.events = [...(g.events || []), ...evs];
  save('goals', g);
  adds.forEach((m, i) => saveMat({ ...m, id: newId('m'), createdAt: Date.now() + i, goalId: g.id, log: m.log || {} }));
  ui.pendingImport = null;
  const skipped = j.materials.length - adds.length;
  toast(`「${g.name}」に教材 ${adds.length} 件・予定 ${evs.length} 件を入れました${removed.length ? `（${removed.map(m => m.name).join('・')} は置き換えました）` : ''}${dropped ? `。古い予定 ${dropped} 件を置き換えました` : ''}${skipped ? `。同じ名前の教材 ${skipped} 件は入れていません` : ''}`);
  go('goal', g.id);
}

/* 日付が変わったら、今日の量を組み直して表示する */
let shownDay = P.todayStr();
function checkDay() { if (P.todayStr() !== shownDay) { shownDay = P.todayStr(); render(); } }
setInterval(checkDay, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkDay(); checkNewVersion(); } });
setTimeout(checkNewVersion, 3000);

store.init();
