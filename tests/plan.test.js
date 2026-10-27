// 計算部分のテスト。実行: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/plan.js';

const base = (o = {}) => ({ name: 'テスト教材', unit: 'p', total: 300, start: '2026-11-01', target: '2027-01-29', reps: 5, intervals: [1, 3, 7, 14, 30], batches: [], ...o });

/** 毎日、出たとおりにやったときの記録を作る */
function simulate(m, until, skip = () => false) {
  for (let d = m.start; d <= until; d = P.addDays(d, 1)) {
    if (skip(d)) continue;
    for (const x of P.reviewsFor(m, d).due) m = P.recordReview(m, x.b.from, d).m;
    const q = P.newQuota(m, d);
    if (!q.allLearned) m = P.recordNew(m, d, q.gT).m;
  }
  return m;
}

test('復習の間隔: 期間が十分なら設定どおり、新しく学ぶ締切は目標日−間隔の合計', () => {
  const m = base();
  assert.deepEqual(P.effIntervals(m), [1, 3, 7, 14]);
  assert.equal(P.newCutoff(m), P.addDays(m.target, -25));
  assert.equal(P.isCompressed(m), false);
});

test('復習の間隔: 期間が短いと縮める（新しく学ぶ期間が半分は残る）', () => {
  const m = base({ target: '2026-11-21', reps: 6 }); // 20日間、間隔の合計 55日
  const iv = P.effIntervals(m);
  assert.equal(P.isCompressed(m), true);
  assert.ok(iv.reduce((a, b) => a + b, 0) <= 10 + iv.length); // 丸めで少し超えることはある
  assert.ok(iv.every(x => x >= 1));
});

test('回転数が間隔の数より多いときは、最後の間隔の2倍を足す', () => {
  assert.deepEqual(P.baseIntervals(base({ reps: 8 })), [1, 3, 7, 14, 30, 60, 120]);
});

test('毎日出たとおりにやると、目標日までに全ページを目標の回数やり終える', () => {
  const m = simulate(base(), '2027-01-29');
  assert.equal(P.learnedThrough(m, '2027-01-29'), 300);
  assert.equal(P.isFinished(m, '2027-01-29'), true);
  assert.equal(P.isFinished(m, '2027-01-27'), false);
});

test('1回目の復習は翌日、2回目は3日後に出る', () => {
  let m = P.recordNew(base(), '2026-11-01', 10).m;
  assert.equal(P.reviewsFor(m, '2026-11-01').due.length, 0);
  const r = P.reviewsFor(m, '2026-11-02').due;
  assert.equal(r.length, 1);
  assert.equal(r[0].rep, 2);
  m = P.recordReview(m, 1, '2026-11-02').m;
  assert.equal(P.nextDue(m, m.batches[0]), '2026-11-05');
  assert.equal(P.reviewsFor(m, '2026-11-04').due.length, 0);
  assert.equal(P.reviewsFor(m, '2026-11-05').due.length, 1);
});

test('復習が遅れたら遅れの日数を出し、次の間隔はやった日から数え直す', () => {
  let m = P.recordNew(base(), '2026-11-01', 10).m;
  const r = P.reviewsFor(m, '2026-11-04').due[0];
  assert.equal(r.late, 2);
  m = P.recordReview(m, 1, '2026-11-04').m;
  assert.equal(P.nextDue(m, m.batches[0]), '2026-11-07');
});

test('サボった翌日は、新しく進める量が増える（リスケ）', () => {
  const m = base();
  const q1 = P.newQuota(m, '2026-11-01').units;
  const q2 = P.newQuota(m, '2026-11-02').units; // 1日目に何もしなかった
  assert.ok(q2 >= q1);
  const total = P.newQuota(m, '2026-11-02').daysLeft * q2;
  assert.ok(total >= 300);
});

test('同じ日に2回記録すると、同じまとまりがのびる', () => {
  let m = P.recordNew(base(), '2026-11-01', 5).m;
  m = P.recordNew(m, '2026-11-01', 12).m;
  assert.equal(m.batches.length, 1);
  assert.equal(m.batches[0].to, 12);
});

test('前の日より前のページは入れられない', () => {
  let m = P.recordNew(base(), '2026-11-01', 10).m;
  assert.ok(P.recordNew(m, '2026-11-02', 5).error);
});

test('取り消し: 復習を取り消すと1回分だけ戻り、最後のまとまりは消せる', () => {
  let m = P.recordNew(base(), '2026-11-01', 10).m;
  m = P.recordNew(m, '2026-11-02', 20).m;
  m = P.recordReview(m, 1, '2026-11-02').m;
  assert.equal(P.undoLast(m, 1).m.batches[0].done.length, 1);
  assert.ok(P.undoLast(P.undoLast(m, 1).m, 1).error); // 後ろのまとまりがあるので消せない
  assert.equal(P.undoLast(m, 11).m.batches.length, 1);
});

test('日ごとの達成: 全部・一部・記録なし', () => {
  let m = P.recordNew(base(), '2026-11-01', P.newQuota(base(), '2026-11-01').gT).m;
  assert.equal(P.dayStatus(m, '2026-11-01'), 'full');
  assert.equal(P.dayStatus(m, '2026-11-02'), 'zero');
  m = P.recordReview(m, 1, '2026-11-02').m;
  assert.equal(P.dayStatus(m, '2026-11-02'), 'part'); // 復習はしたが新しい分はまだ
});

test('連続達成: 途切れた日で止まり、今日が途中なら昨日から数える', () => {
  const skipDay = '2026-11-03';
  const m = simulate(base(), '2026-11-07', d => d === skipDay);
  assert.equal(P.streak([m], '2026-11-08'), 4);
});

test('入力チェック', () => {
  const ok = { name: 'a', total: 10, start: '2026-11-01', target: '2026-12-01', reps: 3, intervals: [1, 3] };
  assert.equal(P.validateMaterial(ok), '');
  assert.ok(P.validateMaterial({ ...ok, target: '2026-11-01' }));
  assert.ok(P.validateMaterial({ ...ok, total: 0 }));
  assert.equal(P.parseIntervals('3,1'), null);
  assert.deepEqual(P.parseIntervals('1、3、7'), [1, 3, 7]);
});
