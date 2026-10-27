// RPM の画面。計算は plan.js、保存は store.js。
import * as P from './plan.js';
import { createStore, cloudAvailable, authMessage } from './store.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];
const md = s => { const d = P.toDate(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = s => { const d = P.toDate(s); return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uw = m => (m.unit === 'q' ? '問' : 'ページ');
const pos = (m, p) => (m.unit === 'q' ? `問${p}` : `p.${p}`);
const range = (m, a, b) => (a === b ? pos(m, a) : `${pos(m, a)}〜${b}`);
const newId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const ui = { view: 'home', id: null, confirmDel: false, formErr: '', acctMsg: '', acctErr: '', busy: false };
// 記録が届いたら描き直す（入力中の登録画面は消さない）
const store = createStore(() => { if (ui.view !== 'form') render(); });
const byId = id => store.mats.find(m => m.id === id);
const sorted = () => store.mats.slice().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000);
}
function save(m, msg) {
  store.save(m).catch(() => toast(store.mode === 'cloud'
    ? '保存できませんでした。通信状態を確かめて、もう一度記録してください。'
    : 'この端末に保存できませんでした。ブラウザの設定（プライベートモードなど）を確かめてください。'));
  if (msg) toast(msg);
}

/* ---------- 部品 ---------- */
function tileColor(m, c) {
  if (c <= 0) return '';
  const pct = m.reps === 1 ? 100 : Math.round(28 + 72 * (c - 1) / (m.reps - 1));
  return `background:color-mix(in oklch, var(--rev) ${pct}%, var(--rev-lo))`;
}
function mosaic(m, d, mini) {
  const { count, mark } = P.pageStates(m, d);
  const k = Math.ceil(m.total / (mini ? 240 : 600)); // 多いときは数ページを1タイルにまとめる
  let html = '';
  for (let s = 1; s <= m.total; s += k) {
    const e = Math.min(m.total, s + k - 1);
    let c = Infinity, mk = '';
    for (let p = s; p <= e; p++) { c = Math.min(c, count[p]); if (mark[p] === 'late') mk = 'late'; else if (mark[p] && !mk) mk = mark[p]; }
    const tip = `${range(m, s, e)}：${c}回${mk === 'late' ? '・復習が遅れています' : mk === 'today' ? '・今日やる' : ''}`;
    html += `<i class="${mk}" style="${tileColor(m, c)}" title="${esc(tip)}"></i>`;
  }
  return `<div class="mosaic${mini ? ' mini' : ''}" role="img" aria-label="ページごとの回転モザイク">${html}</div>`;
}
function mosaicLegend(m) {
  const steps = m.reps <= 6 ? [...Array(m.reps)].map((_, i) => i + 1) : [1, Math.ceil(m.reps / 2), m.reps];
  return `<div class="legend"><span><i></i>0回</span>${steps.map(c => `<span><i style="${tileColor(m, c)}"></i>${c}回</span>`).join('')}
    <span><i class="today"></i>今日やる</span><span><i class="late"></i>復習が遅れている</span></div>`;
}
function calendar(m, d) {
  const end = m.target > d ? m.target : d;
  let html = '';
  for (let i = 0; i < P.toDate(m.start).getDay(); i++) html += '<i class="blank"></i>';
  const names = { full: '全部できた', part: '一部だけ', zero: '記録なし', none: 'やることなし', done: '完了後' };
  for (let i = 0; i <= P.diffDays(m.start, end); i++) {
    const day = P.addDays(m.start, i);
    let cls, tip;
    if (day > d) { cls = 'future'; tip = '予定'; }
    else { const st = P.dayStatus(m, day); cls = 's-' + st; tip = day === d && (st === 'part' || st === 'zero') ? '今日（途中）' : names[st]; }
    if (day === d) cls += ' is-today';
    if (day === P.newCutoff(m)) tip += '・新しく学ぶ締切';
    if (day === m.target) tip += '・目標日';
    html += `<i class="${cls}" title="${mdw(day)}：${tip}"></i>`;
  }
  const dl = WD.map((w, i) => `<span>${i % 2 ? w : ''}</span>`).join('');
  return `<div class="cal-wrap"><div class="cal-days">${dl}</div><div class="cal-scroll"><div class="cal" role="img" aria-label="日ごとの達成モザイク">${html}</div></div></div>
  <div class="legend"><span><i class="s-full"></i>全部できた</span><span><i class="s-part"></i>一部だけ</span><span><i class="s-zero"></i>記録なし</span><span><i class="s-none"></i>やることなし</span><span><i class="future"></i>これから</span></div>`;
}
/** これから14日の復習の量 */
function upcoming(m, d) {
  const days = [...Array(14)].map((_, i) => P.addDays(d, i + 1));
  const load = days.map(day => (m.batches || []).reduce((a, b) => (P.nextDue(m, b) === day ? a + b.to - b.from + 1 : a), 0));
  const max = Math.max(1, ...load);
  const cols = days.map((day, i) => `<div class="up-col" title="${mdw(day)}：復習 ${load[i]}${uw(m)}"><span class="up-n num">${load[i] || ''}</span><i style="height:${Math.round(load[i] / max * 100)}%"></i><span class="up-d">${P.toDate(day).getDate()}</span></div>`).join('');
  return `<div class="up" role="img" aria-label="これから14日の復習の量">${cols}</div>`;
}
function today(m, d) {
  const q = P.newQuota(m, d);
  const r = P.reviewsFor(m, d);
  const newDone = Math.max(0, P.learnedThrough(m, d) - q.g0);
  const newLeft = Math.max(0, q.units - newDone);
  return { q, r, newDone, newLeft, revLeft: r.due.length, finished: P.isFinished(m, d) };
}
function statusPill(m, d) {
  const t = today(m, d);
  if (t.finished) return '<span class="pill rev">完了</span>';
  if (t.q.beforeStart) return `<span class="pill muted">${md(m.start)}から開始</span>`;
  let s;
  if (!t.newLeft && !t.revLeft) s = '<span class="pill good">今日の分は完了</span>';
  else {
    const parts = [];
    if (t.newLeft) parts.push(`新しく${t.newLeft}`);
    if (t.revLeft) parts.push(`復習${t.revLeft}件`);
    s = `<span class="pill warn">あと ${parts.join('・')}</span>`;
  }
  if (t.q.overdue && !t.q.allLearned) s += ' <span class="pill bad">新しく学ぶ締切を過ぎています</span>';
  if (t.r.due.some(x => x.late > 0)) s += ' <span class="pill bad">復習が遅れています</span>';
  return s;
}
function paceText(m, d) {
  const p = P.pace(m, d);
  if (p === null || P.learnedBefore(m, d) >= m.total) return '';
  if (p === 0) return '新しく学ぶペース: 予定どおり';
  return p > 0 ? `新しく学ぶペース: 予定より ${p}${uw(m)} 先行` : `新しく学ぶペース: 予定より ${-p}${uw(m)} 遅れ`;
}
const avgRot = (m, d) => {
  const { count } = P.pageStates(m, d);
  let s = 0; for (let p = 1; p <= m.total; p++) s += count[p];
  return s / m.total;
};
function newBlock(m, d, t) {
  if (t.q.allLearned && P.learnedBefore(m, d) >= m.total) return '';
  const bar = t.q.units ? Math.min(100, Math.round(t.newDone / t.q.units * 100)) : 100;
  return `<div class="task">
    <div class="task-h"><span class="label">新しく進める</span>${t.newLeft ? '' : '<span class="ok">✓ 完了</span>'}</div>
    <div class="big"><span class="n num">${t.q.units}</span><span class="u">${uw(m)}</span><span class="rg">${range(m, t.q.g0 + 1, t.q.gT)}</span></div>
    <div class="bar" title="今日の進み ${t.newDone}/${t.q.units}"><i style="width:${bar}%"></i></div>
    ${t.q.beforeStart ? '' : recForm(m, d, false)}
  </div>`;
}
function recForm(m, d, withDate) {
  const g = P.learnedThrough(m, d);
  return `<form class="rec" data-rec="${m.id}">
    ${withDate ? `<input type="date" id="rd-${m.id}" value="${d}" max="${P.todayStr()}" min="${m.start}" aria-label="日付">` : ''}
    <span class="lbl">${m.unit === 'q' ? '問' : 'p.'}</span>
    <input type="number" id="rp-${m.id}" min="0" max="${m.total}" inputmode="numeric" placeholder="${g || ''}" aria-label="どこまで進んだか">
    <span class="lbl">まで進んだ</span>
    <button class="btn primary" type="submit">記録</button>
  </form>`;
}
function reviewBlock(m, d, t) {
  if (!t.r.due.length && !t.r.doneToday.length) return '';
  const items = t.r.due.map(x => `<li><span><b>${range(m, x.b.from, x.b.to)}</b> <span class="sub">${x.rep}回目${x.late > 0 ? ` <em class="late-t">${x.late}日遅れ</em>` : ''}</span></span>
      <button class="btn primary sm" data-act="rev" data-id="${m.id}" data-from="${x.b.from}">復習した</button></li>`).join('')
    + t.r.doneToday.map(x => `<li class="done"><span>✓ <b>${range(m, x.b.from, x.b.to)}</b> <span class="sub">${x.rep}回目</span></span>
      <button class="btn ghost sm" data-act="undo" data-id="${m.id}" data-from="${x.b.from}">取り消す</button></li>`).join('');
  return `<div class="task">
    <div class="task-h"><span class="label">復習（忘れる前に）</span>${t.revLeft ? `<span class="sub">${P.pagesOf(t.r.due)}${uw(m)}</span>` : '<span class="ok">✓ 完了</span>'}</div>
    <ul class="revs">${items}</ul>
  </div>`;
}

/* ---------- 画面 ---------- */
function header() {
  const acct = !cloudAvailable() ? 'バックアップ' : store.mode === 'cloud' ? '同期中' : 'ログイン・同期';
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
  const left = act.map(m => ({ m, t: today(m, d) })).filter(x => x.t.newLeft || x.t.revLeft);
  const st = P.streak(mats, d);
  const head = `<div class="summary"><div class="gauge" aria-hidden="true">${act.map((m, i) => `<i class="${i < act.length - left.length ? 'on' : ''}"></i>`).join('')}</div>
    <div class="txt">今日の分 <b class="num">${act.length - left.length}</b> / ${act.length} 教材 完了</div><div class="txt streak">連続達成 <b class="num">${st}</b> 日</div></div>`;
  if (!left.length) return head + '<div class="nag done">今日の分はすべて終わりました。明日もこの調子で。</div>';
  const h = new Date().getHours();
  const keep = st > 0 ? `今日やらないと、${st}日続いた連続達成が 0 に戻ります。` : '';
  const late = left.some(x => x.t.r.due.some(y => y.late > 0)) ? '復習が遅れると、覚えたことをどんどん忘れていきます。' : '';
  let lv, msg;
  if (h < 12) { lv = 1; msg = '今日の分を朝のうちに片付けませんか。'; }
  else if (h < 18) { lv = 2; msg = `まだ今日の分が残っています。${late || keep}`; }
  else if (h < 22) { lv = 3; msg = `夜になりました。${keep || late || '今からやりましょう。'}`; }
  else { lv = 4; msg = `今日が終わるまであと${24 - h}時間もありません。${keep}5分だけでも開きましょう。`; }
  const list = left.map(x => `${esc(x.m.name)}（${[x.t.newLeft ? `新しく${x.t.newLeft}${uw(x.m)}` : '', x.t.revLeft ? `復習${x.t.revLeft}件` : ''].filter(Boolean).join('・')}）`).join('、');
  return head + `<div class="nag lv${lv}"><b>${msg}</b><span>${list}</span></div>`;
}
function card(m, d) {
  const t = today(m, d);
  let main;
  if (t.finished) main = `<div class="big"><span class="n num">${m.reps}</span><span class="u">回転 完了</span></div><div class="sub">おつかれさまでした。すべてのページを目標の回数やり終えました。</div>`;
  else {
    main = newBlock(m, d, t) + reviewBlock(m, d, t);
    if (!main) main = '<div class="sub">今日やる分はありません。次の復習日まで休みです。</div>';
  }
  return `<article class="card">
    <div class="head"><h2>${esc(m.name)}</h2>${statusPill(m, d)}</div>
    <div class="quota">${main}</div>
    <div class="side">
      ${mosaic(m, d, true)}
      <div class="meta"><span>平均 <b class="num">${avgRot(m, d).toFixed(1)}</b> / ${m.reps} 回転</span><span>目標日 <b class="num">${md(m.target)}</b></span></div>
      <div class="meta"><span>${esc(paceText(m, d))}</span></div>
    </div>
    <button class="btn ghost more" data-act="open" data-id="${m.id}">詳しく見る・記録を直す →</button>
  </article>`;
}
function home() {
  const d = P.todayStr();
  const mats = sorted();
  if (!store.ready) return header() + '<div class="note">読み込み中です…</div>';
  if (!mats.length) {
    return header() + `<div class="empty">
      <h2>教材を登録しましょう</h2>
      <p>教材の名前、ページ数（または問題数）、開始日、目標日、目標の回転数を入れると、今日やる量が出ます。新しく進める分に加えて、忘れかけたころに復習の分が出ます（1日後・3日後・7日後・14日後・30日後）。</p>
      <div class="actions"><button class="btn primary" data-act="add">教材を登録する</button><button class="btn" data-act="sample">サンプル教材で試す</button></div>
    </div>`;
  }
  return header() + nag(mats, d) + `<div class="cards">${mats.map(m => card(m, d)).join('')}</div>
    <div class="actions"><button class="btn" data-act="add">＋ 教材を登録する</button></div>`;
}
function detail() {
  const m = byId(ui.id);
  if (!m) { ui.view = 'home'; return home(); }
  const d = P.todayStr();
  const t = today(m, d);
  const iv = P.effIntervals(m);
  const bs = (m.batches || []).slice().sort((a, b) => b.from - a.from);
  const rows = bs.map((b, i) => `<tr><td>${range(m, b.from, b.to)}</td><td>${b.done.map(md).join(' → ')}</td><td class="num">${b.done.length}/${m.reps}</td>
    <td>${P.isComplete(m, b) ? '完了' : `次 ${md(P.nextDue(m, b))}`}</td>
    <td>${(b.done.length > 1 || i === 0) ? `<button class="btn ghost sm" data-act="undo" data-id="${m.id}" data-from="${b.from}">最後の1回を取り消す</button>` : ''}</td></tr>`).join('');
  const todayPages = (t.finished ? 0 : t.newLeft) + P.pagesOf(t.r.due);
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="home">← 一覧へ</button></div>
  <div class="dhead"><h1>${esc(m.name)}</h1>${statusPill(m, d)}</div>
  <div class="stats">
    <div class="stat"><span class="label">平均の回転数</span><span class="v num">${avgRot(m, d).toFixed(2)}<small>/ ${m.reps}</small></span><span class="s">学んだページ ${P.learnedThrough(m, d)} / ${m.total}</span></div>
    <div class="stat"><span class="label">今日の残り</span><span class="v num">${todayPages}<small>${uw(m)}</small></span><span class="s">新しく ${t.newLeft}・復習 ${P.pagesOf(t.r.due)}</span></div>
    <div class="stat"><span class="label">新しく学ぶ締切</span><span class="v num">${md(P.newCutoff(m))}</span><span class="s">そのあとは復習だけ</span></div>
    <div class="stat"><span class="label">目標日</span><span class="v num">${md(m.target)}</span><span class="s">あと ${Math.max(0, P.diffDays(d, m.target))} 日</span></div>
  </div>
  ${P.isCompressed(m) ? `<div class="note">期間に収めるため、復習の間隔を ${iv.join('→')} 日に縮めています（設定は ${P.baseIntervals(m).join('→')} 日）。</div>` : ''}
  <section class="panel">
    <h2>回転モザイク <span class="label">1タイル＝1${uw(m)}・色が濃いほど回数が多い</span></h2>
    ${mosaic(m, d, false)}
    ${mosaicLegend(m)}
    <div class="sub">${esc(paceText(m, d))}</div>
  </section>
  <section class="panel">
    <h2>これから2週間の復習 <span class="label">日ごとの${uw(m)}数</span></h2>
    ${upcoming(m, d)}
  </section>
  <section class="panel">
    <h2>日ごとの達成 <span class="label">${md(m.start)} 〜 ${md(m.target)}</span></h2>
    ${calendar(m, d)}
  </section>
  <section class="panel">
    <h2>記録する・直す</h2>
    <div class="sub">日付を変えると、記録し忘れた日の分も入れられます（その日より後の記録がない場合のみ）。</div>
    ${recForm(m, d, true)}
    ${rows ? `<div class="table-scroll"><table class="log"><thead><tr><th>範囲</th><th>やった日</th><th>回数</th><th>次の復習</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="sub">まだ記録がありません。</div>'}
  </section>
  <section class="panel">
    <h2>設定</h2>
    <div class="meta"><span>全 <b class="num">${m.total}</b> ${uw(m)}</span><span>開始日 <b class="num">${md(m.start)}</b></span><span>目標日 <b class="num">${md(m.target)}</b></span><span>目標 <b class="num">${m.reps}</b> 回転</span><span>復習の間隔 <b class="num">${P.baseIntervals(m).join('→')}</b> 日</span></div>
    <div class="actions">
      <button class="btn" data-act="edit" data-id="${m.id}">設定を変える</button>
      ${ui.confirmDel
        ? `<span class="err-text">「${esc(m.name)}」と記録をすべて削除します。元に戻せません。</span><button class="btn danger solid" data-act="del" data-id="${m.id}">削除する</button><button class="btn" data-act="nodel">やめる</button>`
        : '<button class="btn danger" data-act="askdel">この教材を削除</button>'}
    </div>
  </section>`;
}
function form() {
  const m = ui.id ? byId(ui.id) : null;
  const d = P.todayStr();
  const v = m || { name: '', unit: 'p', total: '', start: d, target: P.addDays(d, 90), reps: 5, intervals: P.DEFAULT_INTERVALS };
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="${m ? 'open' : 'home'}" data-id="${m ? m.id : ''}">← もどる</button></div>
  <section class="panel">
    <h2>${m ? '設定を変える' : '教材を登録する'}</h2>
    <form class="form" id="matform">
      <div class="field full"><label for="f-name">教材の名前</label><input id="f-name" required maxlength="60" value="${esc(v.name)}" placeholder="例: 社労士 過去問題集 2027年版"></div>
      <div class="field"><label>数える単位</label>
        <div class="seg">
          <label><input type="radio" name="f-unit" value="p"${v.unit !== 'q' ? ' checked' : ''}><span>ページ</span></label>
          <label><input type="radio" name="f-unit" value="q"${v.unit === 'q' ? ' checked' : ''}><span>問題</span></label>
        </div></div>
      <div class="field"><label for="f-total">ページ数・問題数</label><input id="f-total" type="number" min="1" max="5000" inputmode="numeric" required value="${esc(v.total)}" placeholder="例: 320"></div>
      <div class="field"><label for="f-start">開始日</label><input id="f-start" type="date" required value="${v.start}"></div>
      <div class="field"><label for="f-target">目標日</label><input id="f-target" type="date" required value="${v.target}"><span class="hint">この日までに、すべてのページを目標の回数やり終える計画にします。</span></div>
      <div class="field"><label for="f-reps">目標の回転数</label><input id="f-reps" type="number" min="1" max="10" inputmode="numeric" required value="${v.reps}"><span class="hint">1ページを何回やるか。1回目が新しく学ぶ日、2回目からが復習です。</span></div>
      <div class="field"><label for="f-iv">復習の間隔（日）</label><input id="f-iv" value="${esc((v.intervals || P.DEFAULT_INTERVALS).join(','))}" inputmode="numeric"><span class="hint">前回やった日から何日後に復習するか。エビングハウスの忘却曲線にもとづく 1,3,7,14,30 が標準です。</span></div>
      <div class="full plan-preview" id="preview" aria-live="polite"></div>
      ${ui.formErr ? `<div class="full err-text">${esc(ui.formErr)}</div>` : ''}
      <div class="actions full"><button class="btn primary" type="submit">${m ? '変更を保存' : '登録する'}</button></div>
    </form>
  </section>`;
}
function readForm() {
  const val = id => document.getElementById(id).value.trim();
  return {
    name: val('f-name'), total: Number(val('f-total')), start: val('f-start'), target: val('f-target'),
    reps: Number(val('f-reps')), intervals: P.parseIntervals(val('f-iv')),
    unit: document.querySelector('input[name="f-unit"]:checked').value
  };
}
function updatePreview() {
  const el = document.getElementById('preview');
  if (!el) return;
  const v = readForm();
  if (P.validateMaterial(v)) { el.textContent = ''; return; }
  const m = { ...v, batches: [] };
  const cut = P.newCutoff(m);
  const days = P.diffDays(m.start, cut) + 1;
  const iv = P.effIntervals(m);
  el.innerHTML = `この計画では: 新しく進めるのは <b>${mdw(cut)}</b> まで（1日あたり約 <b>${Math.ceil(m.total / days)}${uw(m)}</b>）。`
    + (m.reps > 1 ? `復習は ${iv.map(x => x + '日後').join('→')}。` : '')
    + (P.isCompressed(m) ? '<br><span class="late-t">期間が短いため、復習の間隔を縮めています。目標日を延ばすか回転数を減らすと、忘却曲線どおりの間隔で復習できます。</span>' : '');
}
function account() {
  const local = store.localMats();
  let body;
  if (!cloudAvailable()) {
    body = `<div class="sub">同期の機能はまだ準備されていません（管理者が Firebase を設定すると使えるようになります）。今の記録はこの端末の中だけにあります。</div>`;
  } else if (store.mode === 'cloud') {
    body = `<div class="meta"><span>ログイン中: <b>${esc(store.user.email)}</b></span></div>
      <div class="sub">記録はアカウントに保存され、同じメールアドレスでログインしたスマホ・PCで同じ内容が見えます。</div>
      ${local.length ? `<div class="note">この端末だけに保存された教材が ${local.length} 件あります。<div class="actions"><button class="btn primary" data-act="move">アカウントに移す</button></div></div>` : ''}
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
  return `${header()}
  <div class="dhead"><button class="btn ghost" data-act="home">← 一覧へ</button></div>
  <section class="panel"><h2>ログイン・同期</h2>${body}
    ${ui.acctErr ? `<div class="err-text">${esc(ui.acctErr)}</div>` : ''}${ui.acctMsg ? `<div class="ok">${esc(ui.acctMsg)}</div>` : ''}
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
  const keep = document.activeElement && document.activeElement.id;
  app.innerHTML = ui.view === 'detail' ? detail() : ui.view === 'form' ? form() : ui.view === 'account' ? account() : home();
  if (ui.view === 'form') updatePreview();
  if (keep && ui.view !== 'home') { const el = document.getElementById(keep); if (el && el.tagName === 'INPUT' && el.type !== 'number') el.focus(); }
  window.scrollTo(0, y);
}
function go(view, id) {
  ui.view = view; ui.id = id || null; ui.confirmDel = false; ui.formErr = ''; ui.acctErr = ''; ui.acctMsg = '';
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
  else if (act === 'add') go('form');
  else if (act === 'edit') go('form', id);
  else if (act === 'account') go('account');
  else if (act === 'askdel') { ui.confirmDel = true; render(); }
  else if (act === 'nodel') { ui.confirmDel = false; render(); }
  else if (act === 'del') { store.remove(id).catch(() => toast('削除できませんでした。もう一度お試しください。')); go('home'); toast(`「${m.name}」を削除しました`); }
  else if (act === 'rev') {
    const r = P.recordReview(m, Number(b.dataset.from), P.todayStr());
    const left = today(r.m, P.todayStr());
    save(r.m, !left.newLeft && !left.revLeft ? '今日の分はすべて完了です' : '復習を記録しました');
  }
  else if (act === 'undo') {
    const r = P.undoLast(m, Number(b.dataset.from));
    if (r.error) toast(r.error); else save(r.m, '取り消しました');
  }
  else if (act === 'sample') addSample();
  else if (act === 'logout') store.logout().then(() => toast('ログアウトしました。この端末だけの記録を表示しています'));
  else if (act === 'move') store.moveLocalToCloud().then(n => { toast(`${n}件をアカウントに移しました`); render(); }).catch(() => toast('移せませんでした。通信を確かめてください'));
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
  if (f.id === 'loginform') return doLogin(e.submitter && e.submitter.dataset.mode);
  const id = f.dataset.rec;
  const m = id && byId(id);
  if (!m) return;
  const raw = document.getElementById('rp-' + id).value.trim();
  const dateEl = document.getElementById('rd-' + id);
  const day = dateEl ? dateEl.value : P.todayStr();
  if (!day || day > P.todayStr()) return toast('日付は今日までの日を選んでください');
  if (raw === '') return toast('どこまで進んだか、数字を入れてください');
  const r = P.recordNew(m, day, Number(raw));
  if (r.error) return toast(r.error);
  const t = today(r.m, P.todayStr());
  save(r.m, day !== P.todayStr() ? `${mdw(day)}の分を記録しました` : P.learnedThrough(r.m, day) >= m.total ? '全ページを1回やり終えました。あとは復習です' : !t.newLeft ? (t.revLeft ? `新しく進める分は完了。あとは復習${t.revLeft}件です` : '今日の分はすべて完了です') : `記録しました。新しく進める分はあと${t.newLeft}${uw(m)}`);
});
document.addEventListener('input', e => { if (e.target.closest('#matform')) updatePreview(); });
document.addEventListener('change', e => { if (e.target.id === 'importfile') importFile(e.target.files[0]); });

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
  const old = ui.id ? byId(ui.id) : null;
  if (old && (old.batches || []).some(b => b.to > v.total)) { ui.formErr = `すでに ${pos(old, P.learnedThrough(old, P.todayStr()))} まで記録があるため、それより少ない数にはできません。`; render(); return; }
  const m = old ? { ...old, ...v } : { id: newId(), createdAt: Date.now(), batches: [], ...v };
  save(m, old ? '設定を保存しました。今日の量を計算し直しました' : `「${v.name}」を登録しました`);
  go(old ? 'detail' : 'home', old ? m.id : null);
}
function addSample() {
  const d = P.todayStr();
  let m = { id: newId(), createdAt: Date.now(), name: '【サンプル】社労士 過去問題集', unit: 'q', total: 300, start: P.addDays(d, -20), target: P.addDays(d, 70), reps: 5, intervals: P.DEFAULT_INTERVALS, batches: [] };
  // 20日前から、ほぼ毎日やった例（記録のない日と、復習をためた日を少し入れる）
  for (let i = 20; i >= 1; i--) {
    const day = P.addDays(d, -i);
    if (i === 9 || i === 4) continue;
    if (i !== 2) for (const x of P.reviewsFor(m, day).due) m = P.recordReview(m, x.b.from, day).m;
    const q = P.newQuota(m, day);
    m = P.recordNew(m, day, Math.min(m.total, q.gT + (i % 5 === 0 ? -3 : 1))).m;
  }
  save(m, 'サンプル教材を入れました。いらなくなったら「詳しく見る」から削除できます');
}
function exportAll() {
  const data = JSON.stringify({ app: 'RPM', version: 2, exportedAt: new Date().toISOString(), materials: store.mats }, null, 1);
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
      const list = (j && j.app === 'RPM' && Array.isArray(j.materials)) ? j.materials : null;
      if (!list || list.some(m => !m.id || !m.name || !Number.isInteger(m.total))) throw new Error('bad');
      store.importAll(list).then(() => toast(`${list.length}件の教材を読み込みました`)).catch(() => toast('読み込んだ記録を保存できませんでした'));
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
