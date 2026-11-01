/* ジャーナル PWA — フェーズ1
 * データは localStorage の1キーにJSONで保存。
 * 構造（schemaVersion 2）:
 * {
 *   schemaVersion: 2,
 *   settings: { habits: [{ id, name, archived? }] },
 *   days:   { "YYYY-MM-DD": { habits: { [habitId]: true | 0.5 }, satisfaction, weight, kcal, focusHours, highlight } },
 *   ※ 習慣は true=できた（黒塗り）, 0.5=まぁまぁ（半分塗り）, なし=未達
 *   months: { "YYYY-MM":    { goal, focus, keep, problem, try } },
 *   meta:   { lastExportAt }
 * }
 */
'use strict';

const STORE_KEY = 'journal.data';
const SCHEMA_VERSION = 2;
const DEFAULT_HABITS = [
  'ジャーナリング', '22〜23時就寝', '5〜6時起き', 'ベッドメイク',
  '歯みがき・白湯', '体重測定', 'プロテイン・サプリ',
];
const WD = ['日', '月', '火', '水', '木', '金', '土'];

/* ---------------- 日付ユーティリティ ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayStr = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const ym = (s) => s.slice(0, 7);
const addMonths = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysInMonth = (m) => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
const monthLabel = (m) => { const [y, mo] = m.split('-').map(Number); return `${y}年${mo}月`; };

/* ---------------- データ ---------------- */
function newId() { return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

function freshData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { habits: DEFAULT_HABITS.map((name, i) => ({ id: 'h' + (i + 1), name })) },
    days: {},
    months: {},
    meta: {},
  };
}

function normalize(d) {
  if (!d || typeof d !== 'object') throw new Error('形式が違います');
  if (!d.settings || !Array.isArray(d.settings.habits)) throw new Error('習慣の設定が見つかりません');
  if (!d.days || typeof d.days !== 'object') throw new Error('日次データが見つかりません');
  // v1 → v2: 副業時間(sideHours) を 集中時間(focusHours) に改名
  for (const day of Object.values(d.days)) {
    if (day && day.sideHours != null && day.focusHours == null) day.focusHours = day.sideHours;
    if (day) delete day.sideHours;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { habits: d.settings.habits.filter((h) => h && h.id && typeof h.name === 'string') },
    days: d.days,
    months: d.months || {},
    meta: d.meta || {},
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.error(e);
  }
  return freshData();
}

let db = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('保存に失敗しました：' + e.message);
  }
}

const activeHabits = () => db.settings.habits.filter((h) => !h.archived);
// 習慣の達成度：1=できた, 0.5=まぁまぁ, 0=未達
function habitVal(d, id) {
  const v = d && d.habits ? d.habits[id] : undefined;
  return v === true || v === 1 ? 1 : v === 0.5 ? 0.5 : 0;
}
const stateOf = (v) => (v === 1 ? 'full' : v === 0.5 ? 'half' : 'off');

function getDay(date, create) {
  let d = db.days[date];
  if (!d && create) { d = db.days[date] = { habits: {} }; }
  return d;
}
function setField(date, key, value) {
  const d = getDay(date, true);
  if (value === undefined || value === null || value === '' || Number.isNaN(value)) delete d[key];
  else d[key] = value;
  delete d._dummy; // 手で触ったらダミー扱いを外す
  cleanupDay(date);
  save();
}
function cleanupDay(date) {
  const d = db.days[date];
  if (!d) return;
  const hasHabit = Object.values(d.habits || {}).some(Boolean);
  const keys = Object.keys(d).filter((k) => k !== 'habits' && k !== '_dummy');
  if (!hasHabit && keys.length === 0) delete db.days[date];
}

function prevWeight(date) {
  const keys = Object.keys(db.days).filter((k) => k < date && db.days[k].weight != null).sort();
  return keys.length ? db.days[keys[keys.length - 1]].weight : null;
}

/* ---------------- 状態 ---------------- */
const state = {
  tab: 'day',
  date: todayStr(),
  month: ym(todayStr()),
};

/* ---------------- 共通 ---------------- */
const $view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
const fmt1 = (n) => (n == null ? '' : Number(n).toFixed(1));

function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
}
document.getElementById('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  if (b.dataset.tab === 'day' && state.tab === 'day') state.date = todayStr();
  setTab(b.dataset.tab);
});

function render() {
  ({ day: renderDay, month: renderMonth, memo: renderMemo, settings: renderSettings })[state.tab]();
}

/* ================= 日次入力 ================= */
function renderDay() {
  const date = state.date;
  const isToday = date === todayStr();
  const d = getDay(date) || { habits: {} };
  const dt = parseYmd(date);
  const pw = prevWeight(date);
  const weightVal = d.weight != null ? d.weight : pw;
  const carried = d.weight == null && pw != null;

  $view.innerHTML = `
    <div class="datebar">
      <button class="navbtn" data-act="prev" aria-label="前の日">◀</button>
      <label class="datelabel">
        ${dt.getMonth() + 1}月${dt.getDate()}日（${WD[dt.getDay()]}）
        <small>${isToday ? '今日' : dt.getFullYear() + '年・タップで日付を選ぶ'}</small>
        <input type="date" id="datepick" value="${date}" max="${todayStr()}">
      </label>
      <button class="navbtn" data-act="next" aria-label="次の日" ${isToday ? 'disabled' : ''}>▶</button>
    </div>
    ${isToday ? '' : '<button class="backtoday" data-act="today">今日に戻る</button>'}

    <h2>習慣<span class="legend">タップで ■できた → ◩まぁまぁ → □未達</span></h2>
    <div class="habits">
      ${activeHabits().map((h) => `
        <button class="habit" data-habit="${h.id}" data-state="${stateOf(habitVal(d, h.id))}">
          <span class="box"></span><span>${esc(h.name)}</span>
        </button>`).join('')}
    </div>

    <h2>満足度</h2>
    <div class="sat">
      ${Array.from({ length: 11 }, (_, i) => `<button data-sat="${i}" aria-pressed="${d.satisfaction === i}">${i}</button>`).join('')}
    </div>

    <h2>体重</h2>
    <div class="numrow">
      <button class="step" data-act="w-">−</button>
      <div class="numfield ${carried ? 'carried' : ''}" id="wfield">
        <input id="weight" type="text" inputmode="decimal" autocomplete="off" placeholder="—" value="${fmt1(weightVal)}">
        <span class="unit">kg</span>
      </div>
      <button class="step" data-act="w+">＋</button>
    </div>
    <div class="hint" id="whint">${carried ? `<span>前日の値（まだ記録されていません）</span><button class="linkbtn" data-act="wkeep">この値で記録</button>` : ''}</div>

    <h2>カロリー</h2>
    <div class="numfield">
      <input id="kcal" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="—" value="${d.kcal ?? ''}">
      <span class="unit">kcal</span>
    </div>

    <h2>集中時間</h2>
    <div class="numrow">
      <button class="step" data-act="s-">−</button>
      <div class="numfield pickfield"><output id="focus">${d.focusHours != null ? fmt1(d.focusHours) : '—'}</output><span class="unit">時間</span>
        <select id="focuspick" aria-label="集中時間を選ぶ">
          <option value="" ${d.focusHours == null ? 'selected' : ''}>— 未記入</option>
          ${Array.from({ length: 33 }, (_, i) => i / 2).map((h) => `<option value="${h}" ${d.focusHours === h ? 'selected' : ''}>${fmt1(h)} 時間</option>`).join('')}
        </select>
      </div>
      <button class="step" data-act="s+">＋</button>
    </div>

    <h2>ハイライト</h2>
    <input id="highlight" class="textfield" type="text" enterkeyhint="done" placeholder="今日いちばん良かったこと" value="${esc(d.highlight)}">
  `;
}

$view.addEventListener('click', (e) => {
  if (state.tab !== 'day') return;
  const date = state.date;
  const t = e.target.closest('button');
  if (!t) return;

  if (t.dataset.habit) {
    const d = getDay(date, true);
    const id = t.dataset.habit;
    // タップごとに 未達 → できた → まぁまぁ → 未達
    const cur = habitVal(d, id);
    if (cur === 0) d.habits[id] = true;
    else if (cur === 1) d.habits[id] = 0.5;
    else delete d.habits[id];
    delete d._dummy;
    t.dataset.state = stateOf(habitVal(d, id));
    cleanupDay(date);
    save();
    return;
  }
  if (t.dataset.sat !== undefined) {
    const v = Number(t.dataset.sat);
    const cur = (getDay(date) || {}).satisfaction;
    setField(date, 'satisfaction', cur === v ? undefined : v);
    $view.querySelectorAll('[data-sat]').forEach((b) => b.setAttribute('aria-pressed', String(b === t && cur !== v)));
    return;
  }
  switch (t.dataset.act) {
    case 'prev': state.date = addDays(date, -1); render(); break;
    case 'next': if (date < todayStr()) { state.date = addDays(date, 1); render(); } break;
    case 'today': state.date = todayStr(); render(); break;
    case 'w-': case 'w+': {
      const input = document.getElementById('weight');
      let v = parseFloat(input.value);
      if (Number.isNaN(v)) v = prevWeight(date) ?? 60;
      v = Math.round((v + (t.dataset.act === 'w+' ? 0.1 : -0.1)) * 10) / 10;
      input.value = fmt1(v);
      commitWeight(v);
      break;
    }
    case 'wkeep': {
      const v = parseFloat(document.getElementById('weight').value);
      if (!Number.isNaN(v)) commitWeight(v);
      break;
    }
    case 's-': case 's+': {
      const cur = (getDay(date) || {}).focusHours;
      let v = cur == null ? 0 : cur + (t.dataset.act === 's+' ? 0.5 : -0.5);
      if (cur == null && t.dataset.act === 's+') v = 0.5;
      if (cur == null && t.dataset.act === 's-') v = 0;
      v = Math.max(0, Math.min(24, v));
      setField(date, 'focusHours', v);
      showFocus(v);
      break;
    }
  }
});

function showFocus(v) {
  document.getElementById('focus').textContent = v == null ? '—' : fmt1(v);
  document.getElementById('focuspick').value = v == null ? '' : String(v);
}

function commitWeight(v) {
  setField(state.date, 'weight', v);
  document.getElementById('wfield').classList.remove('carried');
  document.getElementById('whint').innerHTML = '';
}

$view.addEventListener('input', (e) => {
  if (state.tab !== 'day') return;
  const el = e.target;
  if (el.id === 'weight') {
    const v = parseFloat(el.value.replace(',', '.'));
    if (el.value.trim() === '') { setField(state.date, 'weight', undefined); return; }
    if (!Number.isNaN(v) && v > 0 && v < 500) commitWeight(Math.round(v * 10) / 10);
  } else if (el.id === 'kcal') {
    const digits = el.value.replace(/[^0-9]/g, '');
    if (digits !== el.value) el.value = digits;
    setField(state.date, 'kcal', digits === '' ? undefined : Number(digits));
  } else if (el.id === 'highlight') {
    setField(state.date, 'highlight', el.value.trim() === '' ? undefined : el.value);
  }
});
$view.addEventListener('change', (e) => {
  if (state.tab === 'day' && e.target.id === 'datepick' && e.target.value) {
    state.date = e.target.value > todayStr() ? todayStr() : e.target.value;
    render();
  }
  if (state.tab === 'day' && e.target.id === 'focuspick') {
    const v = e.target.value === '' ? undefined : Number(e.target.value);
    setField(state.date, 'focusHours', v);
    showFocus(v);
  }
  if (state.tab === 'day' && e.target.id === 'weight') {
    const v = parseFloat(e.target.value);
    if (!Number.isNaN(v)) e.target.value = fmt1(v);
  }
});
$view.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input.textfield, #kcal, #weight')) e.target.blur();
});

/* ================= 月間ビュー ================= */
function monthStats(m) {
  const habits = activeHabits();
  const n = daysInMonth(m);
  const today = todayStr();
  let elapsed = 0, done = 0;
  const perHabit = Object.fromEntries(habits.map((h) => [h.id, 0]));
  const weights = [];
  let satSum = 0, satN = 0, focusSum = 0;
  for (let i = 1; i <= n; i++) {
    const date = `${m}-${pad(i)}`;
    if (date > today) break;
    elapsed++;
    const d = db.days[date];
    if (!d) continue;
    for (const h of habits) { const v = habitVal(d, h.id); done += v; perHabit[h.id] += v; }
    if (d.weight != null) weights.push(d.weight);
    if (d.satisfaction != null) { satSum += d.satisfaction; satN++; }
    if (d.focusHours != null) focusSum += d.focusHours;
  }
  const possible = elapsed * habits.length;
  return {
    rate: possible ? Math.round((done / possible) * 100) : null,
    weightDiff: weights.length >= 2 ? Math.round((weights[weights.length - 1] - weights[0]) * 10) / 10 : null,
    weightFirst: weights[0], weightLast: weights[weights.length - 1],
    satAvg: satN ? Math.round((satSum / satN) * 10) / 10 : null,
    focusSum, perHabit, elapsed,
  };
}

function renderMonth() {
  const m = state.month;
  const habits = activeHabits();
  const n = daysInMonth(m);
  const today = todayStr();
  const s = monthStats(m);
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1);

  let rows = '';
  for (let i = 1; i <= n; i++) {
    const date = `${m}-${pad(i)}`;
    const wd = parseYmd(date).getDay();
    const d = db.days[date] || { habits: {} };
    const cls = [wd === 0 ? 'wd-sun' : '', wd === 6 ? 'wd-sat' : '', date > today ? 'future' : '', date === today ? 'today' : ''].join(' ');
    rows += `<tr class="${cls}" data-date="${date}">
      <td class="d">${i}<small>${WD[wd]}</small></td>
      ${habits.map((h) => `<td class="c ${stateOf(habitVal(d, h.id))}"></td>`).join('')}
      <td class="n">${d.satisfaction ?? ''}</td>
      <td class="n">${fmt1(d.weight)}</td>
      <td class="n">${d.kcal ?? ''}</td>
      <td class="n">${d.focusHours != null ? fmt1(d.focusHours) : ''}</td>
      <td class="hl">${esc(d.highlight)}</td>
    </tr>`;
  }

  $view.innerHTML = `
    <div class="monthbar">
      <button class="navbtn" data-act="mprev" aria-label="前の月">◀</button>
      <div class="title">${monthLabel(m)}</div>
      <button class="navbtn" data-act="mnext" aria-label="次の月">▶</button>
    </div>
    <div class="stats">
      <div class="stat"><div class="k">習慣達成率</div><div class="v">${s.rate ?? '—'}<small>${s.rate != null ? '%' : ''}</small></div></div>
      <div class="stat"><div class="k">体重の増減${s.weightDiff != null ? `（${fmt1(s.weightFirst)}→${fmt1(s.weightLast)}）` : ''}</div><div class="v">${s.weightDiff != null ? sign(s.weightDiff) : '—'}<small>${s.weightDiff != null ? 'kg' : ''}</small></div></div>
      <div class="stat"><div class="k">平均満足度</div><div class="v">${s.satAvg ?? '—'}</div></div>
      <div class="stat"><div class="k">集中時間 合計</div><div class="v">${fmt1(s.focusSum)}<small>時間</small></div></div>
    </div>
    <div class="gridwrap">
      <table class="mg">
        <thead><tr>
          <th class="d"></th>
          ${habits.map((h) => `<th class="hcol">${esc(h.name)}</th>`).join('')}
          <th>満足</th><th>体重</th><th>kcal</th><th>集中</th><th style="text-align:left">ハイライト</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td class="d">計</td>
          ${habits.map((h) => `<td>${Math.round(s.perHabit[h.id] * 10) / 10}</td>`).join('')}
          <td colspan="5"></td>
        </tr></tfoot>
      </table>
    </div>
    <p class="gridnote">■できた ◩まぁまぁ（達成率では0.5回）。行をタップするとその日の入力画面を開きます。右へスクロールで数値とハイライト。</p>
  `;
}

$view.addEventListener('click', (e) => {
  if (state.tab !== 'month') return;
  const b = e.target.closest('button');
  if (b && b.dataset.act === 'mprev') { state.month = addMonths(state.month, -1); render(); return; }
  if (b && b.dataset.act === 'mnext') { state.month = addMonths(state.month, 1); render(); return; }
  const tr = e.target.closest('tr[data-date]');
  if (tr && tr.dataset.date <= todayStr()) { state.date = tr.dataset.date; setTab('day'); }
});

/* ================= 月次メモ ================= */
const MEMO_FIELDS = [
  ['goal', '今月のゴール', ''],
  ['focus', '意識すること', ''],
  ['keep', 'Keep（続けること）', 'kpt-k'],
  ['problem', 'Problem（課題）', 'kpt-p'],
  ['try', 'Try（次に試すこと）', 'kpt-t'],
];
function renderMemo() {
  const m = state.month;
  const memo = db.months[m] || {};
  $view.innerHTML = `
    <div class="monthbar">
      <button class="navbtn" data-act="mprev" aria-label="前の月">◀</button>
      <div class="title">${monthLabel(m)}</div>
      <button class="navbtn" data-act="mnext" aria-label="次の月">▶</button>
    </div>
    <div class="memo">
      ${MEMO_FIELDS.map(([k, label, cls]) => `
        <label for="memo-${k}" class="${cls}">${label}</label>
        <textarea id="memo-${k}" data-memo="${k}" rows="3">${esc(memo[k])}</textarea>`).join('')}
    </div>
    <p class="note">入力すると自動で保存されます。</p>
  `;
}
$view.addEventListener('click', (e) => {
  if (state.tab !== 'memo') return;
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'mprev') { state.month = addMonths(state.month, -1); render(); }
  if (b.dataset.act === 'mnext') { state.month = addMonths(state.month, 1); render(); }
});
$view.addEventListener('input', (e) => {
  if (state.tab !== 'memo' || !e.target.dataset.memo) return;
  const m = state.month;
  const memo = db.months[m] || (db.months[m] = {});
  const k = e.target.dataset.memo;
  if (e.target.value.trim() === '') delete memo[k]; else memo[k] = e.target.value;
  delete memo._dummy;
  if (Object.keys(memo).length === 0) delete db.months[m];
  save();
});

/* ================= 設定 ================= */
function renderSettings() {
  const habits = db.settings.habits;
  const active = activeHabits();
  const archived = habits.filter((h) => h.archived);
  const last = db.meta.lastExportAt ? new Date(db.meta.lastExportAt) : null;
  const dummyMonth = dummyTargetMonth();
  const hasDummy = Object.values(db.days).some((d) => d._dummy);

  $view.innerHTML = `
    <h2>習慣の項目</h2>
    <div class="hlist">
      ${active.map((h, i) => `
        <div class="hrow" data-id="${h.id}">
          <input type="text" value="${esc(h.name)}" data-rename="${h.id}" aria-label="習慣名">
          <button data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
          <button data-act="down" ${i === active.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
          <button data-act="archive">外す</button>
        </div>`).join('')}
    </div>
    <div class="addrow">
      <input type="text" id="newhabit" placeholder="新しい習慣を追加" enterkeyhint="done">
      <button class="smallbtn" data-act="add">追加</button>
    </div>
    ${archived.length ? `<div class="archived">外した項目（記録は残っています）：
      ${archived.map((h) => `<div>${esc(h.name)}<button data-act="restore" data-id="${h.id}">戻す</button></div>`).join('')}
    </div>` : ''}
    <p class="note">名前を変えても過去の記録はそのまま引き継がれます。</p>

    <h2>バックアップ</h2>
    <button class="bigbtn primary" data-act="export">JSONをエクスポート</button>
    <button class="bigbtn" data-act="import">JSONをインポート</button>
    <input type="file" id="importfile" accept="application/json,.json" hidden>
    <p class="note">最終エクスポート：${last ? `${last.getFullYear()}/${last.getMonth() + 1}/${last.getDate()} ${pad(last.getHours())}:${pad(last.getMinutes())}` : 'まだありません'}。週1回くらいiCloud Driveなどへ保存しておくと安心です。</p>

    <h2>動作確認用</h2>
    <button class="bigbtn" data-act="dummy">${monthLabel(dummyMonth)}のダミーデータを入れる</button>
    ${hasDummy ? '<button class="bigbtn danger" data-act="undummy">ダミーデータを消す</button>' : ''}
    <p class="note">ダミーは${monthLabel(dummyMonth)}のうち記録がない日だけに入ります。消すときもダミーの日だけ消えます。</p>
  `;
}

$view.addEventListener('input', (e) => {
  if (state.tab !== 'settings' || !e.target.dataset.rename) return;
  const h = db.settings.habits.find((x) => x.id === e.target.dataset.rename);
  if (h && e.target.value.trim()) { h.name = e.target.value.trim(); save(); }
});
$view.addEventListener('keydown', (e) => {
  if (state.tab === 'settings' && e.key === 'Enter' && e.target.id === 'newhabit') addHabit();
});
function addHabit() {
  const input = document.getElementById('newhabit');
  const name = input.value.trim();
  if (!name) return;
  db.settings.habits.push({ id: newId(), name });
  save();
  render();
  toast(`「${name}」を追加しました`);
}

$view.addEventListener('click', async (e) => {
  if (state.tab !== 'settings') return;
  const b = e.target.closest('button');
  if (!b) return;
  const row = b.closest('.hrow');
  const habits = db.settings.habits;
  switch (b.dataset.act) {
    case 'add': addHabit(); break;
    case 'up': case 'down': {
      const active = activeHabits();
      const i = active.findIndex((h) => h.id === row.dataset.id);
      const j = b.dataset.act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= active.length) return;
      const a = habits.indexOf(active[i]), c = habits.indexOf(active[j]);
      [habits[a], habits[c]] = [habits[c], habits[a]];
      save(); render(); break;
    }
    case 'archive': {
      const h = habits.find((x) => x.id === row.dataset.id);
      if (confirm(`「${h.name}」を入力画面から外しますか？（過去の記録は残り、あとで戻せます）`)) {
        h.archived = true; save(); render();
      }
      break;
    }
    case 'restore': {
      const h = habits.find((x) => x.id === b.dataset.id);
      delete h.archived; save(); render(); break;
    }
    case 'export': await exportJson(); break;
    case 'import': document.getElementById('importfile').click(); break;
    case 'dummy': insertDummy(); break;
    case 'undummy':
      if (confirm('ダミーデータを消しますか？（自分で入力した日は消えません）')) removeDummy();
      break;
  }
});
$view.addEventListener('change', async (e) => {
  if (state.tab !== 'settings' || e.target.id !== 'importfile') return;
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = normalize(JSON.parse(await file.text()));
    const n = Object.keys(data.days).length;
    if (!confirm(`${n}日分の記録を読み込みます。今のデータは置き換わります。よろしいですか？`)) return;
    db = data;
    save();
    render();
    toast('インポートしました');
  } catch (err) {
    alert('読み込めませんでした：' + err.message);
  }
});

async function exportJson() {
  const now = new Date();
  const payload = { app: 'journal-pwa', exportedAt: now.toISOString(), ...db };
  const text = JSON.stringify(payload, null, 2);
  const name = `journal-${ymd(now).replace(/-/g, '')}.json`;
  const file = new File([text], name, { type: 'application/json' });
  let ok = false;
  // iPhoneでは共有シート（「ファイルに保存」など）が使いやすい
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); ok = true; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  if (!ok) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  db.meta.lastExportAt = now.toISOString();
  save();
  render();
  toast('エクスポートしました');
}

/* ---------------- ダミーデータ ---------------- */
function dummyTargetMonth() {
  const t = new Date();
  return `${t.getMonth() + 1 >= 10 ? t.getFullYear() : t.getFullYear() - 1}-10`;
}
function insertDummy() {
  const m = dummyTargetMonth();
  const habits = activeHabits();
  const probs = [0.9, 0.55, 0.6, 0.8, 0.85, 0.75, 0.65];
  const highlights = [
    '朝の散歩が気持ちよかった', '企画書が完成', '早起きできて読書30分', '家族と夕飯をゆっくり食べた',
    'ジムで自己ベスト', '新しいカフェで集中できた', '仕事のレビューで褒められた', '部屋の片付けが終わった',
    '友人と久しぶりに電話', '2時間集中して作業できた', '雨だったけど予定通り動けた', '料理を作り置きできた',
  ];
  let w = 68.4, added = 0;
  for (let i = 1; i <= daysInMonth(m); i++) {
    const date = `${m}-${pad(i)}`;
    w = Math.round((w - 0.04 + (Math.random() - 0.5) * 0.6) * 10) / 10;
    if (db.days[date] && !db.days[date]._dummy) continue;
    const hs = {};
    habits.forEach((h, j) => { const r = Math.random(), p = probs[j] ?? 0.6; if (r < p * 0.8) hs[h.id] = true; else if (r < p) hs[h.id] = 0.5; });
    db.days[date] = {
      habits: hs,
      satisfaction: Math.min(10, Math.max(2, Math.round(6 + (Math.random() - 0.4) * 5))),
      weight: w,
      kcal: Math.round((1700 + Math.random() * 700) / 10) * 10,
      focusHours: Math.round(Math.random() * 6) / 2,
      highlight: highlights[Math.floor(Math.random() * highlights.length)],
      _dummy: true,
    };
    added++;
  }
  if (!db.months[m]) {
    db.months[m] = {
      goal: '体重を1kg落とす／集中時間を月20時間', focus: '22時台に寝る。夜のスマホを減らす',
      keep: '朝のジャーナリングは毎日できた', problem: '週末に就寝が遅くなりがち', try: '金曜は21時にスマホを充電器へ', _dummy: true,
    };
  }
  save();
  state.month = m;
  render();
  toast(`${monthLabel(m)}に${added}日分のダミーを入れました。月間タブで確認できます`);
}
function removeDummy() {
  let n = 0;
  for (const [k, d] of Object.entries(db.days)) if (d._dummy) { delete db.days[k]; n++; }
  for (const [k, mm] of Object.entries(db.months)) if (mm._dummy) delete db.months[k];
  save();
  render();
  toast(`${n}日分のダミーを消しました`);
}

/* ---------------- 起動 ---------------- */
// 日付が変わった状態でアプリに戻ってきたら今日に合わせる
let lastSeenToday = todayStr();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = todayStr();
  if (t !== lastSeenToday) {
    if (state.date === lastSeenToday) state.date = t;
    lastSeenToday = t;
    if (state.tab === 'day') render();
  }
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // 新しい版が入ったら自動で読み込み直す（入力中のデータは都度保存済み）
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // アプリに戻ってきたときにも更新を確認する
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
render();
