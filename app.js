// app.js — интерфейс «Денег Сони»: страницы, графики, загрузка выписок.
import * as S from "./store.js";
import { parsePdf, parseCsv, decodeText, OTHER } from "./engine.js";

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
const routes = { "/": dashboard, "/ops": opsPage, "/limits": limitsPage, "/import": importPage };
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
  const income = mOps.filter((o) => o.kind === "income").reduce((s, o) => s + o.amount, 0);
  const expense = mOps.filter((o) => o.kind === "expense").reduce((s, o) => s + o.amount, 0);
  const net = income - expense;

  const byCat = (kind) => {
    const m = new Map();
    for (const o of mOps.filter((o) => o.kind === kind)) {
      const c = catOf(o);
      const x = m.get(c.id) || { id: c.id, name: c.name, color: c.color, total: 0 };
      x.total += o.amount;
      m.set(c.id, x);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  const [y, mm] = currentMonth.split("-").map(Number);
  const days = new Date(y, mm, 0).getDate();
  const daily = Array.from({ length: days }, (_, i) => {
    const iso = `${currentMonth}-${String(i + 1).padStart(2, "0")}`;
    return mOps.filter((o) => o.kind === "expense" && o.date === iso).reduce((s, o) => s + o.amount, 0);
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
      </div>
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

function opItem(o, cat, withSelect, cats = []) {
  const amount = o.kind === "expense"
    ? `<span class="amount-expense">−${money2(o.amount)}</span>`
    : `<span class="amount-income">+${money2(o.amount)}</span>`;
  const catHtml = withSelect
    ? `<select class="cat-select" data-hash="${esc(o.hash)}">${cats.map((c) => `<option value="${esc(c.id)}" ${c.id === cat.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>`
    : badge(cat);
  return `<li>
    <span class="d" title="${esc(o.description)}">${esc(o.description) || "—"}</span>
    <span class="a">${amount}</span>
    <span class="sub">${withSelect ? "" : `<span>${dayLabel(o.date)}</span>`}${catHtml}</span>
  </li>`;
}

// ---------------------------------------------------------------------------
// Операции
// ---------------------------------------------------------------------------
async function opsPage(params) {
  const [ops, cats] = await Promise.all([S.operations(), S.categories()]);
  const catFilter = params.get("cat") || "";
  const query = (params.get("q") || "").trim();
  const months = monthsOf(ops);
  const mSel = monthSelect(months);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const other = cats.find((c) => c.name === OTHER);
  const catOf = (o) => catById.get(o.categoryId) || other;
  let list = ops.filter((o) => !currentMonth || o.date.startsWith(currentMonth));
  if (catFilter) list = list.filter((o) => catOf(o).id === catFilter);
  if (query) list = list.filter((o) => o.description.toLowerCase().includes(query.toLowerCase()));
  list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const fc = catById.get(catFilter);
  const total = list.reduce((s, o) => s + (o.kind === "expense" ? -o.amount : o.amount), 0);

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
        <input type="text" id="q" placeholder="Поиск по описанию" value="${esc(query)}" style="min-width:160px">
      </div>
    </div>
    <div class="card">
      ${list.length ? `<p class="summary-line">${list.length} ${plural(list.length, "операция", "операции", "операций")}, итог <b>${total >= 0 ? "+" : "−"}${money(Math.abs(total))}</b></p>
        <ul class="op-list">${html}</ul>` : `<div class="empty-note">${query || catFilter ? "Ничего не нашлось — попробуйте другой месяц или сбросьте фильтр." : "В этом месяце операций нет."}</div>`}
      <p class="hint">Чтобы поменять категорию, выберите её в списке у операции. Приложение запомнит
        правило: похожие операции (с тем же словом в описании) получат ту же категорию.</p>
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
    } else if (res.skipped === "income") text = "Категория изменена. Для доходов правило не запоминается.";
    else if (res.skipped === "other") text = "Перенесено в «Прочее».";
    else text = "Категория изменена.";
    toast(text, async () => { await S.undoChange(res.undo); render(); });
    if (res.moved) render();
  }));
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
    const spent = ops.filter((o) => o.kind === "expense" && o.categoryId === c.id && currentMonth && o.date.startsWith(currentMonth)).reduce((s, o) => s + o.amount, 0);
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
        <select id="nl-cat" style="min-width:170px">${cats.filter((c) => c.name !== OTHER).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
        <input type="number" inputmode="numeric" id="nl-cap" min="0" step="100" placeholder="₽ в месяц" style="width:130px">
        <button id="nl-btn">Добавить лимит</button>
      </div>
    </div>

    <div class="card">
      <h2>Категории</h2>
      <div class="row">
        <input type="text" id="nc-name" placeholder="Название, напр. Хобби" style="min-width:170px">
        <input type="text" id="nc-kw" placeholder="Ключевые слова через запятую" style="flex:1;min-width:200px">
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
      ${cats.filter((c) => c.name !== OTHER).map((c) => `<div class="kw-row"><span class="limit-name" style="font-size:21px">${dot(c)}${esc(c.name)}</span><textarea rows="2" data-cat="${esc(c.id)}" aria-label="Ключевые слова: ${esc(c.name)}">${esc(c.keywords)}</textarea></div>`).join("")}
      <div class="row" style="margin-top:12px"><button id="kw-btn">Сохранить и пересчитать</button></div>
      <div id="kw-msg" class="msg"></div>
    </div>`;

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
      const c = await S.createCategory($("#nc-name").value, $("#nc-kw").value);
      if (c.keywords) await S.reclassifyAll();
      limitsPage().then(() => showMsg($("#cat-msg"), "ok", `Категория «${c.name}» добавлена.`));
    } catch (e) { showMsg($("#cat-msg"), "err", e.message); }
  });
  $$(".cat-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`Удалить категорию «${b.dataset.name}»? Её операции перейдут в «Прочее».`)) return;
    const n = await S.deleteCategory(b.dataset.cat);
    limitsPage().then(() => showMsg($("#cat-msg"), "ok", `Удалено. Операций перенесено в «Прочее»: ${n}.`));
  }));
  $("#kw-btn").addEventListener("click", async () => {
    const byId = new Map(cats.map((c) => [c.id, c]));
    for (const ta of $$("textarea[data-cat]")) {
      const kw = ta.value.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean).join(",");
      if (kw !== byId.get(ta.dataset.cat).keywords) await S.updateCategory(ta.dataset.cat, { keywords: kw });
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
        <span class="small">PDF или CSV из Т-Банка, можно несколько сразу. На компьютере — просто перетащите сюда.</span>
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
    const lines = [];
    let ok = true;
    for (const f of files) {
      try {
        const r = await importFile(f);
        if (r.backup) lines.push(`${f.name}: копия загружена — обновлено операций ${r.backup.operations}, категорий ${r.backup.categories}`);
        else lines.push(`${f.name}: найдено ${r.parsed}, добавлено ${r.added}${r.duplicates ? `, уже были ${r.duplicates}` : ""}`);
      } catch (e) { ok = false; lines.push(`Не получилось: ${f.name}: ${e.message}`); }
    }
    showMsg(msg, ok ? "ok" : "err", lines.join("\n"), true);
  };
  $("#file").addEventListener("change", (e) => { handle([...e.target.files]); e.target.value = ""; });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); handle([...e.dataTransfer.files]); });

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
const APP_VERSION = "v5";
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
