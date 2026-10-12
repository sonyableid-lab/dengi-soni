// store.js — хранилище данных прямо в браузере (IndexedDB).
//
// У каждой записи есть updatedAt (время последнего изменения). Благодаря этому
// две копии данных (Mac и iPhone) можно слить без потерь: побеждает более
// свежая правка. Удаление — это пометка deleted, а не стирание, чтобы оно тоже
// «доехало» до другой копии. Эти же поля пригодятся для облачной синхронизации.
import {
  DEFAULT_CATEGORIES, OTHER, buildKeywordIndex, classify, assignHashes,
  descriptionCore, descriptionTokens,
} from "./engine.js";

const DB_NAME = "dengi-soni";
const DB_VERSION = 1;
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
      db.createObjectStore("operations", { keyPath: "hash" });
      db.createObjectStore("categories", { keyPath: "id" });
      db.createObjectStore("limits", { keyPath: "categoryId" });
      db.createObjectStore("meta", { keyPath: "key" });
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
    await putMany("categories", DEFAULT_CATEGORIES.map(([name, keywords, color], i) => ({
      id: defaultCategoryId(name), name, keywords, color, order: i, updatedAt: 0,
    })));
  }
}

// ---------------------------------------------------------------------------
// Чтение
// ---------------------------------------------------------------------------
export async function categories() {
  return (await getAll("categories")).filter(alive).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ru"));
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
  const cats = await categories();
  const index = buildKeywordIndex(cats);
  const other = await otherId();
  const existing = new Set((await getAll("operations")).map((o) => o.hash)); // и удалённые тоже
  const t = now();
  const fresh = [];
  for (const r of records) {
    if (existing.has(r.hash)) continue;
    existing.add(r.hash);
    fresh.push({
      hash: r.hash, date: r.date, description: r.description, amount: r.amount,
      kind: r.kind, account: r.account || "", categoryId: classify(r.description, index) || other,
      manual: false, source: filename, createdAt: t, updatedAt: t,
    });
  }
  await putMany("operations", fresh);
  return { parsed: records.length, added: fresh.length, duplicates: records.length - fresh.length };
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

export async function deleteOperation(hash) {
  const op = (await getAll("operations")).find((o) => o.hash === hash);
  if (op) await putMany("operations", [{ ...op, deleted: true, updatedAt: now() }]);
}

// ---------------------------------------------------------------------------
// Категории и лимиты
// ---------------------------------------------------------------------------
const PALETTE = ["#7C9A3A", "#9B7BC9", "#C7739A", "#3E8A7C", "#C9973B", "#5B79AE", "#A27E5A", "#6C9E6A", "#8A63B8", "#D3A2B9"];

export async function createCategory(name, keywords = "") {
  name = name.trim();
  if (!name) throw new Error("Введите название категории.");
  const cats = await categories();
  if (cats.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`Категория «${name}» уже есть.`);
  const id = "c:" + (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  const otherOrder = (cats.find((c) => c.name === OTHER) || { order: 999 }).order;
  const cat = {
    id, name, keywords: keywords.split(",").map((w) => w.trim().toUpperCase()).filter(Boolean).join(","),
    color: PALETTE[cats.length % PALETTE.length], order: otherOrder - 0.5, updatedAt: now(),
  };
  await putMany("categories", [cat]);
  return cat;
}

export async function updateCategory(id, fields) {
  const c = (await getAll("categories")).find((c) => c.id === id);
  if (!c) throw new Error("Категория не найдена.");
  await putMany("categories", [{ ...c, ...fields, updatedAt: now() }]);
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
  };
}

/** Слияние: по каждой записи остаётся более свежая версия. Ничего не теряется. */
export async function mergeData(data) {
  if (!data || data.format !== FORMAT) throw new Error("Это не файл данных «Денег Сони».");
  const stat = {};
  for (const [store, key] of [["operations", "hash"], ["categories", "id"], ["limits", "categoryId"]]) {
    const mine = new Map((await getAll(store)).map((x) => [x[key], x]));
    const take = [];
    for (const x of data[store] || []) {
      const m = mine.get(x[key]);
      if (!m || (x.updatedAt || 0) > (m.updatedAt || 0)) take.push(x);
    }
    await putMany(store, take);
    stat[store] = take.length;
  }
  return stat;
}

/** Полная очистка (для настроек). */
export async function wipe() {
  const db = await open();
  const tx = db.transaction(["operations", "categories", "limits", "meta"], "readwrite");
  for (const s of ["operations", "categories", "limits", "meta"]) tx.objectStore(s).clear();
  await done(tx);
  await init();
}
