// 計算のテスト（周回型）。実行: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/plan.js';

const base = (o = {}) => ({ name: 'テスト教材', unit: 'p', total: 300, start: '2026-11-01', target: '2027-01-29', reps: 3, speed: 0.5, log: {}, ...o });

/** 毎日、出たとおりにやったときの記録を作る */
function simulate(m, until, skip = () => false) {
  for (let d = m.start; d <= until; d = P.addDays(d, 1)) {
    if (skip(d)) continue;
    const q = P.quota(m, d);
    if (q.finished) break;
    const w = P.where(m, q.gT);
    m = P.recordProgress(m, d, w.r, w.p).m;
  }
  return m;
}

test('毎日ノルマどおりにやると、目標日ちょうどに目標の回転数を終える', () => {
  const m = simulate(base(), '2027-01-29');
  assert.equal(P.isFinished(m, '2027-01-29'), true);
  assert.equal(P.isFinished(m, '2027-01-28'), false);
});

test('1周目が終わるまでは、毎日のノルマは1周目のページだけ', () => {
  let m = base();
  for (let d = m.start; ; d = P.addDays(d, 1)) {
    const q = P.quota(m, d);
    if (q.g0 >= m.total) break;
    assert.equal(P.where(m, q.g0 + 1).r, 1); // 今日の始まりは1周目
    const w = P.where(m, q.gT);
    m = P.recordProgress(m, d, w.r, w.p).m;
  }
});

test('後の周ほど速い: 速さ0.5なら、2周目の日数は1周目のおよそ半分', () => {
  const m = simulate(base(), '2027-01-29');
  const plan = P.roundPlan(m, '2027-01-30');
  const d1 = P.diffDays(m.start, plan[0].date) + 1;
  const d2 = P.diffDays(plan[0].date, plan[1].date);
  const d3 = P.diffDays(plan[1].date, plan[2].date);
  assert.ok(Math.abs(d2 - d1 / 2) <= 2, `1周目${d1}日・2周目${d2}日`);
  assert.ok(Math.abs(d3 - d2 / 2) <= 2, `2周目${d2}日・3周目${d3}日`);
});

test('速さ「同じ」なら、毎日のページ数はほぼ一定', () => {
  const m = base({ speed: 1, reps: 2, total: 100, target: '2026-11-20' }); // 20日で200ページ
  assert.equal(P.quota(m, '2026-11-01').units, 10);
});

test('サボった翌日は、残りを残りの日数で割り直して量が増える（リスケ）', () => {
  const m = base();
  const q1 = P.quota(m, '2026-11-01').units;
  const q2 = P.quota(m, '2026-11-02').units; // 1日目に何もしなかった
  assert.ok(q2 >= q1);
  assert.ok(P.pace(m, '2026-11-02') < 0);
});

test('目標日を過ぎたら残り全部がノルマになる', () => {
  const q = P.quota(base(), '2027-02-05');
  assert.equal(q.units, 900);
  assert.equal(q.overdue, true);
});

test('周の境目: 1周目の最後まで記録すると、次は2周目の p.1 から', () => {
  let m = P.recordProgress(base(), '2026-11-01', 1, 300).m;
  const q = P.quota(m, '2026-11-02');
  assert.deepEqual(P.where(m, q.g0 + 1), { r: 2, p: 1 });
  assert.equal(P.curRound(m, P.posThrough(m, '2026-11-01')), 2);
});

test('回転モザイク: 2周目の途中なら、前半は2回・後半は1回', () => {
  const m = P.recordProgress(base(), '2026-11-01', 2, 100).m;
  const { count } = P.pageStates(m, '2026-11-01');
  assert.equal(count[100], 2);
  assert.equal(count[101], 1);
});

test('記録: 前の日より前には戻せない／後の日があれば入れられない／同じ位置なら取り消し', () => {
  let m = P.recordProgress(base(), '2026-11-01', 1, 10).m;
  assert.ok(P.recordProgress(m, '2026-11-02', 1, 5).error);
  m = P.recordProgress(m, '2026-11-03', 1, 20).m;
  assert.ok(P.recordProgress(m, '2026-11-02', 1, 15).error);
  assert.equal(P.recordProgress(m, '2026-11-03', 1, 10).m.log['2026-11-03'], undefined);
  assert.equal(P.undoDay(m, '2026-11-03').m.log['2026-11-03'], undefined);
});

test('日ごとの達成: 全部・一部・記録なし', () => {
  const m0 = base();
  const q = P.quota(m0, '2026-11-01');
  let m = P.recordProgress(m0, '2026-11-01', 1, q.gT).m;
  assert.equal(P.dayStatus(m, '2026-11-01'), 'full');
  assert.equal(P.dayStatus(m, '2026-11-02'), 'zero');
  m = P.recordProgress(m, '2026-11-02', 1, q.gT + 1).m;
  assert.equal(P.dayStatus(m, '2026-11-02'), 'part');
});

test('連続達成: 途切れた日で止まり、今日が途中なら昨日から数える', () => {
  const m = simulate(base(), '2026-11-07', d => d === '2026-11-03');
  assert.equal(P.streak([m], '2026-11-08'), 4);
});

test('連続未達成: 昨日までの未達成の日数。今日達成したら 0、達成した日で止まる', () => {
  // 11/1〜11/3 は達成、11/4〜11/6 は何もしない
  const m = simulate(base(), '2026-11-03');
  assert.equal(P.missStreak([m], '2026-11-07'), 3);
  assert.equal(P.streak([m], '2026-11-07'), 0);
  assert.equal(P.missStreak([m], '2026-11-04'), 0); // 昨日（11/3）は達成
  // 11/7 にその日のノルマを達成すると 0 に戻り、連続達成が 1 になる
  const q = P.quota(m, '2026-11-07');
  const w = P.where(m, q.gT);
  const m2 = P.recordProgress(m, '2026-11-07', w.r, w.p).m;
  assert.equal(P.missStreak([m2], '2026-11-07'), 0);
  assert.equal(P.streak([m2], '2026-11-07'), 1);
  // 一部だけの日も未達成に数える
  const m3 = P.recordProgress(m, '2026-11-06', 1, P.posBefore(m, '2026-11-06') + 1).m;
  assert.equal(P.dayStatus(m3, '2026-11-06'), 'part');
  assert.equal(P.missStreak([m3], '2026-11-07'), 3);
  // 開始前の日は数えない
  assert.equal(P.missStreak([base()], '2026-11-03'), 2);
});

test('前の形（毎日復習）の記録を、1周目の進みとして引き継ぐ', () => {
  const old = { ...base(), log: undefined, intervals: [1, 3], batches: [
    { from: 1, to: 10, done: ['2026-11-01', '2026-11-02'] },
    { from: 11, to: 25, done: ['2026-11-02'] }
  ] };
  const m = P.migrate(old);
  assert.equal(m.batches, undefined);
  assert.deepEqual(m.log, { '2026-11-01': [1, 10], '2026-11-02': [1, 25] });
  assert.equal(m.speed, 0.5);
  assert.equal(P.migrate(m), m); // 2回目は何もしない
});

test('区切り: 開始日が来ていない区切りのページは、ノルマに入らない', () => {
  const sections = P.buildSections([
    { name: '安衛', count: 96, start: '2026-11-28' },
    { name: '労災', count: 166, start: '2026-12-05' }
  ]);
  const m = base({ total: 262, sections, start: '2026-11-28', target: '2027-08-22' });
  assert.deepEqual(sections.map(x => [x.from, x.to]), [[1, 96], [97, 262]]);
  assert.equal(P.availableAt(m, '2026-11-28'), 96);
  assert.equal(P.availableAt(m, '2026-12-05'), 262);
  // 安衛だけの週は、次の区切りが始まる前日（12/4）までに96問を終える量（7日で割る）
  assert.equal(P.quota(m, '2026-11-28').units, Math.ceil(96 / 7));
  // 安衛を全部終えたら、労災が始まるまでは待ち（ノルマ0・その日は数えない）
  const done = P.recordProgress(m, '2026-11-30', 1, 96).m;
  const q = P.quota(done, '2026-12-01');
  assert.equal(q.units, 0);
  assert.equal(q.waiting, true);
  assert.equal(q.next.name, '労災');
  assert.equal(P.dayStatus(done, '2026-12-01'), 'none');
  // 開いていないページはモザイクで鍵の印
  assert.equal(P.pageStates(done, '2026-12-01').mark[200], 'lock');
  // 労災が始まると、また出る
  assert.ok(P.quota(done, '2026-12-05').units > 0);
});

test('区切り: 最後の区切りが始まったあとは、残りを目標日までの日数で割る', () => {
  const sections = P.buildSections([{ name: 'A', count: 50, start: '2026-11-01' }, { name: 'B', count: 50, start: '2026-11-11' }]);
  const m = base({ total: 100, reps: 1, sections, target: '2026-11-30' });
  const done = P.recordProgress(m, '2026-11-10', 1, 50).m;
  assert.equal(P.quota(done, '2026-11-11').units, Math.ceil(50 / 20));
});

test('曜日ごとの量: 休みの日はノルマ0、比率2の日は1の日の倍', () => {
  // 日曜を休み、土曜を2、平日を1
  const m = base({ speed: 1, reps: 1, total: 70, start: '2026-11-02', target: '2026-11-08', dayWeights: [0, 1, 1, 1, 1, 1, 2] }); // 11/2 は月曜
  assert.equal(P.weightSum(m, '2026-11-02', '2026-11-08'), 7);
  assert.equal(P.quota(m, '2026-11-02').units, 10); // 70 × 1/7
  const sat = P.quota(base({ ...m, start: '2026-11-07' }), '2026-11-07'); // 土・日の2日で70 → 土曜は 2/2
  assert.equal(sat.units, 70);
  const sun = P.quota(m, '2026-11-08');
  assert.equal(sun.units, 0);
  assert.equal(sun.rest, true);
  assert.equal(P.dayStatus(m, '2026-11-08'), 'none');
  // 比率なしなら毎日同じ
  assert.equal(P.weightSum(base(), '2026-11-02', '2026-11-08'), 7);
});

test('入力チェック: 区切り', () => {
  const ok = { name: 'a', total: 30, start: '2026-11-01', target: '2026-12-01', reps: 3, speed: 0.5,
    sections: P.buildSections([{ name: 'A', count: 10, start: '2026-11-01' }, { name: 'B', count: 20, start: '2026-11-08' }]) };
  assert.equal(P.validateMaterial(ok), '');
  assert.ok(P.validateMaterial({ ...ok, total: 31 }));
  assert.ok(P.validateMaterial({ ...ok, sections: P.buildSections([{ name: 'A', count: 10, start: '2026-11-08' }, { name: 'B', count: 20, start: '2026-11-01' }]) }));
  assert.ok(P.validateMaterial({ ...ok, sections: P.buildSections([{ name: '', count: 10, start: '2026-11-01' }, { name: 'B', count: 20, start: '2026-11-08' }]) }));
});

test('入力チェック', () => {
  const ok = { name: 'a', total: 10, start: '2026-11-01', target: '2026-12-01', reps: 3, speed: 0.5 };
  assert.equal(P.validateMaterial(ok), '');
  assert.ok(P.validateMaterial({ ...ok, target: '2026-11-01' }));
  assert.ok(P.validateMaterial({ ...ok, total: 0 }));
  assert.ok(P.validateMaterial({ ...ok, speed: 0.3 }));
});
