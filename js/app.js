// RPM の画面。計算は plan.js、保存は store.js。
// 目標（例: 社労士試験・試験日）の中に教材をまとめる。教材の目標日は、試験日と同じにするか、教材ごとに決める。
// 教材は周回型: p.1 から最後まで回り、2周目、3周目……と後の周ほど速く回る（plan.js）。
import * as P from './plan.js?v=20261029a';
import { createStore, cloudAvailable, authMessage } from './store.js?v=20261029a';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = s => { const d = P.toDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = s => { const d = P.toDate(s); return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; };
const ymdw = s => { const d = P.toDate(s); return `${d.getFullYear()}年${mdw(s)}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uw = m => (m.unit === 'q' ? '問' : 'ページ');
const pos = (m, p) => (m.unit === 'q' ? `問${p}` : `p.${p}`);
const range = (m, a, b) => (a === b ? pos(m, a) : `${pos(m, a)}〜${b}`);
const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const ui = { view: 'home', id: null, confirmDel: false, formErr: '', acctMsg: '', acctErr: '', busy: false, presetGoal: null };
// 記録が届いたら描き直す（入力中の登録画面は消さない）
const store = createStore(() => { if (ui.view !== 'form' && ui.view !== 'goalform') render(); });

/* ---------- 目標と教材 ---------- */
const goalById = id => store.goals.find(g => g.id === id) || null;
const goalOf = m => (m.goalId ? goalById(m.goalId) : null);
/** 試験日に合わせる教材は、目標日を試験日に置き換えて計算する */
// 前の形（毎日復習）の記録は、1周目の進みとして読み替える（次に保存したときに新しい形で保存される）
const resolve = m0 => { const m = P.migrate(m0); const g = goalOf(m); return g && m.followGoal ? { ...m, target: g.examDate } : m; };
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
function mosaic(m, d, size) {
  const { count, mark } = P.pageStates(m, d);
  const k = Math.ceil(m.total / (size === 'mini' ? 240 : 600)); // 多いときは数ページを1タイルにまとめる
  let html = '';
  for (let s = 1; s <= m.total; s += k) {
    const e = Math.min(m.total, s + k - 1);
    let c = Infinity, mk = '';
    for (let p = s; p <= e; p++) { c = Math.min(c, count[p]); if (mark[p]) mk = mark[p]; }
    const tip = `${m.name} ${range(m, s, e)}：${c}回${mk === 'today' ? '・今日やる' : ''}`;
    html += `<i class="${mk}" style="${tileColor(m, c)}" title="${esc(tip)}"></i>`;
  }
  return `<div class="mosaic ${size || ''}" role="img" aria-label="${esc(m.name)}の回転モザイク">${html}</div>`;
}
function mosaicLegend(reps) {
  const m = { reps };
  const steps = reps <= 6 ? [...Array(reps)].map((_, i) => i + 1) : [1, Math.ceil(reps / 2), reps];
  return `<div class="legend"><span><i></i>まだ</span>${steps.map(c => `<span><i style="${tileColor(m, c)}"></i>${c}回</span>`).join('')}
    <span><i class="today"></i>今日やる</span></div>`;
}
const legendRel = `<div class="legend"><span><i></i>まだ</span><span><i style="background:color-mix(in oklch, var(--rev) 28%, var(--rev-lo))"></i>1回</span><span><i style="background:color-mix(in oklch, var(--rev) 64%, var(--rev-lo))"></i>半分</span><span><i style="background:var(--rev)"></i>目標の回数</span>
  <span><i class="today"></i>今日やる</span></div>`;

/** 日ごとのモザイク。statusOf(day) が 'full'|'part'|'zero'|'none'|'done' を返す */
function calendar(start, end, d, statusOf, marks) {
  let html = '';
  for (let i = 0; i < P.toDate(start).getDay(); i++) html += '<i class="blank"></i>';
  const names = { full: '全部できた', part: '一部だけ', zero: '記録なし', none: '開始前', done: '完了後' };
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
  <div class="legend"><span><i class="s-full"></i>全部できた</span><span><i class="s-part"></i>一部だけ</span><span><i class="s-zero"></i>記録なし</span><span><i class="s-none"></i>開始前</span><span><i class="future"></i>これから</span><span><i class="future is-mark"></i>${Object.values(marks).includes('試験日') ? '試験日' : '目標日'}</span></div>`;
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
const at = (m, u) => { const w = P.where(m, u); return `${w.r}周目 ${pos(m, w.p)}`; };
function quotaBlock(m, d, t) {
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
  return `<form class="rec" data-rec="${m.id}">
    ${withDate ? `<input type="date" id="rd-${m.id}" value="${d}" max="${P.todayStr()}" min="${m.start}" aria-label="日付">` : ''}
    <select id="rr-${m.id}" aria-label="周目">${opts}</select>
    <span class="lbl">${m.unit === 'q' ? '問' : 'p.'}</span>
    <input type="number" id="rp-${m.id}" min="0" max="${m.total}" inputmode="numeric" placeholder="${ph}" aria-label="どこまで進んだか">
    <span class="lbl">まで進んだ</span>
    <button class="btn primary" type="submit">記録</button>
  </form>`;
}

/* ---------- 画面 ---------- */
function header() {
  const acct = !cloudAvailable() ? '設定' : store.mode === 'cloud' ? '同期中' : 'ログイン・同期';
  return `<div class="top">
    <button class="brand" data-act="home" aria-label="一覧へ"><b>R<i>P</i>M</b><span>回転数で進める学習ノルマ</span></button>
    <div class="top-r">
      <div class="today">今日<strong>${mdw(P.todayStr())}</strong></div>
      <button class="btn sm${store.mode === 'cloud' ? ' synced' : ''}" data-act="account">${acct}</button>
    </div>
  </div>${store.error ? `<div class="note err">${esc(store.error)}</div>` : ''}`;
}
function nag(mats, d) {
  const act = mats.filter(m => { const t = today(m, d); return !t.finished && !t.q.beforeStart; });
  if (!act.length) return '';
  const left = act.map(m => ({ m, t: today(m, d) })).filter(x => x.t.left);
  const st = P.streak(mats, d);
  const head = `<div class="summary"><div class="gauge" aria-hidden="true">${act.map((m, i) => `<i class="${i < act.length - left.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="txt">今日の分 <b class="num">${act.length - left.length}</b> / ${act.length} 教材 完了</div><div class="txt streak">連続達成 <b class="num">${st}</b> 日</div></div>`;
  if (!left.length) return head + '<div class="nag done">今日の分はすべて終わりました。明日もこの調子で。</div>';
  const h = new Date().getHours();
  const keep = st > 0 ? `今日やらないと、${st}日続いた連続達成が 0 に戻ります。` : '';
  const late = left.some(x => (P.pace(x.m, d) || 0) < 0) ? '予定より遅れています。今日の分で取り戻しましょう。' : '';
  let lv, msg;
  if (h < 12) { lv = 1; msg = '今日の分を朝のうちに片付けませんか。'; }
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
      <div class="meta"><span>${esc(paceText(m, d))}</span></div>
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
function goalView() {
  const g = goalById(ui.id);
  if (!g) { ui.view = 'home'; return home(); }
  const d = P.todayStr();
  const mats = matsOfGoal(g);
  const n = P.diffDays(d, g.examDate);
  const totalUnits = mats.reduce((a, m) => a + m.total * m.reps, 0);
  const doneUnits = mats.reduce((a, m) => a + Math.min(sumCount(m, d), m.total * m.reps), 0);
  const leftToday = mats.reduce((a, m) => { const t = today(m, d); return a + (t.finished ? 0 : t.left); }, 0);
  const start = mats.reduce((a, m) => (a && a < m.start ? a : m.start), null);
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
    <div class="stat"><span class="label">教材</span><span class="v num">${mats.length}<small>冊</small></span><span class="s">連続達成 ${P.streak(mats, d)} 日</span></div>
  </div>
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
    ${calendar(start, end, d, day => goalDayStatus(mats.filter(m => m.start <= day), day), { [g.examDate]: '試験日' })}
  </section>
  <section class="panel">
    <h2>周回の予定 <span class="label">教材ごと・いまのペースで計算</span></h2>
    <div class="gm">${mats.map(m => `<div class="gm-row"><span class="gm-name">${esc(m.name)}</span><div>${roundsPanel(m, d, false)}</div></div>`).join('')}</div>
  </section>` : ''}
  <section class="panel">
    <div class="dhead"><h2>教材</h2><button class="btn primary sm" data-act="add" data-goal="${g.id}">＋ この目標に教材を登録</button></div>
    ${mats.length ? `<div class="cards">${mats.map(m => card(m, d)).join('')}</div>` : '<div class="sub">まだ教材がありません。</div>'}
  </section>
  <section class="panel">
    <h2>この目標を削除</h2>
    <div class="actions">${ui.confirmDel
      ? `<span class="err-text">目標「${esc(g.name)}」を削除します。中の教材と記録は消えずに「目標なし」に移ります。</span><button class="btn danger solid" data-act="delgoal" data-id="${g.id}">削除する</button><button class="btn" data-act="nodel">やめる</button>`
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
    return `<tr><td>${mdw(k)}</td><td>${e[0]}周目 ${pos(m, e[1])} まで</td><td class="num">+${Math.max(0, gOf(e) - prev)}</td>
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
          <label><input type="radio" name="f-unit" value="p"${v.unit !== 'q' ? ' checked' : ''}><span>ページ</span></label>
          <label><input type="radio" name="f-unit" value="q"${v.unit === 'q' ? ' checked' : ''}><span>問題</span></label>
        </div></div>
      <div class="field"><label for="f-total">ページ数・問題数</label><input id="f-total" type="number" min="1" max="5000" inputmode="numeric" required value="${esc(v.total)}" placeholder="例: 320"></div>
      <div class="field"><label for="f-start">開始日</label><input id="f-start" type="date" required value="${v.start}"></div>
      <div class="field"><label for="f-target">目標日</label>
        <label class="check" id="f-follow-wrap"><input type="checkbox" id="f-follow"${v.followGoal !== false ? ' checked' : ''}> <span id="f-follow-txt">試験日と同じ</span></label>
        <input id="f-target" type="date" required value="${v.target}"><span class="hint">この日までに、すべてのページを目標の回数やり終える計画にします。試験より前に仕上げたい教材は、チェックを外して早い日にします。</span></div>
      <div class="field"><label for="f-reps">目標の回転数</label><input id="f-reps" type="number" min="1" max="10" inputmode="numeric" required value="${v.reps}"><span class="hint">教材を何周するか。1周目を最後まで終えてから、2周目を p.1 から始めます。</span></div>
      <div class="field"><label for="f-speed">2周目以降の速さ</label><select id="f-speed">${P.SPEEDS.map(([s, t]) => `<option value="${s}"${(v.speed ?? P.DEFAULT_SPEED) === s ? ' selected' : ''}>${t}</option>`).join('')}</select><span class="hint">「半分」なら、2周目は1周目の半分、3周目はさらに半分の日数で回る計画にします。忘れる前に次の周が来るようにするためです。</span></div>
      <div class="full plan-preview" id="preview" aria-live="polite"></div>
      ${ui.formErr ? `<div class="full err-text">${esc(ui.formErr)}</div>` : ''}
      <div class="actions full"><button class="btn primary" type="submit">${m ? '変更を保存' : '登録する'}</button></div>
    </form>
  </section>`;
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
  return {
    name: val('f-name'), total: Number(val('f-total')), start: val('f-start'),
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
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="${g ? 'goal' : 'home'}" data-id="${g ? g.id : ''}">← もどる</button></div>
  <section class="panel">
    <h2>${g ? '目標を編集' : '目標を作る'}</h2>
    <form class="form" id="goalform">
      <div class="field full"><label for="g-name">目標の名前</label><input id="g-name" required maxlength="40" value="${esc(v.name)}" placeholder="例: 社労士試験 2027"></div>
      <div class="field"><label for="g-exam">試験日</label><input id="g-exam" type="date" required value="${v.examDate}"><span class="hint">「試験日と同じ」にした教材は、この日に合わせて計画します。試験日を変えると、その教材の計画も組み直します。</span></div>
      ${ui.formErr ? `<div class="full err-text">${esc(ui.formErr)}</div>` : ''}
      <div class="actions full"><button class="btn primary" type="submit">${g ? '変更を保存' : '作る'}</button></div>
    </form>
  </section>`;
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
  <section class="panel"><h2>ログイン・同期</h2>${body}
    ${ui.acctErr ? `<div class="err-text">${esc(ui.acctErr)}</div>` : ''}${ui.acctMsg ? `<div class="ok">${esc(ui.acctMsg)}</div>` : ''}
  </section>
  <section class="panel"><h2>画面の明るさ</h2>
    <div class="seg theme">${opt('light', '明るい', 'おすすめ。文字が読みやすい')}${opt('dark', '暗い', '夜・暗い部屋で')}${opt('auto', '端末に合わせる', '')}</div>
  </section>
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
  app.innerHTML = (views[ui.view] || home)();
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
  else if (act === 'logout') store.logout().then(() => toast('ログアウトしました。この端末だけの記録を表示しています'));
  else if (act === 'move') store.moveLocalToCloud().then(n => { toast(`${n}件の教材をアカウントに移しました`); render(); }).catch(() => toast('移せませんでした。通信を確かめてください'));
  else if (act === 'reset') {
    const email = document.getElementById('a-email').value.trim();
    if (!email) { ui.acctErr = 'メールアドレスを入れてから「パスワードを忘れた」を押してください。'; render(); return; }
    store.resetPassword(email).then(() => { ui.acctErr = ''; ui.acctMsg = 'パスワードを設定し直すためのメールを送りました。'; render(); })
      .catch(err => { ui.acctErr = authMessage(err); render(); });
  }
  else if (act === 'export') exportAll();
});

document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target;
  if (f.id === 'matform') return saveForm();
  if (f.id === 'goalform') return saveGoalForm();
  if (f.id === 'loginform') return doLogin(e.submitter && e.submitter.dataset.mode);
  const id = f.dataset.rec;
  const m = id && byId(id);
  if (!m) return;
  const raw = document.getElementById('rp-' + id).value.trim();
  const r = Number(document.getElementById('rr-' + id).value);
  const dateEl = document.getElementById('rd-' + id);
  const day = dateEl ? dateEl.value : P.todayStr();
  if (!day || day > P.todayStr()) return toast('日付は今日までの日を選んでください');
  if (raw === '') return toast('どこまで進んだか、数字を入れてください');
  const res = P.recordProgress(m, day, r, Number(raw));
  if (res.error) return toast(res.error);
  const t = today(res.m, P.todayStr());
  const g = P.posThrough(res.m, day);
  const roundDone = g > P.posBefore(m, day) && g % m.total === 0;
  saveMat(res.m, day !== P.todayStr() ? `${mdw(day)}の分を記録しました`
    : t.finished ? `${m.reps}回転、すべて終わりました！おつかれさまでした`
    : roundDone ? `${g / m.total}周目が終わりました！次は${g / m.total + 1}周目の${pos(m, 1)}からです`
    : !t.left ? '今日のノルマ達成です' : `記録しました。今日はあと${t.left}${uw(m)}`);
});
document.addEventListener('input', e => { if (e.target.closest('#matform')) updatePreview(); });
document.addEventListener('change', e => {
  if (e.target.id === 'importfile') importFile(e.target.files[0]);
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
  const g = old ? { ...old, name, examDate } : { id: newId('g'), createdAt: Date.now(), name, examDate };
  save('goals', g, old ? '目標を保存しました。教材の計画を組み直しました' : `目標「${name}」を作りました。教材を登録しましょう`);
  if (old) go('goal', g.id); else go('form', null, { goal: g.id });
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
      const materials = j && j.app === 'RPM' && Array.isArray(j.materials) ? j.materials : null;
      const goals = j && Array.isArray(j.goals) ? j.goals : [];
      if (!materials || materials.some(m => !m.id || !m.name || !Number.isInteger(m.total)) || goals.some(g => !g.id || !g.name || !g.examDate)) throw new Error('bad');
      store.importAll({ materials, goals }).then(() => toast(`教材 ${materials.length} 件・目標 ${goals.length} 件を読み込みました`)).catch(() => toast('読み込んだ記録を保存できませんでした'));
    } catch (err) { toast('RPM のバックアップファイルではないため、読み込めませんでした'); }
  };
  rd.onerror = () => toast('ファイルを開けませんでした');
  rd.readAsText(file);
}

/* 日付が変わったら、今日の量を組み直して表示する */
let shownDay = P.todayStr();
function checkDay() { if (P.todayStr() !== shownDay) { shownDay = P.todayStr(); render(); } }
setInterval(checkDay, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });

store.init();
