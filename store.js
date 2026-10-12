// store.js — хранилище данных прямо в браузере (IndexedDB).
//
// У каждой записи есть updatedAt (время последнего изменения). Благодаря этому
// две копии данных (Mac и iPhone) можно слить без потерь: побеждает более
// свежая правка. Удаление — это пометка deleted, а не стирание, чтобы оно тоже
// «доехало» до другой копии. Эти же поля пригодятся для облачной синхронизации.
import {
  DEFAULT_CATEGORIES, CATEGORIES_VERSION, OTHER, buildKeywordIndex, classify, assignHashes,
  descriptionCore, descriptionTokens, isGenericTransfer,
} from "./engine.js";

const DB_NAME = "dengi-soni";
const DB_VERSION = 2;
const FORMAT = "dengi-soni-backup";
let dbp = null;

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
function done(tx) {
  return new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = tx.onabort = () => rej(tx.error); });
}

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const make = (name, keyPath) => { if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath }); };
      make("operations", "hash");
      make("categories", "id");
      make("limits", "categoryId");
      make("meta", "key");
      make("debts", "id");      // v2: долги
      make("settings", "key");  // v2: настройки плана (подушка и т.п.), переносятся копией
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

async function getAll(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}
async function putMany(store, items) {
  if (!items.length) return;
  const db = await open();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const it of items) os.put(it);
  await done(tx);
}
export async function getMeta(key) {
  const db = await open();
  const r = await req(db.transaction("meta").objectStore("meta").get(key));
  return r ? r.value : undefined;
}
export async function setMeta(key, value) {
  await putMany("meta", [{ key, value }]);
}

const now = () => Date.now();
const alive = (x) => !x.deleted;
export const defaultCategoryId = (name) => "def:" + name;

// ---------------------------------------------------------------------------
// Инициализация: стартовые категории (updatedAt = 0 — любая правка их перебьёт)
// ---------------------------------------------------------------------------
export async function init() {
  // Попросить браузер не чистить данные при нехватке места
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
  const cats = await getAll("categories");
  if (!cats.length) {
    await putMany("categories", DEFAULT_CATEGORIES.map((d, i) => ({ ...d, order: i, schema: CATEGORIES_VERSION, updatedAt: 0 })));
    await setMeta("catVersion", CATEGORIES_VERSION);
    return;
  }
  await healCategories();
}

/** Проверить, что категории в актуальном формате (в том числе после открытия
 *  старой копии), и пересчитать категории операций, которые вы не меняли вручную. */
async function healCategories() {
  const cats = await getAll("categories");
  const ver = (await getMeta("catVersion")) || 1;
  const stale = cats.some((c) => !c.deleted && (c.schema || 0) < CATEGORIES_VERSION);
  if (ver < CATEGORIES_VERSION || stale || DEFAULT_CATEGORIES.some((d) => !cats.find((c) => c.id === d.id))) {
    await migrateCategories(cats);
  }
  await reclassifyAll();
}

const splitWords = (s) => (s || "").split(",").map((w) => w.trim()).filter(Boolean);

/** Обновить стартовые категории до новой версии, не трогая ваши правки. */
async function migrateCategories(cats) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const aliveNames = new Set(cats.filter(alive).filter((c) => !c.id.startsWith("def:")).map((c) => c.name.toLowerCase()));
  const t = now();
  const out = [];
  DEFAULT_CATEGORIES.forEach((d, i) => {
    const c = byId.get(d.id);
    if (!c) {
      if (!aliveNames.has(d.name.toLowerCase())) out.push({ ...d, order: i, schema: CATEGORIES_VERSION, updatedAt: t });
      return;
    }
    if ((c.schema || 0) >= CATEGORIES_VERSION) return; // уже в новом формате
    // Ваши слова сохраняем, но убираем те, что теперь принадлежат другим категориям, и добавляем новые.
    const others = new Set(DEFAULT_CATEGORIES.filter((x) => x.id !== d.id).flatMap((x) => splitWords(x.keywords).map((w) => w.toUpperCase())));
    const mine = c.updatedAt ? splitWords(c.keywords).filter((w) => !others.has(w.toUpperCase())) : [];
    const have = new Set(mine.map((w) => w.toUpperCase()));
    for (const w of splitWords(d.keywords)) if (!have.has(w.toUpperCase())) mine.push(w);
    // Название и цвет стартовых категорий всегда берём новые (переименовать их в приложении нельзя).
    // Тип и «обязательность» сохраняем, только если их выбирали вы в новой версии (есть schema).
    out.push({
      ...c, name: d.name, color: d.color, keywords: mine.join(","),
      kind: c.schema && c.kind ? c.kind : d.kind,
      essential: c.schema && c.essential !== undefined ? c.essential : d.essential,
      order: i, schema: CATEGORIES_VERSION, updatedAt: t,
    });
  });
  // Ваши собственные категории: раньше им по умолчанию ставился тип «Расход», из-за чего
  // поступления в них (например, зарплата) вычитались из трат. Теперь — «смотря по операции».
  for (const c of cats) {
    if (c.id.startsWith("def:") || (c.schema || 0) >= CATEGORIES_VERSION) continue;
    out.push({ ...c, kind: !c.kind || c.kind === "expense" ? "both" : c.kind, schema: CATEGORIES_VERSION, updatedAt: t });
  }
  await putMany("categories", out);
  await setMeta("catVersion", CATEGORIES_VERSION);
}

/** Вернуть стартовые категории к стандартному виду. Ваши собственные категории остаются.
 *  resetManual — забыть и ручные выборы категорий у операций. */
export async function resetCategories(resetManual = false) {
  const t = now();
  const cats = await getAll("categories");
  const byId = new Map(cats.map((c) => [c.id, c]));
  await putMany("categories", DEFAULT_CATEGORIES.map((d, i) => ({
    ...(byId.get(d.id) || {}), ...d, deleted: false, order: i, schema: CATEGORIES_VERSION, updatedAt: t,
  })));
  if (resetManual) {
    const ops = (await getAll("operations")).filter((o) => o.manual);
    await putMany("operations", ops.map((o) => ({ ...o, manual: false, updatedAt: t })));
  }
  await setMeta("catVersion", CATEGORIES_VERSION);
  return reclassifyAll();
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------
const DEFAULT_KIND = new Map(DEFAULT_CATEGORIES.map((d) => [d.id, d.kind]));
const DEFAULT_ESSENTIAL = new Map(DEFAULT_CATEGORIES.map((d) => [d.id, d.essential]));
export async function categories() {
  return (await getAll("categories")).filter(alive)
    .map((c) => (c.kind ? c : { ...c, kind: DEFAULT_KIND.get(c.id) || "expense" }))
    .map((c) => (c.essential !== undefined ? c : { ...c, essential: DEFAULT_ESSENTIAL.get(c.id) || false })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
}
export async function operations() {
  return (await getAll("operations")).filter(alive);
}
export async function limits() {
  return (await getAll("limits")).filter((l) => l.cap > 0);
}
async function otherId() {
  const c = (await categories()).find((c) => c.name === OTHER);
  return c ? c.id : null;
}

// ---------------------------------------------------------------------------
// Импорт выписки
// ---------------------------------------------------------------------------
/** records — результат parsePdf/parseCsv. Добавляет новые, повторы пропускает. */
export async function importRecords(records, filename) {
  await assignHashes(records);
  // Номера кредитных карт запоминаем: следующая выписка с этой карты узнается, даже если в ней нет процентов
  const creditCards = new Set(await getSetting("creditCards", []));
  if (records.some((r) => r.accountType === "credit")) {
    for (const r of records) if (r.account) creditCards.add(r.account);
    await setSetting("creditCards", [...creditCards]);
  } else if (records.some((r) => r.account && creditCards.has(r.account))) {
    for (const r of records) r.accountType = "credit";
  }
  const cats = await categories();
  const index = buildKeywordIndex(cats);
  const other = await otherId();
  const existing = new Set((await getAll("operations")).map((o) => o.hash)); // и удалённые тоже
  const t = now();
  const fresh = [];
  const all = new Map((await getAll("operations")).map((o) => [o.hash, o]));
  const patched = [];
  for (const r of records) {
    if (existing.has(r.hash)) {
      // Уже есть — но если раньше не знали, с какой это карты, допишем
      const o = all.get(r.hash);
      if (o && r.accountType && !o.accountType) patched.push({ ...o, accountType: r.accountType, contract: r.contract || "", updatedAt: t });
      continue;
    }
    existing.add(r.hash);
    fresh.push({
      hash: r.hash, date: r.date, description: r.description, amount: r.amount,
      kind: r.kind, account: r.account || "", accountType: r.accountType || "", contract: r.contract || "",
      categoryId: classify(r.description, index) || other,
      manual: false, source: filename, createdAt: t, updatedAt: t,
    });
  }
  await putMany("operations", fresh.concat(patched));
  return { parsed: records.length, added: fresh.length, duplicates: records.length - fresh.length, accountType: records[0]?.accountType || "" };
}

// ---------------------------------------------------------------------------
// Смена категории операции + самообучение
// ---------------------------------------------------------------------------
/** Возвращает сводку для тоста и кнопки «Отменить». */
export async function setOperationCategory(hash, categoryId) {
  const ops = await getAll("operations");
  const op = ops.find((o) => o.hash === hash);
  if (!op) throw new Error("Операция не найдена.");
  const t = now();
  const changes = [{ ...op, categoryId, manual: true, updatedAt: t }];
  const undo = { ops: [{ ...op }], cats: [] };
  const result = { keyword: "", addedKeyword: false, moved: 0, skipped: "", undo };
  const other = await otherId();

  if (op.kind === "income") result.skipped = "income";
  else if (isGenericTransfer(op.description)) result.skipped = "transfer";
  else if (categoryId === other) result.skipped = "other";
  else {
    const keyword = descriptionCore(op.description);
    if (!keyword) result.skipped = "no_keyword";
    else {
      result.keyword = keyword;
      // Слово принадлежит ровно одной категории: забираем его у остальных
      const cats = await getAll("categories");
      const catChanges = [];
      for (const c of cats.filter(alive)) {
        const words = c.keywords.split(",").map((w) => w.trim()).filter(Boolean);
        const has = words.some((w) => w.toUpperCase() === keyword);
        if (c.id === categoryId && !has) {
          undo.cats.push({ ...c });
          catChanges.push({ ...c, keywords: [...words, keyword].join(","), updatedAt: t });
          result.addedKeyword = true;
        } else if (c.id !== categoryId && has) {
          undo.cats.push({ ...c });
          catChanges.push({ ...c, keywords: words.filter((w) => w.toUpperCase() !== keyword).join(","), updatedAt: t });
        }
      }
      await putMany("categories", catChanges);
      // Похожие операции (то же слово отдельным словом), если их не правили вручную
      for (const s of ops) {
        if (s.deleted || s.hash === hash || s.categoryId === categoryId || s.manual) continue;
        if (s.categoryId !== other && s.categoryId != null) continue;
        if (!descriptionTokens(s.description).has(keyword)) continue;
        undo.ops.push({ ...s });
        changes.push({ ...s, categoryId, updatedAt: t });
        result.moved++;
      }
    }
  }
  await putMany("operations", changes);
  return result;
}

/** Отменить последнее изменение: вернуть прежние версии записей (со свежим временем). */
export async function undoChange(undo) {
  const t = now();
  await putMany("operations", undo.ops.map((o) => ({ ...o, updatedAt: t })));
  await putMany("categories", undo.cats.map((c) => ({ ...c, updatedAt: t })));
}

/** Пересчитать категории по словарю. Ручные выборы не трогаем. */
export async function reclassifyAll() {
  const index = buildKeywordIndex(await categories());
  const other = await otherId();
  const t = now();
  const changes = [];
  for (const o of await operations()) {
    if (o.manual) continue;
    const id = classify(o.description, index) || other;
    if (id !== o.categoryId) changes.push({ ...o, categoryId: id, updatedAt: t });
  }
  await putMany("operations", changes);
  return changes.length;
}

/** Не учитывать операцию в расчётах «Плана» (разовая трата, поездка и т. п.). */
export async function setOperationPlanExcluded(hash, excluded) {
  const op = (await getAll("operations")).find((o) => o.hash === hash);
  if (!op) throw new Error("Операция не найдена.");
  await putMany("operations", [{ ...op, planExcluded: !!excluded, updatedAt: now() }]);
}

export async function setOperationNote(hash, note) {
  const op = (await getAll("operations")).find((o) => o.hash === hash);
  if (!op) throw new Error("Операция не найдена.");
  await putMany("operations", [{ ...op, note: (note || "").trim(), updatedAt: now() }]);
}

export async function deleteOperation(hash) {
  const op = (await getAll("operations")).find((o) => o.hash === hash);
  if (op) await putMany("operations", [{ ...op, deleted: true, updatedAt: now() }]);
}

// ---------------------------------------------------------------------------
// Категории и лимиты
// ---------------------------------------------------------------------------
const PALETTE = ["#7C9A3A", "#9B7BC9", "#C7739A", "#3E8A7C", "#C9973B", "#5B79AE", "#A27E5A", "#6C9E6A", "#8A63B8", "#D3A2B9"];

export async function createCategory(name, keywords = "", kind = "both") {
  name = name.trim();
  if (!name) throw new Error("Введите название категории.");
  const cats = await categories();
  if (cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`Категория «${name}» уже есть.`);
  const id = "c:" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const otherOrder = (cats.find((c) => c.name === OTHER) || { order: 999 }).order;
  const cat = {
    id, name, keywords: keywords.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean).join(","),
    color: PALETTE[cats.length % PALETTE.length], kind, schema: CATEGORIES_VERSION, order: otherOrder - 0.5, updatedAt: now(),
  };
  await putMany("categories", [cat]);
  return cat;
}

export async function updateCategory(id, fields) {
  const c = (await getAll("categories")).find((c) => c.id === id);
  if (!c) throw new Error("Категория не найдена.");
  await putMany("categories", [{ ...c, ...fields, schema: Math.max(c.schema || 0, CATEGORIES_VERSION), updatedAt: now() }]);
}

/** Удаление: операции категории → «Прочее», лимит снимается. */
export async function deleteCategory(id) {
  const cats = await categories();
  const c = cats.find((c) => c.id === id);
  if (!c || c.name === OTHER) throw new Error("Эту категорию удалить нельзя.");
  const other = await otherId();
  const t = now();
  const moved = (await operations()).filter((o) => o.categoryId === id)
    .map((o) => ({ ...o, categoryId: other, manual: false, updatedAt: t }));
  await putMany("operations", moved);
  await putMany("categories", [{ ...c, deleted: true, updatedAt: t }]);
  await putMany("limits", [{ categoryId: id, cap: 0, updatedAt: t }]);
  return moved.length;
}

export async function setLimit(categoryId, cap) {
  await putMany("limits", [{ categoryId, cap: Math.max(0, +cap || 0), updatedAt: now() }]);
}

// ---------------------------------------------------------------------------
// Резервная копия: сохранить в файл и слить из файла
// ---------------------------------------------------------------------------
export async function exportData() {
  return {
    format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
    operations: await getAll("operations"),
    categories: await getAll("categories"),
    limits: await getAll("limits"),
    debts: await getAll("debts"),
    settings: await getAll("settings"),
  };
}

/** Слияние: по каждой записи остаётся более свежая версия. Ничего не теряется. */
export async function mergeData(data) {
  if (!data || data.format !== FORMAT) throw new Error("Это не файл данных «Денег Сони».");
  const stat = {};
  for (const [store, key] of [["operations", "hash"], ["categories", "id"], ["limits", "categoryId"], ["debts", "id"], ["settings", "key"]]) {
    const mine = new Map((await getAll(store)).map((x) => [x[key], x]));
    const take = [];
    for (const x of data[store] || []) {
      const m = mine.get(x[key]);
      if (!m || (x.updatedAt || 0) > (m.updatedAt || 0)) take.push(x);
    }
    await putMany(store, take);
    stat[store] = take.length;
  }
  // Копия могла быть сделана старой версией — приводим категории к новому виду
  await healCategories();
  return stat;
}

/** Полная очистка (для настроек). */
export async function wipe() {
  const db = await open();
  const all = ["operations", "categories", "limits", "meta", "debts", "settings"];
  const tx = db.transaction(all, "readwrite");
  for (const s of all) tx.objectStore(s).clear();
  await done(tx);
  await init();
}

// ---------------------------------------------------------------------------
// Долги
// ---------------------------------------------------------------------------
// Долг: { id, type: "card" | "loan" | "person", name, amount, asOf, rate, minPayment,
//         dueDay, limit, note, updatedAt, deleted }
// amount — сколько вы должны на дату asOf. Платежи, привязанные к долгу
// (operation.debtId) и сделанные с этой даты, уменьшают остаток.
export async function debts() {
  return (await getAll("debts")).filter(alive).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function saveDebt(d) {
  const t = now();
  const id = d.id || "d:" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const old = (await getAll("debts")).find((x) => x.id === id);
  const debt = {
    ...(old || { createdAt: t }), ...d, id,
    amount: Math.max(0, +d.amount || 0), rate: Math.max(0, +d.rate || 0),
    minPayment: Math.max(0, +d.minPayment || 0), limit: Math.max(0, +d.limit || 0),
    dueDay: d.dueDay ? Math.min(31, Math.max(1, +d.dueDay)) : null,
    asOf: d.asOf || new Date().toISOString().slice(0, 10), updatedAt: t,
  };
  await putMany("debts", [debt]);
  return debt;
}

export async function deleteDebt(id) {
  const d = (await getAll("debts")).find((x) => x.id === id);
  if (d) await putMany("debts", [{ ...d, deleted: true, updatedAt: now() }]);
}

/** Привязать операцию к долгу (или отвязать: debtId = ""). */
export async function setOperationDebt(hash, debtId) {
  const op = (await getAll("operations")).find((o) => o.hash === hash);
  if (!op) throw new Error("Операция не найдена.");
  await putMany("operations", [{ ...op, debtId: debtId || "", updatedAt: now() }]);
}

// ---------------------------------------------------------------------------
// Настройки плана (переносятся вместе с копией)
// ---------------------------------------------------------------------------
export async function getSetting(key, fallback = null) {
  const r = (await getAll("settings")).find((x) => x.key === key);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) {
  await putMany("settings", [{ key, value, updatedAt: now() }]);
}
