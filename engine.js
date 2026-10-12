// engine.js — «движок» приложения «Деньги Сони»: разбор выписок,
// категоризация, отпечатки операций. Работает и в браузере, и в Node (тесты).
// Перенесено с Python (app/pdf_parser.py, app/parser.py, app/classifier.py).

// ---------------------------------------------------------------------------
// Стартовые категории.
// kind — как категория участвует в итогах:
//   expense  — расходы; входящий перевод в неё (возврат, чья-то доля) УМЕНЬШАЕТ расход
//   income   — доходы; списание в ней уменьшает доход
//   both     — операция считается по своему направлению (переводы людям, прочее)
//   transfer — между своими счетами: не доход и не расход, в итоги не входит
// id у стартовых категорий постоянный ("def:…"), даже если название поменялось.
// ---------------------------------------------------------------------------
// essential — обязательная трата (входит в расчёт подушки безопасности)
const C = (name, keywords, color, kind = "expense", id = "def:" + name, essential = false) => ({ id, name, keywords, color, kind, essential });
const E = (name, keywords, color) => C(name, keywords, color, "expense", "def:" + name, true);
export const DEFAULT_CATEGORIES = [
  E("Продукты", "МАГНИТ,MAGNIT,ПЯТЁРОЧКА,ПЯТЕРОЧКА,PYATEROCHKA,ПЕРЕКРЁСТОК,ПЕРЕКРЕСТОК,PEREKRESTOK,ЛЕНТА,LENTA,АШАН,AUCHAN,ВКУСВИЛЛ,VKUSVILL,VV_,ДИКСИ,СПАР,SPAR,МЕТРО,АЗБУКА ВКУСА,ПРОДУКТЫ,ATAK,САМБЕРУ,SAMOKAT", "#8DB255"),
  C("Кафе и рестораны", "РЕСТОРАН,КАФЕ,КОФЕЙНЯ,КОФЕ,ПИЦЦА,СУШИ,РОЛЛЫ,СТОЛОВАЯ,БУРГЕР,MCDONALDS,DODO,KFC,ВКУСНО И ТОЧКА,ШОКОЛАДНИЦА,ЯНДЕКС.ЕДА,YANDEX EDA,DELIVERY,СБЕРМАРКЕТ,MEALTY,DONER,ДОНЕР,SHAURMA,ШАУРМА,EATANDSPLIT,WU SHU", "#D98BAE"),
  E("Транспорт", "ТАКСИ,YANDEX GO,ЯНДЕКС GO,YANDEX*GO,YANDEX.TAXI,ЯНДЕКС.ТАКСИ,UBER,ТРОЙКА,ЦППК,CPPK,РЖД,RUSSIAN RAILWAYS,АЭРОФЛОТ,AEROFLOT,ПОБЕДА,АЗС,БЕНЗИН,ГАЗПРОМНЕФТЬ,ЛУКОЙЛ,LUKOIL,СИТИДРАЙВ,ВЕЛОБАЙК,ПАРКОВКА,YANDEX.SCOOTER,GO SCOOTER,MOSKVA METRO,MOS.TRANSPORT,NOVOPODREZKOVO,MOSSELMASH,LIANOZOVO,PAVELETSKAYA", "#6A4E9E"),
  E("Аренда и ЖКХ", "АРЕНДА,КВАРТПЛАТА,ЖКХ,ЕИРЦ,МОСЭНЕРГО,ЭНЕРГОСБЫТ,МОСГАЗ,МОСВОДОКАНАЛ", "#4A3772"),
  C("Дом и быт", "IKEA,ЛЕРУА МЕРЛЕН,ХОФФ,М.ВИДЕО,МВИДЕО,MVIDEO,ЭЛЬДОРАДО,DNS,СИТИЛИНК,РЕМОНТ,МЕБЕЛЬ,FIXPRICE,FIX PRICE", "#B39368"),
  C("Одежда и покупки", "WILDBERRIES,ОЗОН,OZON,ЛАМОДА,LAMODA,ZARA,H&M,UNIQLO,GLORIA JEANS,АЛИЭКСПРЕСС,ALIEXPRESS,FAMILIA", "#E2B64E"),
  C("Красота и уход", "ЗОЛОТОЕ ЯБЛОКО,GOLDAPPLE,ЛЭТУАЛЬ,LETOILE,РИВ ГОШ,RIVE GAUCHE,ПОДРУЖКА,МАГНИТ КОСМЕТИК,MAGNIT KOSMETIK,УЛЫБКА РАДУГИ,САЛОН КРАСОТЫ,BARBER", "#E7A6C4"),
  E("Здоровье", "АПТЕКА,APTEKA,ГОРЗДРАВ,ЗДОРОВ.РУ,РИГЛА,RIGLA,36.6,ИНВИТРО,ГЕМОТЕСТ,КЛИНИКА,ПОЛИКЛИНИКА,СТОМАТОЛОГИЯ,МЕДСИ", "#4E9C8F"),
  C("Спорт", "СПОРТМАСТЕР,ФИТНЕС,FITNESS,WORLD CLASS,DDX,ЙОГА,YOGA,БАССЕЙН", "#5FA88A"),
  C("Развлечения", "КИНО,ТЕАТР,КОНЦЕРТ,МУЗЕЙ,STEAM,PLAYSTATION,XBOX,CINEMASTAR,КАРО,FORMULA KINO", "#A98BD6"),
  C("Подписки", "СЕРВИСЫ ЯНДЕКСА,ЯНДЕКС.ПЛЮС,YANDEX PLUS,КИНОПОИСК,ОККО,KION,ИВИ,NETFLIX,SPOTIFY,APPLE.COM,ITUNES", "#8F7BC0"),
  E("Связь и интернет", "МТС,БИЛАЙН,BEELINE,МЕГАФОН,ТЕЛЕ2,ЙОТА,YOTA,РОСТЕЛЕКОМ,МГТС,MGTS,ПОЧТА РОССИИ", "#5E7FB8"),
  C("Образование", "SKYENG,КУРСЫ,ШКОЛА,УНИВЕРСИТЕТ,ПРАКТИКУМ,STEPIK,STEPIC,УЧЕБНИК", "#3F6E4E"),
  C("Подарки", "FLOWWOW,ЦВЕТЫ,FLOWERS", "#D4789B"),
  C("Путешествия", "OSTROVOK,ОТЕЛЬ,HOTEL,BOOKING,АВИАБИЛЕТ,TINKOFF TRAVEL", "#6FB3C4"),
  C("Питомцы", "ZOOMAGAZIN,ЗООМАГАЗИН,ЧЕТЫРЕ ЛАПЫ,4 LAPY", "#B8CF5A"),
  C("Наличные", "СНЯТИЕ НАЛИЧНЫХ", "#A6A396"),
  C("Проценты и комиссии", "ПЛАТА ЗА ОБСЛУЖИВАНИЕ,КОМИССИЯ,ПРОЦЕНТЫ ПО КРЕДИТУ,ПРОЦЕНТЫ ЗА ПОЛЬЗОВАНИЕ,ШТРАФ,НЕУСТОЙКА", "#A0616A"),
  C("Погашение долгов", "ПОГАШЕНИЕ КРЕДИТА,ПОГАШЕНИЕ ЗАДОЛЖЕННОСТИ,ВОЗВРАТ ДОЛГА", "#7B4A86", "debt"),
  C("Переводы людям", "ВНЕШНИЙ ПЕРЕВОД,ПЕРЕВОД ПО НОМЕРУ,ПЕРЕВОД,СБП,ВНЕСЕНИЕ НАЛИЧНЫХ", "#8C8FA8", "both", "def:Переводы"),
  C("Зарплата", "БАНКА ВТБ,ЗАЧИСЛЕНИЕ ЗАРПЛАТЫ,ЗАРПЛАТА,АВАНС", "#2F6B45", "income"),
  C("Подработка", "", "#6B9C3A", "income"),
  C("Пополнение", "ПОПОЛНЕНИЕ,ЗАЧИСЛЕНИЕ", "#9DBF6A", "income"),
  C("Кэшбэк и проценты", "КЭШБЭК,CASHBACK,ПРОЦЕНТЫ НА ОСТАТОК,ВЫПЛАТА ПРОЦЕНТОВ,НАЧИСЛЕНИЕ ПРОЦЕНТОВ", "#C3DA6A", "income", "def:Кэшбэк"),
  C("Между своими счетами", "ПЕРЕВОД СЕБЕ,ПЕРЕВОД С ДОГОВОРА,ВНУТРЕННИЙ ПЕРЕВОД,МЕЖДУ СВОИМИ СЧЕТАМИ", "#B9B6A6", "transfer"),
  C("Прочее", "", "#C9C6B8", "both"),
];
export const CATEGORIES_VERSION = 4;
export const KIND_LABELS = { expense: "Расход", income: "Доход", both: "Смотря по операции", debt: "Платёж по долгу", transfer: "Между своими счетами" };

/** Вклад операции в итоги с учётом типа категории: { income, expense, debt } (могут быть < 0 — возвраты). */
export function contribution(op, kind = "both") {
  const a = op.amount;
  const inc = op.kind === "income";
  switch (kind) {
    case "transfer": return { income: 0, expense: 0, debt: 0 };
    case "debt": return { income: 0, expense: 0, debt: inc ? -a : a };
    case "expense": return { income: 0, expense: inc ? -a : a, debt: 0 };
    case "income": return { income: inc ? a : -a, expense: 0, debt: 0 };
    default: return inc ? { income: a, expense: 0, debt: 0 } : { income: 0, expense: a, debt: 0 };
  }
}

/** Описание перевода: одинаково для разных людей и целей, поэтому правило по нему не запоминаем. */
export function isGenericTransfer(desc) {
  return /(перевод|пополнение|внесение|снятие|система быстрых платежей|сбп)/i.test(desc || "");
}

export const OTHER = "Прочее";

// ---------------------------------------------------------------------------
// Классификатор
// ---------------------------------------------------------------------------
const MIN_KEYWORD_LEN = 3;

/** categories: [{id, name, keywords}] → индекс [[СЛОВО, id]], длинные слова первыми */
export function buildKeywordIndex(categories) {
  const index = [];
  for (const c of categories) {
    for (let w of (c.keywords || "").split(",")) {
      w = w.trim().toUpperCase();
      if (w.length >= MIN_KEYWORD_LEN) index.push([w, c.id]);
    }
  }
  index.sort((a, b) => b[0].length - a[0].length);
  return index;
}

export function classify(description, index) {
  if (!description) return null;
  const text = description.toUpperCase();
  for (const [w, id] of index) if (text.includes(w)) return id;
  return null;
}

// Служебные слова: с них начинаются разные операции, правилом быть не могут
const IGNORE_CORE_WORDS = new Set([
  "ОПЛАТА", "ПЕРЕВОД", "СНЯТИЕ", "ВНЕСЕНИЕ", "ЗАЧИСЛЕНИЕ", "ПОПОЛНЕНИЕ",
  "ПЛАТЁЖ", "ПЛАТЕЖ", "ПОКУПКА", "УСЛУГ", "ВОЗВРАТ", "СРЕДСТВ", "ОПЕРАЦИИ",
]);
const PUNCT_RE = /^[«»"'.,;:!?()[\]{}]+|[«»"'.,;:!?()[\]{}]+$/g;

/** «Ядро» описания — первое значимое слово: «Оплата в ATAK 421 Moscow RUS» → «ATAK» */
export function descriptionCore(desc) {
  for (const word of (desc || "").trim().toUpperCase().split(/\s+/)) {
    const w = word.replace(PUNCT_RE, "");
    if (w.length >= MIN_KEYWORD_LEN && !/^\d+$/.test(w) && !IGNORE_CORE_WORDS.has(w)) return w;
  }
  return "";
}

/** Слова описания как набор (для поиска «похожих» операций при обучении) */
export function descriptionTokens(desc) {
  return new Set((desc || "").toUpperCase().replace(/ /g, " ").split(/\s+/).map((t) => t.replace(PUNCT_RE, "")));
}

// ---------------------------------------------------------------------------
// Числа, даты, отпечатки
// ---------------------------------------------------------------------------
export function toNumber(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/ /g, "").replace(/ /g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else s = s.replace(",", ".");
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(raw) {
  raw = (raw || "").trim();
  let m = raw.match(/^(\d{2})\.(\d{2})\.(\d{2}|\d{4})(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    let y = m[3].length === 2 ? (+m[3] < 69 ? "20" : "19") + m[3] : m[3];
    const d = new Date(Date.UTC(+y, +m[2] - 1, +m[1]));
    if (d.getUTCDate() !== +m[1] || d.getUTCMonth() !== +m[2] - 1) return null;
    return `${y}-${m[2]}-${m[1]}`;
  }
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function sha256(text) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function makeHashPayload(dateIso, signed, description) {
  return `${dateIso}|${signed.toFixed(2)}|${description.trim().toUpperCase()}`;
}

/** Хэши с номером повтора: одинаковые операции в один день — разные операции. */
export async function assignHashes(records) {
  const seen = new Map();
  for (const r of records) {
    const signed = r.kind === "expense" ? -r.amount : r.amount;
    const base = await sha256(makeHashPayload(r.date, signed, r.description));
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    r.hash = n === 1 ? base : `${base}#${n}`;
  }
  return records;
}

// ---------------------------------------------------------------------------
// PDF: построчный разбор (как в Python-версии)
// ---------------------------------------------------------------------------
const DATE_START_RE = /^\d{2}\.\d{2}\.\d{2,4}(?=\s|$)/;
const TIME_START_RE = /^\d{2}:\d{2}(?::\d{2})?(?=\s|$)/;
const LEADING_TIMES_RE = /^(?:\d{2}:\d{2}(?::\d{2})?\s+)+/;
const AMOUNT_START_RE = /^[-+]?\d[\d\s ]*[.,]\d{2}(?![\d.,])/;
const CURRENCY_RE = /^(?:₽|руб\.?|rub)\s*/i;
const TRAILING_CARD_RE = /\s(\d{4})$/;
const FOOTER_IN_DESC_RE = /\s(?:БИК\s+\d|ИНН\s+\d|КПП\s+\d|Пополнения:|Списания:|Остаток:).*$/;
const SKIP_PATTERNS = [
  "выписка", "период", "дата операции", "сумма операции", "описание",
  "итого", "всего по", "номер карты", "счёт", "счет", "валюта",
  "т-банк", "тинькофф", "акционерное", "лицензия", "страница",
  "приход", "расход", "остаток", "пополнение, руб",
  "операции списания", "в валюте карты",
  "справка о движении", "владелец", "номер счёта", "номер счета",
  "исполнитель", "подпись", "сгенерировано",
  "пополнения:", "списания:", "с уважением", "руководитель управления",
];

function cleanDescription(d) {
  return d.replace(FOOTER_IN_DESC_RE, "").replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "");
}

function consumeAmount(s) {
  const m = s.match(AMOUNT_START_RE);
  if (!m) return [null, s];
  return [m[0], s.slice(m[0].length).trimStart()];
}

export function recordsFromLines(lines) {
  const records = [];
  for (let line of lines) {
    line = line.split(/\s+/).filter(Boolean).join(" ");
    if (!line) continue;
    const low = line.toLowerCase();
    const dm = line.match(DATE_START_RE);
    if (!dm && SKIP_PATTERNS.some((p) => low.includes(p))) continue;
    if (!dm) {
      const cont = cleanDescription(line.replace(LEADING_TIMES_RE, ""));
      if (records.length && cont && /[а-яa-z]{3}/i.test(cont)) {
        const last = records[records.length - 1];
        last.description = cleanDescription(last.description + " " + cont);
      }
      continue;
    }
    let rest = line.slice(dm[0].length).trimStart();
    const dm2 = rest.match(DATE_START_RE);
    if (dm2) rest = rest.slice(dm2[0].length).trimStart();
    const tm = rest.match(TIME_START_RE);
    if (tm) rest = rest.slice(tm[0].length).trimStart();

    let amountRaw;
    [amountRaw, rest] = consumeAmount(rest);
    if (amountRaw === null) continue;
    rest = rest.replace(CURRENCY_RE, "");
    let a2;
    [a2, rest] = consumeAmount(rest);
    if (a2 !== null) rest = rest.replace(CURRENCY_RE, "");

    let description = cleanDescription(rest);
    let account = "";
    const cm = description.match(TRAILING_CARD_RE);
    if (cm) {
      account = cm[1];
      description = description.slice(0, cm.index).trimEnd();
    }
    const date = parseDate(dm[0]);
    const amount = toNumber(amountRaw);
    if (!date || amount === null || amount === 0) continue;
    records.push({
      date, description, amount: Math.abs(amount),
      kind: amount > 0 ? "income" : "expense", account,
    });
  }
  return records;
}

/** Текстовые элементы pdf.js одной страницы → строки (как extract_text у pdfplumber). */
export function itemsToLines(items, yTol = 3) {
  const parts = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({ x: it.transform[4], y: it.transform[5], w: it.width || 0, s: it.str }));
  parts.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const p of parts) {
    const row = rows.find((r) => Math.abs(r.y - p.y) <= yTol);
    if (row) row.items.push(p);
    else rows.push({ y: p.y, items: [p] });
  }
  rows.sort((a, b) => b.y - a.y);
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x).map((p) => p.s).join(" "));
}

/** pdfjsLib — модуль pdf.js; data — Uint8Array файла. Возвращает записи без хэшей. */
export async function parsePdf(pdfjsLib, data) {
  let doc;
  try {
    doc = await pdfjsLib.getDocument({ data }).promise;
  } catch (e) {
    throw new Error("Файл не читается как PDF (повреждён или это другой формат).");
  }
  const records = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    records.push(...recordsFromLines(itemsToLines(tc.items)));
  }
  await doc.destroy();
  if (!records.length)
    throw new Error("В PDF не найдено ни одной операции. Это точно выписка с операциями, а не справка? И текст в ней не картинкой?");
  return records;
}

// ---------------------------------------------------------------------------
// CSV (выписка Т-Банка «;» или простой CSV date/amount/description)
// ---------------------------------------------------------------------------
function splitCsvLine(line, sep) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function decodeText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("Файл пустой.");
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ";" : ",";
  let hi = lines.findIndex((l) => /дата операции|^"?date"?[;,]/i.test(l));
  if (hi < 0) hi = 0;
  const header = splitCsvLine(lines[hi], sep).map((h) => h.toLowerCase());
  // Имена проверяются по порядку приоритета: «Сумма в валюте счёта» важнее «Суммы операции»
  const find = (...names) => {
    for (const n of names) {
      const i = header.findIndex((h) => h === n || h.startsWith(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const iDate = find("дата операции", "date", "дата");
  const iAmount = find("сумма в валюте счёта", "сумма в валюте счета", "сумма операции", "amount", "сумма");
  const iDesc = find("описание", "description", "назначение");
  const iKind = find("type", "kind", "тип");
  const iCard = find("номер карты");
  const iStatus = find("статус");
  if (iDate < 0 || iAmount < 0 || iDesc < 0)
    throw new Error("Не нашла в CSV колонки даты, суммы и описания.");
  const records = [];
  for (const l of lines.slice(hi + 1)) {
    const c = splitCsvLine(l, sep);
    if (iStatus >= 0 && /failed|отклон/i.test(c[iStatus] || "")) continue;
    const date = parseDate((c[iDate] || "").split(" ")[0]);
    let amount = toNumber(c[iAmount]);
    if (!date || amount === null || amount === 0) continue;
    let kind = amount < 0 ? "expense" : "income";
    if (iKind >= 0) {
      const k = (c[iKind] || "").toLowerCase();
      if (/expense|расход/.test(k)) kind = "expense";
      else if (/income|доход|приход/.test(k)) kind = "income";
    }
    records.push({
      date, description: (c[iDesc] || "").trim(), amount: Math.abs(amount), kind,
      account: iCard >= 0 ? (c[iCard] || "").replace(/\D/g, "").slice(-4) : "",
    });
  }
  if (!records.length) throw new Error("В CSV не найдено операций.");
  return records;
}
