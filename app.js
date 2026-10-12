// app.js — интерфейс «Денег Сони»: страницы, графики, загрузка выписок.
import * as S from "./store.js";
import { analyze, claudeSummary, monthName, monthsFrom } from "./analysis.js";
import { parsePdf, parseCsv, decodeText, OTHER, contribution, KIND_LABELS } from "./engine.js";

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const money = (v) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(v)) + " ₽";
const money2 = (v) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + " ₽";
const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const monthLabel = (m) => { const [y, mm] = m.split("-"); return `${MONTHS[+mm - 1]} ${y}`; };
const dayLabel = (iso) => { const [, m, d] = iso.split("-"); return `${+d} ${MONTHS_GEN[+m - 1]}`; };
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function showMsg(el, type, text, keep = false) {
  el.className = `msg show ${type}`;
  el.textContent = text;
  if (!keep && type !== "info") setTimeout(() => (el.className = "msg"), 7000);
}

let toastTimer = null;
function toast(text, onUndo = null) {
  const t = $("#toast");
  $("#toast-text").textContent = text;
  const undo = $("#toast-undo");
  undo.style.display = onUndo ? "" : "none";
  undo.onclick = async () => { t.classList.remove("show"); if (onUndo) await onUndo(); };
  t.className = "msg toast show ok";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 8000);
}

// Месяц, выбранный пользователем, общий для всех страниц
let currentMonth = null;
function monthsOf(ops) {
  return [...new Set(ops.map((o) => o.date.slice(0, 7)))].sort().reverse();
}
function monthSelect(months) {
  if (!currentMonth || !months.includes(currentMonth)) currentMonth = months[0] || null;
  if (!months.length) return "";
  return `<select id="month-select">${months.map((m) => `<option value="${m}" ${m === currentMonth ? "selected" : ""}>${monthLabel(m)}</option>`).join("")}</select>`;
}
function bindMonthSelect(rerender) {
  const sel = $("#month-select");
  if (sel) sel.addEventListener("change", () => { currentMonth = sel.value; rerender(); });
}
const dot = (c) => `<span class="dot" style="background:${c.color}"></span>`;
const badge = (c) => `<span class="badge" data-cat="${esc(c.id)}">${dot(c)}${esc(c.name)}</span>`;
const MONTH_NOM = MONTHS;
const MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
// Веточка для «обложки» месяца — тонкий рисунок, не мешающий цифрам
const SPRIG = `<svg class="hero-sprig" viewBox="0 0 200 200" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M28 196C70 150 112 98 176 24"/>
  <path d="M62 158c-26-2-42-18-44-38 22-2 40 14 44 38z"/><path d="M62 158c4-24 22-38 44-36-2 20-20 36-44 36z"/>
  <path d="M96 116c-24-4-38-22-38-42 22 0 38 18 38 42z"/><path d="M96 116c6-24 24-36 46-32-4 20-24 34-46 32z"/>
  <path d="M130 74c-20-6-32-24-30-42 20 2 32 20 30 42z"/><path d="M130 74c8-22 26-32 44-26-6 18-24 30-44 26z"/>
  <path d="M168 150l5 12 12 5-12 5-5 12-5-12-12-5 12-5z" fill="#C3DA6A" stroke="none"/>
</svg>`;

// ---------------------------------------------------------------------------
// Маршрутизация (#/, #/ops, #/limits, #/import)
// ---------------------------------------------------------------------------
const routes = { "/": dashboard, "/ops": opsPage, "/plan": planPage, "/limits": limitsPage, "/import": importPage };
function parseHash() {
  const h = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = h.split("?");
  return { path: routes[path] ? path : "/", params: new URLSearchParams(qs || "") };
}
async function render() {
  const { path, params } = parseHash();
  $$(".nav-links a").forEach((a) => a.classList.toggle("active", a.dataset.route === path));
  try {
    await routes[path](params);
  } catch (e) {
    console.error(e);
    $("#view").innerHTML = `<div class="msg show err">Ошибка: ${esc(e.message)}</div>`;
  }
}
window.addEventListener("hashchange", render);
function goCategory(catId) {
  location.hash = `#/ops?cat=${encodeURIComponent(catId)}`;
}

// ---------------------------------------------------------------------------
// Обзор
// ---------------------------------------------------------------------------
let donutKind = "expense";
async function dashboard() {
  const [ops, cats] = await Promise.all([S.operations(), S.categories()]);
  const view = $("#view");
  if (!ops.length) {
    view.innerHTML = `
      <section class="hero" style="display:block">
        ${SPRIG}
        <div class="hero-month">Начнём</div>
        <p class="hero-caption" style="max-width:40ch">Загрузите выписку из банка — приложение само разложит траты по категориям и посчитает, сколько осталось.</p>
        <a class="btn" href="#/import" style="background:var(--salad);color:var(--forest);margin-top:12px">Загрузить выписку</a>
      </section>
      <p class="hint">Уже вели бюджет на другом устройстве? На странице «Загрузка» можно открыть сохранённую копию.</p>`;
    return;
  }
  const months = monthsOf(ops);
  const mSel = monthSelect(months);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const other = cats.find((c) => c.name === OTHER);
  const catOf = (o) => catById.get(o.categoryId) || other;
  const mOps = ops.filter((o) => o.date.startsWith(currentMonth));
  // Итоги с учётом типа категории: переводы между своими счетами не считаются,
  // а возвраты и чужие доли (например, за аренду) уменьшают расход своей категории
  const contrib = (o) => contribution(o, catOf(o).kind);
  let income = 0, expense = 0, debtPay = 0, returned = 0;
  for (const o of mOps) {
    const c = contrib(o); income += c.income; expense += c.expense; debtPay += c.debt;
    if (c.expense < 0) returned -= c.expense;
  }
  const net = income - expense - debtPay;

  const byCat = (kind) => {
    const m = new Map();
    for (const o of mOps) {
      const v = contrib(o)[kind];
      if (!v) continue;
      const c = catOf(o);
      const x = m.get(c.id) || { id: c.id, name: c.name, color: c.color, total: 0 };
      x.total += v;
      m.set(c.id, x);
    }
    return [...m.values()].filter((x) => x.total > 0.5).sort((a, b) => b.total - a.total);
  };
  const [y, mm] = currentMonth.split("-").map(Number);
  const days = new Date(y, mm, 0).getDate();
  const daily = Array.from({ length: days }, (_, i) => {
    const iso = `${currentMonth}-${String(i + 1).padStart(2, "0")}`;
    return mOps.filter((o) => o.date === iso).reduce((s, o) => s + Math.max(0, contrib(o).expense), 0);
  });
  const last = [...ops].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 10);

  const mi = +currentMonth.slice(5, 7) - 1;
  const sumNum = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(Math.abs(net)));
  view.innerHTML = `
    <div id="backup-note"></div>
    <section class="hero">
      ${SPRIG}
      <label class="month-pick">
        <span class="hero-month">${MONTH_NOM[mi]}</span><span class="year">${currentMonth.slice(0, 4)}</span>
        ${months.length > 1 ? `<span class="caret">▾</span>${mSel}` : ""}
      </label>
      <div class="hero-left">
        <p class="hero-caption">${net >= 0 ? `В ${MONTHS_PREP[mi]} осталось` : `В ${MONTHS_PREP[mi]} потрачено больше, чем пришло, на`}</p>
        <div class="hero-sum ${net >= 0 ? "" : "negative"}">${sumNum}<span class="rub">₽</span></div>
      </div>
      <div class="flows">
        <div class="flow in"><span>пришло</span><b>${money(income)}</b></div>
        <div class="flow out"><span>потрачено</span><b>${money(expense)}</b></div>
        ${Math.abs(debtPay) > 0.5 ? `<div class="flow debt"><span>на долги</span><b>${money(debtPay)}</b></div>` : ""}
      </div>
      ${returned > 0.5 ? `<p class="hero-note">«Потрачено» — уже за вычетом ${money(returned)}, которые вам вернули: скинулись за общие чеки, доля за аренду, возвраты покупок.</p>` : ""}
    </section>
    <div class="grid-2">
      <div class="card">
        <div class="card-head">
          <h2>${donutKind === "income" ? "Откуда пришло" : "На что ушло"}</h2>
          <div class="tabs" id="donut-tabs">
            <button class="tab ${donutKind === "expense" ? "active" : ""}" data-kind="expense" type="button">Расходы</button>
            <button class="tab ${donutKind === "income" ? "active" : ""}" data-kind="income" type="button">Доходы</button>
          </div>
        </div>
        <div style="height:300px;position:relative"><canvas id="donut"></canvas><div id="donut-empty" class="empty-note" style="display:none"></div></div>
      </div>
      <div class="card lilac"><h2>Траты по дням</h2><div style="height:300px"><canvas id="daily"></canvas></div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Последние операции</h2><a href="#/ops">Все операции</a></div>
      <ul class="op-list">${last.map((o) => opItem(o, catOf(o), false)).join("")}</ul>
    </div>`;

  bindMonthSelect(dashboard);
  $$("#view .badge").forEach((b) => b.addEventListener("click", () => goCategory(b.dataset.cat)));
  const drawD = () => drawDonut(byCat(donutKind), donutKind === "income" ? "Нет доходов за этот месяц" : "Нет расходов за этот месяц");
  $$("#donut-tabs .tab").forEach((b) => b.addEventListener("click", () => {
    donutKind = b.dataset.kind;
    $$("#donut-tabs .tab").forEach((x) => x.classList.toggle("active", x === b));
    $(".card-head h2").textContent = donutKind === "income" ? "Откуда пришло" : "На что ушло";
    drawD();
  }));
  drawD();
  drawDaily(daily);
  backupReminder();
}

let charts = {};
function chartDefaults() {
  Chart.defaults.color = cssVar("--muted");
  Chart.defaults.borderColor = cssVar("--line");
  Chart.defaults.font.family = cssVar("--sans");
  Chart.defaults.font.size = 12;
}
function drawDonut(data, emptyText) {
  chartDefaults();
  const el = $("#donut");
  charts.donut?.destroy();
  const empty = $("#donut-empty");
  if (!data.length) { el.style.display = "none"; empty.style.display = "block"; empty.textContent = emptyText; return; }
  el.style.display = ""; empty.style.display = "none";
  const narrow = window.innerWidth < 640;
  charts.donut = new Chart(el, {
    type: "doughnut",
    data: { labels: data.map((c) => c.name), datasets: [{ data: data.map((c) => c.total), backgroundColor: data.map((c) => c.color), borderWidth: 3, borderColor: cssVar("--sheet"), hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "66%",
      onClick: (evt, els) => { if (els.length) goCategory(data[els[0].index].id); },
      plugins: {
        legend: { position: narrow ? "bottom" : "right", labels: { usePointStyle: true, pointStyle: "circle", boxWidth: 8, padding: 12, color: cssVar("--forest") } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${money(ctx.parsed)}` } },
      },
    },
  });
}
function drawDaily(daily) {
  chartDefaults();
  charts.daily?.destroy();
  const violet = cssVar("--violet");
  charts.daily = new Chart($("#daily"), {
    type: "bar",
    data: { labels: daily.map((_, i) => i + 1), datasets: [{ data: daily, backgroundColor: violet, hoverBackgroundColor: cssVar("--forest"), borderRadius: 6, borderSkipped: false, maxBarThickness: 14 }] },
    options: {
      responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => money(c.parsed.y) } } },
      scales: { x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } }, y: { beginAtZero: true, border: { display: false }, grid: { color: "rgba(106,78,158,.12)" }, ticks: { maxTicksLimit: 5, callback: (v) => v >= 1000 ? Math.round(v / 1000) + " тыс" : v } } },
    },
  });
}

async function backupReminder() {
  const lastBackup = await S.getMeta("lastBackupAt");
  const lastChange = await S.getMeta("lastImportAt");
  if (lastChange && (!lastBackup || lastBackup < lastChange)) {
    $("#backup-note").innerHTML = `<div class="msg show info note">Новые операции пока есть только на этом устройстве.
      <a href="#/import">Сохраните копию в iCloud Drive</a>, чтобы открыть их на другом.</div>`;
  }
}

let debtsCache = [];
function opItem(o, cat, withSelect, cats = []) {
  const excluded = cat.kind === "transfer";
  const amount = o.kind === "expense"
    ? `<span class="amount-expense">−${money2(o.amount)}</span>`
    : `<span class="amount-income">+${money2(o.amount)}</span>`;
  const catHtml = withSelect
    ? `<select class="cat-select" data-hash="${esc(o.hash)}" aria-label="Категория">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === cat.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`
    : badge(cat);
  const debtSel = withSelect && cat.kind === "debt"
    ? (debtsCache.length
      ? `<select class="debt-select" data-hash="${esc(o.hash)}" aria-label="Какой долг"><option value="">какой долг?</option>${debtsCache.map((d) => `<option value="${esc(d.id)}" ${d.id === o.debtId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>`
      : `<a class="note-btn" href="#/plan">добавить долг</a>`)
    : "";
  const noteBtn = withSelect ? `<button type="button" class="note-btn" data-hash="${esc(o.hash)}">${o.note ? "изменить заметку" : "+ заметка"}</button>` : "";
  return `<li class="${excluded ? "excluded" : ""}" data-hash="${esc(o.hash)}">
    <span class="d" title="${esc(o.description)}">${esc(o.description) || "—"}</span>
    <span class="a" ${excluded ? 'title="Не входит в доходы и расходы"' : ""}>${amount}</span>
    <span class="sub">${withSelect ? "" : `<span>${dayLabel(o.date)}</span>`}${o.accountType === "credit" ? `<span class="src-tag">кредитка</span>` : ""}${o.kind === "income" && cat.kind === "expense" ? `<span class="src-tag refund" title="Поступление в категорию расходов уменьшает траты, а не считается доходом">уменьшает траты</span>` : ""}${o.kind === "income" && cat.kind === "transfer" ? `<span class="src-tag">не доход</span>` : ""}${catHtml}${debtSel}${noteBtn}</span>
    ${o.note ? `<span class="note">${esc(o.note)}</span>` : ""}
  </li>`;
}

// ---------------------------------------------------------------------------
// Операции
// ---------------------------------------------------------------------------
async function opsPage(params) {
  const [ops, cats, debts] = await Promise.all([S.operations(), S.categories(), S.debts()]);
  debtsCache = debts;
  const catFilter = params.get("cat") || "";
  const query = (params.get("q") || "").trim();
  const months = monthsOf(ops);
  const mSel = monthSelect(months);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const other = cats.find((c) => c.name === OTHER);
  const catOf = (o) => catById.get(o.categoryId) || other;
  let list = ops.filter((o) => !currentMonth || o.date.startsWith(currentMonth));
  if (catFilter) list = list.filter((o) => catOf(o).id === catFilter);
  if (query) list = list.filter((o) => (o.description + " " + (o.note || "")).toLowerCase().includes(query.toLowerCase()));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const fc = catById.get(catFilter);
  const total = list.reduce((s, o) => { const c = contribution(o, catOf(o).kind); return s + c.income - c.expense; }, 0);

  let html = "", lastDay = "";
  for (const o of list) {
    if (o.date !== lastDay) { html += `<li class="day-head">${dayLabel(o.date)}</li>`; lastDay = o.date; }
    html += opItem(o, catOf(o), true, cats);
  }

  $("#view").innerHTML = `
    <div class="page-head">
      <h1>${fc ? esc(fc.name) : "Операции"}</h1>
      <div class="row">
        ${mSel}
        <select id="cat-filter"><option value="">Все категории</option>${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === catFilter ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        <input type="text" id="q" placeholder="Поиск по описанию и заметкам" value="${esc(query)}" style="min-width:160px">
      </div>
    </div>
    <div class="card">
      ${list.length ? `<p class="summary-line">${list.length} ${plural(list.length, "операция", "операции", "операций")}${list.every((o) => catOf(o).kind === "transfer") ? ", в доходы и расходы не входят" : `, итог <b>${total >= 0 ? "+" : "−"}${money(Math.abs(total))}</b>`}</p>
        <ul class="op-list">${html}</ul>` : `<div class="empty-note">${query || catFilter ? "Ничего не нашлось — попробуйте другой месяц или сбросьте фильтр." : "В этом месяце операций нет."}</div>`}
      <p class="hint">Чтобы поменять категорию, выберите её в списке у операции. Приложение запомнит
        правило: похожие операции (с тем же словом в описании) получат ту же категорию. У переводов категория
        меняется только у выбранной операции — описания у них одинаковые.</p>
    </div>`;

  bindMonthSelect(() => opsPage(params));
  const setParam = (k, v) => {
    const p = parseHash().params;
    if (v) p.set(k, v); else p.delete(k);
    const qs = p.toString();
    location.hash = "#/ops" + (qs ? "?" + qs : "");
  };
  $("#cat-filter").addEventListener("change", (e) => setParam("cat", e.target.value));
  let qTimer;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const p = parseHash().params;
      if (e.target.value) p.set("q", e.target.value); else p.delete("q");
      history.replaceState(null, "", "#/ops?" + p.toString());
      opsPage(p).then(() => { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); });
    }, 300);
  });
  $$(".cat-select").forEach((sel) => sel.addEventListener("change", async () => {
    const res = await S.setOperationCategory(sel.dataset.hash, sel.value);
    let text;
    if (res.keyword) {
      text = `Запомнила: «${res.keyword}» → ${catById.get(sel.value).name}`;
      if (res.moved) text += `. Похожих операций перенесено: ${res.moved}`;
    } else if (res.skipped === "transfer") text = `Категория изменена: ${catById.get(sel.value).name}. Правило для переводов не запоминается — у них одинаковые описания.`;
    else if (res.skipped === "income") text = "Категория изменена. Для доходов правило не запоминается.";
    else if (res.skipped === "other") text = "Перенесено в «Прочее».";
    else text = "Категория изменена.";
    toast(text, async () => { await S.undoChange(res.undo); render(); });
    if (res.moved || catById.get(sel.value).kind === "debt" || sel.closest("li").querySelector(".debt-select")) render();
  }));
  $$(".debt-select").forEach((sel) => sel.addEventListener("change", async () => {
    await S.setOperationDebt(sel.dataset.hash, sel.value);
    toast(sel.value ? `Платёж учтён в долге «${sel.selectedOptions[0].text}».` : "Платёж отвязан от долга.");
  }));
  $$("button.note-btn").forEach((btn) => btn.addEventListener("click", () => {
    const li = btn.closest("li");
    const op = list.find((o) => o.hash === btn.dataset.hash);
    li.querySelector(".note")?.remove();
    const input = document.createElement("input");
    input.type = "text"; input.className = "note-input"; input.value = op.note || "";
    input.placeholder = "Например: аренда за октябрь, моя доля";
    li.appendChild(input); btn.remove(); input.focus();
    let saved = false;
    const save = async () => {
      if (saved) return; saved = true;
      await S.setOperationNote(op.hash, input.value);
      opsPage(parseHash().params);
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); if (e.key === "Escape") { saved = true; opsPage(parseHash().params); } });
    input.addEventListener("blur", save);
  }));
}

// ---------------------------------------------------------------------------
// План: средний месяц, подушка, долги, «Спросить Claude»
// ---------------------------------------------------------------------------
const DEBT_TYPES = { card: "Кредитная карта", loan: "Кредит", person: "Долг человеку" };

function statRow(label, value, color, cats, explain) {
  const items = cats.filter((c) => Math.abs(c.avg) > 0.5);
  return `<details class="stat-row">
    <summary><span class="dt">${color ? `<span class="dot" style="background:${color}"></span>` : ""}${label}</span><span class="dd">${value < 0 ? "−" : ""}${money(Math.abs(value))}</span></summary>
    <div class="stat-detail"><p>${explain}</p>
      ${items.length ? `<ul>${items.map((c) => `<li><span>${dot(c.cat)} ${esc(c.cat.name)}</span><span>${c.avg < 0 ? "−" : ""}${money(Math.abs(c.avg))}</span></li>`).join("")}</ul>` : "<p>Пока ничего нет.</p>"}
    </div>
  </details>`;
}

async function planPage() {
  const [ops, cats, debts, cushionSaved, cushionTarget, cushionMonths] = await Promise.all([
    S.operations(), S.categories(), S.debts(),
    S.getSetting("cushionSaved", 0), S.getSetting("cushionTarget", 3), S.getSetting("cushionMonths", 12),
  ]);
  const a = analyze({ ops, cats, debts, settings: { cushionSaved, cushionTarget, cushionMonths } });
  const view = $("#view");
  const period = a.n ? `${monthName(a.months[0])} — ${monthName(a.months[a.n - 1])}` : "";

  // Куда уходит средний месяц: полоса из четырёх частей
  const parts = [
    { label: "обязательные", v: a.avgEssential, color: "var(--violet)" },
    { label: "остальные траты", v: a.avgOther, color: "var(--lilac)" },
    { label: "долги", v: Math.max(0, a.avgDebt), color: "#7B4A86" },
    { label: "свободно", v: Math.max(0, a.avgFree), color: "var(--salad)" },
  ];
  const base = Math.max(a.avgIncome, parts.reduce((s, p) => s + p.v, 0)) || 1;
  const bar = parts.filter((p) => p.v > 0.5).map((p) => `<span style="width:${(p.v / base) * 100}%;background:${p.color}" title="${p.label}: ${money(p.v)}"></span>`).join("");

  const fees = (a.categories.find((c) => c.cat.id === "def:Проценты и комиссии") || { avg: 0 }).avg;
  const nonEss = a.categories.filter((c) => !c.cat.essential && c.cat.kind === "expense" && c.avg > 0).slice(0, 6);
  const unsorted = a.categories.filter((c) => c.cat.kind === "both").reduce((s, c) => s + c.avg, 0);
  const debtRows = a.debts.map((d) => {
    const pd = a.plan.byDebt[d.id];
    const when = d.remaining <= 0.5 ? "закрыт" : pd && pd.month ? `закроется ${monthsFrom(pd.month)}` : "при текущем остатке не закрывается";
    const meta = [DEBT_TYPES[d.type] || "Долг", d.rate ? `${String(d.rate).replace(".", ",")}% годовых` : "без процентов", d.minPayment ? `платёж от ${money(d.minPayment)}` : "", d.dueDay ? `до ${d.dueDay}-го числа` : ""].filter(Boolean).join(", ");
    return `<li class="debt" data-id="${esc(d.id)}">
      <div><span class="limit-name">${esc(d.name)}</span><div class="limit-sums">${meta}</div><div class="limit-sums">${when}</div></div>
      <div class="debt-right"><b>${money(d.remaining)}</b><button type="button" class="note-btn debt-edit" data-id="${esc(d.id)}">изменить</button></div>
      ${d.amount > 0 ? `<div class="progress" style="grid-column:1/-1"><div class="bar" style="width:${Math.min(100, (1 - d.remaining / Math.max(d.amount, 1)) * 100)}%;background:var(--salad)"></div></div>` : ""}
    </li>`;
  }).join("");

  view.innerHTML = `
    <div class="page-head"><h1>План</h1>${period ? `<span class="hint" style="margin:0">средние за ${a.n} ${plural(a.n, "месяц", "месяца", "месяцев")}: ${period}</span>` : ""}</div>
    ${a.n < 2 ? `<div class="msg show info note">Для надёжных средних нужно хотя бы 2–3 полных месяца выписок. Сейчас полных месяцев: ${a.n}. Текущий месяц в расчёт не берётся — он ещё не закончился.</div>` : ""}
    <section class="card">
      <h2>Средний месяц</h2>
      <div class="split-bar">${bar}</div>
      <p class="hint" style="margin-top:0">Нажмите на строку, чтобы увидеть, из каких категорий она складывается.</p>
      <div class="stat-list">
        ${statRow("приходит", a.avgIncome, "", a.incomeCats, "Все доходы: зарплата, деньги от близких, кэшбэк. То, что вам скинули за общие чеки, сюда не входит — эти деньги уменьшают траты.")}
        ${statRow("обязательные траты", a.avgEssential, "var(--violet)", a.categories.filter((c) => c.cat.essential), "Категории с отметкой «обязательная» (Лимиты → Ключевые слова). На них считается подушка безопасности.")}
        ${statRow("остальные траты", a.avgOther, "var(--lilac)", a.categories.filter((c) => !c.cat.essential), "Все остальные траты. Деньги, которые вам скинули за общие чеки, здесь вычитаются.")}
        ${Math.abs(a.avgDebt) > 0.5 ? statRow("платежи по долгам", a.avgDebt, "#7B4A86", a.debtCats, "Операции в категории «Погашение долгов»: платежи по кредитке (если её выписку вы не загружаете) и возвраты долгов людям.") : ""}
        <div class="stat-row free"><span class="dt"><span class="dot" style="background:var(--salad)"></span>остаётся свободным</span><span class="dd">${a.avgFree < 0 ? "−" : ""}${money(Math.abs(a.avgFree))}</span></div>
      </div>
      ${nonEss.length ? `<h3>Где можно сэкономить</h3>
        <p class="hint" style="margin-top:0">Необязательные траты, от больших к меньшим. Стрелка — последний полный месяц по сравнению со средним.</p>
        <ul class="op-list">${nonEss.map((c) => `<li><span class="d">${dot(c.cat)} ${esc(c.cat.name)}</span><span class="a">${money(c.avg)}</span>
          <span class="sub">${Math.abs(c.change) >= 0.1 ? `${c.change > 0 ? "↑" : "↓"} ${Math.round(Math.abs(c.change) * 100)}% в ${MONTHS_PREP[+a.months[a.n - 1].slice(5, 7) - 1]}` : "примерно как обычно"}${c.avg > 0 ? `, сократить на 20% — это ${money(c.avg * 0.2)} в месяц` : ""}</span></li>`).join("")}</ul>` : ""}
      ${unsorted > 0.5 ? `<p class="hint">Ещё ${money(unsorted)} в месяц — переводы людям и «Прочее» без точной категории. Если разметить их в «Операциях», анализ станет точнее.</p>` : ""}
    </section>

    <section class="card lilac">
      <h2>Подушка безопасности</h2>
      <p class="hint" style="margin-top:0">Запас на случай, если доход пропадёт. Обычно советуют 3–6 месяцев обязательных трат
        (какие траты обязательные, отмечается в «Лимитах» → «Ключевые слова»).</p>
      <div class="cushion-grid">
        <div><span class="kicker">3 месяца</span><b>${money(a.cushion.target3)}</b></div>
        <div><span class="kicker">6 месяцев</span><b>${money(a.cushion.target6)}</b></div>
      </div>
      <div class="row" style="margin-top:14px">
        <label class="field">уже отложено, ₽<input type="number" inputmode="numeric" id="cu-saved" min="0" step="1000" value="${a.cushion.saved || ""}" placeholder="0"></label>
        <label class="field">цель<select id="cu-target">${[3, 6].map((m) => `<option value="${m}" ${m === a.cushion.targetMonthsOfExpenses ? "selected" : ""}>${m} месяца</option>`.replace("6 месяца", "6 месяцев")).join("")}</select></label>
        <label class="field">собрать за<select id="cu-months">${[6, 12, 18, 24].map((m) => `<option value="${m}" ${m === a.cushion.collectIn ? "selected" : ""}>${m} мес.</option>`).join("")}</select></label>
      </div>
      <p class="big-line">${a.cushion.left <= 0.5 ? "Цель достигнута — подушка собрана." : a.avgFree <= 0 ? "Сейчас свободного остатка нет: сначала стоит сократить траты." : `Откладывайте <b>${money(a.cushion.monthly)}</b> в месяц`}</p>
      ${a.cushion.capped ? `<p class="hint">Чтобы собрать подушку за ${a.cushion.collectIn} мес., понадобилось бы ${money(a.cushion.left / a.cushion.collectIn)} в месяц — больше половины свободного остатка. Я ограничила взнос половиной, поэтому срок выйдет дольше.</p>` : ""}
    </section>

    <section class="card">
      <div class="card-head"><h2>Долги</h2><button type="button" id="debt-add" class="secondary">Добавить долг</button></div>
      ${fees > 0.5 ? `<p class="msg show info note">Кредитка обходится вам в среднем в <b>${money(fees)}</b> в месяц: проценты, штрафы и плата за «Защиту карты». Это деньги, которые не тратятся ни на что, — их стоит убрать в первую очередь.</p>` : ""}
      ${a.debts.length ? `<ul class="debt-list">${debtRows}</ul>
        <p class="big-line">${a.debtBudget > 0.5 || a.plan.minTotal > 0
          ? `Без напряжения можно направлять в долги <b>${money(a.plan.budget)}</b> в месяц${a.plan.months ? `, тогда всё закроется ${monthsFrom(a.plan.months)}` : ""}.`
          : "Свободного остатка сейчас не хватает на досрочное погашение."}</p>
        <p class="hint">Расчёт: свободный остаток ${money(a.avgFree)} − взнос в подушку ${money(a.cushion.monthly)} − запас на непредвиденное ${money(a.buffer)} (5% дохода).
          Сначала вносятся минимальные платежи, остальное идёт в долг с самой высокой ставкой — так меньше переплата.
          ${a.minOnly.months && a.plan.months && a.minOnly.totalInterest - a.plan.totalInterest > 100 ? `Если платить только минимум, проценты составят ${money(a.minOnly.totalInterest)} вместо ${money(a.plan.totalInterest)}.` : ""}
          План работает, если не брать в долг заново — например, не тратить с кредитки больше, чем вносите.</p>
        ${a.plan.budget > a.debtBudget + 0.5 && a.plan.minTotal > a.debtBudget ? `<div class="msg show err">Минимальные платежи (${money(a.plan.minTotal)}) больше свободного остатка после подушки. Возможно, стоит временно уменьшить взнос в подушку.</div>` : ""}`
        : `<p class="hint" style="margin-top:0">Добавьте кредитку и долг человеку: сколько осталось, ставку и минимальный платёж. Остаток по кредитке удобно брать из приложения Т-Банка. Переводы в счёт долга отмечайте категорией «Погашение долгов» — остаток уменьшится сам.</p>`}
    </section>

    <section class="card ask">
      <h2>Спросить Claude</h2>
      <p class="hint" style="margin-top:0">Соберу короткую сводку: средние суммы по категориям, подушку и долги. Без описаний операций, номеров карт и имён.
        Вы увидите текст целиком, скопируете его и вставите в чат с Claude или с любым другим ассистентом.</p>
      <button type="button" id="ask-btn" style="margin-top:12px">Собрать сводку</button>
    </section>
    <p class="hint" style="text-align:center">Это расчёт по средним, а не финансовая консультация. Решения — за вами.</p>`;

  const saveSetting = (key, el, num = true) => el.addEventListener("change", async () => { await S.setSetting(key, num ? +el.value || 0 : el.value); planPage(); });
  saveSetting("cushionSaved", $("#cu-saved"));
  saveSetting("cushionTarget", $("#cu-target"));
  saveSetting("cushionMonths", $("#cu-months"));
  $("#debt-add").addEventListener("click", () => debtForm());
  $$(".debt-edit").forEach((b) => b.addEventListener("click", () => debtForm(debts.find((d) => d.id === b.dataset.id))));
  $("#ask-btn").addEventListener("click", () => askClaude(a));
}

function openModal(html) {
  const dlg = $("#modal");
  dlg.querySelector(".modal-body").innerHTML = html;
  if (!dlg.open) dlg.showModal();
  return dlg;
}
function closeModal() { const d = $("#modal"); if (d.open) d.close(); }

function debtForm(d = null) {
  const today = new Date().toISOString().slice(0, 10);
  const v = d || { type: "card", name: "", amount: "", asOf: today, rate: "", minPayment: "", dueDay: "", limit: "", note: "" };
  const dlg = openModal(`
    <h2>${d ? "Долг" : "Новый долг"}</h2>
    <form id="debt-form" class="form-grid">
      <label class="field">что это<select name="type">${Object.entries(DEBT_TYPES).map(([k, l]) => `<option value="${k}" ${k === v.type ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="field">название<input name="name" required value="${esc(v.name)}" placeholder="Кредитка Т-Банк"></label>
      <label class="field">сколько должна, ₽<input name="amount" type="number" inputmode="decimal" min="0" step="0.01" required value="${v.amount}"></label>
      <label class="field">на дату<input name="asOf" type="date" value="${v.asOf}"></label>
      <label class="field card-only">ставка, % годовых<input name="rate" type="number" inputmode="decimal" min="0" step="0.1" value="${v.rate || ""}" placeholder="0"></label>
      <label class="field card-only">минимальный платёж, ₽<input name="minPayment" type="number" inputmode="decimal" min="0" step="1" value="${v.minPayment || ""}"></label>
      <label class="field card-only">платить до, число<input name="dueDay" type="number" inputmode="numeric" min="1" max="31" value="${v.dueDay || ""}"></label>
      <label class="field only-card">кредитный лимит, ₽<input name="limit" type="number" inputmode="decimal" min="0" step="1" value="${v.limit || ""}"></label>
      <p class="hint" style="grid-column:1/-1;margin:0">Платежи, отмеченные этим долгом после указанной даты, уменьшают остаток сами. Остаток по кредитке лучше время от времени сверять с приложением банка и обновлять здесь.</p>
      <div class="row" style="grid-column:1/-1;justify-content:space-between">
        ${d ? `<button type="button" class="danger" id="debt-del">Удалить</button>` : "<span></span>"}
        <div class="row"><button type="button" class="secondary" id="debt-cancel">Отмена</button><button type="submit">Сохранить</button></div>
      </div>
    </form>`);
  const form = dlg.querySelector("#debt-form");
  const sync = () => {
    const t = form.type.value;
    form.querySelectorAll(".card-only").forEach((el) => (el.style.display = t === "person" ? "none" : ""));
    form.querySelectorAll(".only-card").forEach((el) => (el.style.display = t === "card" ? "" : "none"));
  };
  form.type.addEventListener("change", sync); sync();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    await S.saveDebt({ ...(d || {}), ...f, name: f.name.trim() });
    closeModal(); planPage();
  });
  dlg.querySelector("#debt-cancel").addEventListener("click", closeModal);
  dlg.querySelector("#debt-del")?.addEventListener("click", async () => {
    if (!confirm(`Удалить «${d.name}»? Операции останутся, просто перестанут к нему относиться.`)) return;
    await S.deleteDebt(d.id); closeModal(); planPage();
  });
}

function askClaude(a) {
  const text = claudeSummary(a);
  const dlg = openModal(`
    <h2>Сводка для Claude</h2>
    <p class="hint" style="margin-top:0">Вот что уйдёт в чат — проверьте, всё ли вас устраивает. Можно отредактировать прямо здесь.</p>
    <textarea id="ask-text" rows="14">${esc(text)}</textarea>
    <div class="row" style="margin-top:12px;justify-content:space-between">
      <button type="button" class="secondary" id="ask-close">Закрыть</button>
      <div class="row">
        <button type="button" id="ask-copy">Скопировать</button>
        <a class="btn secondary" href="https://claude.ai/new" target="_blank" rel="noopener">Открыть Claude</a>
      </div>
    </div>
    <div id="ask-msg" class="msg"></div>`);
  dlg.querySelector("#ask-close").addEventListener("click", closeModal);
  dlg.querySelector("#ask-copy").addEventListener("click", async () => {
    const ta = dlg.querySelector("#ask-text");
    try { await navigator.clipboard.writeText(ta.value); }
    catch { ta.select(); document.execCommand("copy"); }
    showMsg(dlg.querySelector("#ask-msg"), "ok", "Скопировано. Откройте чат с Claude и вставьте текст (Cmd+V).");
  });
}

// ---------------------------------------------------------------------------
// Лимиты и категории
// ---------------------------------------------------------------------------
async function limitsPage() {
  const [ops, cats, lims] = await Promise.all([S.operations(), S.categories(), S.limits()]);
  const months = monthsOf(ops);
  const mSel = monthSelect(months);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const rows = lims.filter((l) => catById.has(l.categoryId)).map((l) => {
    const c = catById.get(l.categoryId);
    const spent = Math.max(0, ops.filter((o) => o.categoryId === c.id && currentMonth && o.date.startsWith(currentMonth)).reduce((s, o) => s + contribution(o, c.kind).expense, 0));
    const pct = (spent / l.cap) * 100;
    return { c, cap: l.cap, spent, pct, state: pct > 100 ? "over" : pct >= 80 ? "warn" : "ok" };
  }).sort((a, b) => b.pct - a.pct);

  $("#view").innerHTML = `
    <div class="page-head"><h1>Лимиты</h1><span>${mSel}</span></div>
    <div class="card">
      <h2>Сколько можно потратить за месяц</h2>
      ${rows.length ? rows.map((r) => `
        <div class="limit-row state-${r.state}">
          <div class="limit-head">
            <div>
              <span class="limit-name" data-cat="${esc(r.c.id)}">${dot(r.c)}${esc(r.c.name)}</span>
              <div class="limit-sums">${money(r.spent)} из ${money(r.cap)}, ${r.spent > r.cap ? "перерасход " + money(r.spent - r.cap) : "осталось " + money(r.cap - r.spent)}</div>
            </div>
            <input type="number" inputmode="numeric" min="0" step="100" value="${r.cap}" data-cat="${esc(r.c.id)}" class="limit-input" aria-label="Лимит, ₽">
          </div>
          <div class="progress"><div class="bar" style="width:${Math.min(100, r.pct)}%"></div></div>
        </div>`).join("") : `<div class="no-limits">Лимитов пока нет. Выберите категорию и сумму ниже.</div>`}
      <p class="hint">Чтобы изменить лимит, поправьте сумму в поле. Ноль убирает лимит. Полоска желтеет после 80% и краснеет при перерасходе.</p>
      <div class="row" style="margin-top:10px">
        <select id="nl-cat" style="min-width:170px">${cats.filter((c) => c.name !== OTHER && (c.kind === "expense" || c.kind === "both")).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
        <input type="number" inputmode="numeric" id="nl-cap" min="0" step="100" placeholder="₽ в месяц" style="width:130px">
        <button id="nl-btn">Добавить лимит</button>
      </div>
    </div>

    <div class="card">
      <h2>Категории</h2>
      <div class="row">
        <input type="text" id="nc-name" placeholder="Название, напр. Хобби" style="min-width:170px">
        <input type="text" id="nc-kw" placeholder="Ключевые слова через запятую" style="flex:1;min-width:200px">
        <select id="nc-kind" aria-label="Тип категории">${Object.entries(KIND_LABELS).map(([k, l]) => `<option value="${k}" ${k === ("both") ? "selected" : ""}>${l}</option>`).join("")}</select>
        <button id="nc-btn">Добавить категорию</button>
      </div>
      <div class="cat-chips">
        ${cats.map((c) => `<span class="badge">${dot(c)}${esc(c.name)}${c.name === OTHER ? "" : `<button class="cat-del" data-cat="${esc(c.id)}" data-name="${esc(c.name)}" aria-label="Удалить категорию ${esc(c.name)}">✕</button>`}</span>`).join("")}
      </div>
      <div id="cat-msg" class="msg"></div>
      <p class="hint">Удаление категории переносит её операции в «Прочее».</p>
    </div>

    <div class="card">
      <h2>Ключевые слова</h2>
      <p class="hint" style="margin-top:0">Если слово встречается в описании операции, она получает эту категорию
        (регистр не важен, через запятую). Операции, у которых вы меняли категорию вручную, пересчёт не трогает.</p>
      <p class="hint">Тип категории решает, как она входит в итоги. «Расход»: входящие деньги в ней уменьшают расход
        (возврат покупки, чья-то доля за общую аренду). «Доход» — наоборот. «Между своими счетами» не входит ни в доходы, ни в расходы. «Обязательные» категории — основа расчёта подушки безопасности на странице «План».</p>
      ${cats.filter((c) => c.name !== OTHER).map((c) => `<div class="kw-row"><div class="limit-head"><span class="limit-name" style="font-size:21px">${dot(c)}${esc(c.name)}</span><label class="ess"><input type="checkbox" class="ess-check" data-cat="${esc(c.id)}" ${c.essential ? "checked" : ""}> обязательная</label><select class="kind-select" data-cat="${esc(c.id)}" aria-label="Тип категории ${esc(c.name)}">${Object.entries(KIND_LABELS).map(([k, l]) => `<option value="${k}" ${k === (c.kind) ? "selected" : ""}>${l}</option>`).join("")}</select></div><textarea rows="2" data-cat="${esc(c.id)}" aria-label="Ключевые слова: ${esc(c.name)}">${esc(c.keywords)}</textarea></div>`).join("")}
      <div class="row" style="margin-top:12px"><button id="kw-btn">Сохранить и пересчитать</button></div>
      <div id="kw-msg" class="msg"></div>
    </div>

    <details class="card">
      <summary>Если категории запутались</summary>
      <p class="hint">Вернёт стандартные категории и их ключевые слова, затем заново разложит операции. Ваши собственные категории, лимиты, долги и заметки останутся.</p>
      <div class="row" style="margin-top:12px">
        <button type="button" id="reset-cats" class="secondary">Вернуть стандартные категории</button>
        <button type="button" id="reset-all" class="danger">…и забыть мои ручные выборы</button>
      </div>
      <p class="hint">Вторая кнопка также отменит категории, которые вы ставили операциям вручную (например, аренду) — их придётся поставить заново.</p>
      <div id="reset-msg" class="msg"></div>
    </details>`;

  bindMonthSelect(limitsPage);
  $$("#view .limit-name[data-cat]").forEach((b) => b.addEventListener("click", () => goCategory(b.dataset.cat)));
  $$(".limit-input").forEach((inp) => {
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); });
    inp.addEventListener("change", async () => { await S.setLimit(inp.dataset.cat, inp.value); limitsPage(); });
  });
  $("#nl-btn").addEventListener("click", async () => {
    const cap = parseFloat($("#nl-cap").value || "0");
    if (!(cap > 0)) return $("#nl-cap").focus();
    await S.setLimit($("#nl-cat").value, cap);
    limitsPage();
  });
  $("#nc-btn").addEventListener("click", async () => {
    try {
      const c = await S.createCategory($("#nc-name").value, $("#nc-kw").value, $("#nc-kind").value);
      if (c.keywords) await S.reclassifyAll();
      limitsPage().then(() => showMsg($("#cat-msg"), "ok", `Категория «${c.name}» добавлена.`));
    } catch (e) { showMsg($("#cat-msg"), "err", e.message); }
  });
  $$(".cat-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Удалить категорию «${b.dataset.name}»? Её операции перейдут в «Прочее».`)) return;
    const n = await S.deleteCategory(b.dataset.cat);
    limitsPage().then(() => showMsg($("#cat-msg"), "ok", `Удалено. Операций перенесено в «Прочее»: ${n}.`));
  }));
  for (const [id, manual] of [["#reset-cats", false], ["#reset-all", true]]) {
    $(id).addEventListener("click", async () => {
      if (manual && !confirm("Сбросить и ручные выборы категорий у всех операций?")) return;
      const n = await S.resetCategories(manual);
      await limitsPage();
      const msg = $("#reset-msg"); msg.closest("details").open = true;
      showMsg(msg, "ok", `Готово. Категория изменилась у операций: ${n}.`);
    });
  }
  $("#kw-btn").addEventListener("click", async () => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    for (const ta of $$("textarea[data-cat]")) {
      const kw = ta.value.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean).join(",");
      if (kw !== byId.get(ta.dataset.cat).keywords) await S.updateCategory(ta.dataset.cat, { keywords: kw });
    }
    for (const cb of $$(".ess-check")) {
      if (cb.checked !== !!byId.get(cb.dataset.cat).essential) await S.updateCategory(cb.dataset.cat, { essential: cb.checked });
    }
    for (const sel of $$(".kind-select")) {
      if (sel.value !== byId.get(sel.dataset.cat).kind) await S.updateCategory(sel.dataset.cat, { kind: sel.value });
    }
    const n = await S.reclassifyAll();
    await limitsPage();
    showMsg($("#kw-msg"), "ok", `Готово. Категория изменилась у операций: ${n}.`);
  });
}

// ---------------------------------------------------------------------------
// Загрузка выписок и резервная копия
// ---------------------------------------------------------------------------
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("./vendor/pdf.min.mjs").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}

async function importFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  let records;
  if (name.endsWith(".pdf")) records = await parsePdf(await loadPdfjs(), bytes);
  else if (name.endsWith(".csv") || name.endsWith(".txt")) records = parseCsv(decodeText(bytes));
  else if (name.endsWith(".json")) return { backup: await S.mergeData(parseBackup(bytes)) };
  else if (/\.xlsx?$/.test(name)) throw new Error("Excel пока не поддерживается — скачайте выписку в PDF или CSV.");
  else throw new Error("Неизвестный формат. Нужен PDF или CSV.");
  const res = await S.importRecords(records, file.name);
  if (res.added) await S.setMeta("lastImportAt", Date.now());
  return res;
}

function parseBackup(bytes) {
  try { return JSON.parse(decodeText(bytes)); }
  catch { throw new Error("Это не файл копии «Денег Сони». Нужен файл вида dengi-soni-2026-10-12.json."); }
}

function backupFileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `dengi-soni-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

async function saveBackup() {
  const data = await S.exportData();
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const file = new File([blob], backupFileName(), { type: "application/json" });
  // iPhone/iPad: системное меню «Поделиться» → «Сохранить в Файлы» → iCloud Drive
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file] }); }
    catch (e) { if (e.name === "AbortError") return false; throw e; }
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  await S.setMeta("lastBackupAt", Date.now());
  return true;
}

/** Загрузить файлы (выписки или копию) и вернуть итог текстом. */
async function importFiles(files) {
  const lines = [];
  let ok = true;
  for (const f of files) {
    try {
      const r = await importFile(f);
      if (r.backup) lines.push(`${f.name}: копия загружена — обновлено операций ${r.backup.operations}, категорий ${r.backup.categories}`);
      else lines.push(`${f.name}${r.accountType === "credit" ? " (кредитная карта)" : r.accountType === "debit" ? " (дебетовая карта)" : ""}: найдено ${r.parsed}, добавлено ${r.added}${r.duplicates ? `, уже были ${r.duplicates}` : ""}`);
    } catch (e) { ok = false; lines.push(`Не получилось: ${f.name}: ${e.message}`); }
  }
  return { ok, text: lines.join("\n") };
}

// Файлы можно бросить в любое место окна или вставить через Cmd+V.
// Нужно для веб-приложения из Dock в Safari: там окно выбора файлов
// не открывается (ошибка Safari), а перетаскивание и вставка работают.
let dragDepth = 0;
function setDropOverlay(on) { document.body.classList.toggle("dropping", on); }
document.addEventListener("dragenter", (e) => {
  if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
  dragDepth++; setDropOverlay(true);
});
document.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDropOverlay(false); });
document.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
document.addEventListener("drop", async (e) => {
  dragDepth = 0; setDropOverlay(false);
  const files = [...(e.dataTransfer?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  await globalImport(files);
});
document.addEventListener("paste", async (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  await globalImport(files);
});
async function globalImport(files) {
  toast("Читаю файл…");
  const { ok, text } = await importFiles(files);
  await render();
  const msg = $("#imp-msg");
  if (msg) showMsg(msg, ok ? "ok" : "err", text, true);
  toast(text.split("\n").join(" · "));
}

async function importPage() {
  const [ops, lastBackup] = await Promise.all([S.operations(), S.getMeta("lastBackupAt")]);
  const fmt = (t) => t ? new Date(t).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "ещё не сохранялась";
  $("#view").innerHTML = `
    <div class="page-head"><h1>Загрузка</h1></div>
    <div class="card">
      <h2>Выписки</h2>
      <label class="drop" id="drop">
        <input type="file" id="file" class="file-hidden" accept=".pdf,.csv,.json" multiple>
        <span class="big">Выбрать выписки</span>
        <span class="small">PDF или CSV из Т-Банка, можно несколько сразу. На Mac проще перетащить файл в окно
        или скопировать его в Finder (Cmd+C) и вставить сюда (Cmd+V).</span>
      </label>
      <div id="imp-msg" class="msg"></div>
      <p class="hint">Повторная загрузка той же выписки безопасна: уже добавленные операции пропускаются.
        Файлы никуда не отправляются — разбираются прямо на этом устройстве.</p>
    </div>

    <div class="card">
      <h2>Копия в iCloud</h2>
      <p class="hint" style="margin-top:0">Все ваши данные хранятся только в этом браузере. Сохраните копию в iCloud Drive,
        а на другом устройстве загрузите её кнопкой ниже: данные объединятся, ничего не потеряется
        (при расхождениях побеждает более свежая правка).</p>
      <div class="row" style="margin-top:10px">
        <button id="save-btn">Сохранить копию</button>
        <button type="button" id="restore-btn" class="secondary">Открыть копию</button>
        <input type="file" id="restore" class="file-hidden" tabindex="-1" aria-hidden="true">
      </div>
      <p class="hint">Если кнопка «Открыть копию» не открывает окно (так бывает в приложении из Dock), перетащите файл копии в окно приложения.</p>
      <p class="hint">Последняя копия: ${fmt(lastBackup)}. Сейчас в приложении ${ops.length} ${plural(ops.length, "операция", "операции", "операций")}.</p>
      <div id="bk-msg" class="msg"></div>
    </div>

    <div class="card">
      <h2>Где взять выписку</h2>
      <p class="hint" style="margin-top:0">Приложение Т-Банка → нужная карта → «Выписка» (или «Справки» →
        «Выписка по счёту») → период → формат PDF → «Поделиться» → «Сохранить в Файлы».
        Затем выберите этот файл здесь.</p>
    </div>

    <details class="card">
      <summary style="cursor:pointer;color:var(--muted)">Удалить все данные с этого устройства</summary>
      <p class="hint">Операции, категории и лимиты будут стёрты из этого браузера. Сначала сохраните копию.</p>
      <button id="wipe-btn" class="danger">Удалить всё</button>
    </details>
    <p class="hint" style="text-align:center">Версия приложения: ${APP_VERSION}</p>`;

  const drop = $("#drop");
  const handle = async (files) => {
    const msg = $("#imp-msg");
    showMsg(msg, "info", "Читаю…");
    const { ok, text } = await importFiles(files);
    showMsg(msg, ok ? "ok" : "err", text, true);
  };
  $("#file").addEventListener("change", (e) => { handle([...e.target.files]); e.target.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove("over"); handle([...e.dataTransfer.files]); });

  $("#save-btn").addEventListener("click", async () => {
    try {
      if (await saveBackup()) { await importPage(); showMsg($("#bk-msg"), "ok", "Копия сохранена. Если выбрали iCloud Drive — она появится на других устройствах."); }
    } catch (e) { showMsg($("#bk-msg"), "err", "Не получилось сохранить: " + e.message); }
  });
  // Кнопка явно открывает выбор файла: в веб-приложении из Dock (Safari)
  // скрытый input внутри label может не реагировать на клик
  $("#restore-btn").addEventListener("click", () => $("#restore").click());
  $("#restore").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const st = await S.mergeData(parseBackup(new Uint8Array(await f.arrayBuffer())));
      await importPage();
      showMsg($("#bk-msg"), "ok", `Готово: обновлено операций ${st.operations}, категорий ${st.categories}, лимитов ${st.limits}.`, true);
    } catch (err) { showMsg($("#bk-msg"), "err", err.message); }
  });
  $("#wipe-btn").addEventListener("click", async () => {
    if (!confirm("Точно удалить все данные с этого устройства?")) return;
    await S.wipe();
    location.hash = "#/";
  });
}

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------
const APP_VERSION = "v13";
if ("serviceWorker" in navigator) {
  // Когда приходит новая версия — один раз перезагрузить страницу, чтобы она применилась
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register("sw.js").then((r) => r.update()).catch((e) => console.warn("SW:", e));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", render);
await S.init();
render();
