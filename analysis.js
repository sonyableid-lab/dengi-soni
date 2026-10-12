// analysis.js — расчёты для страницы «План»: средний месяц, подушка безопасности,
// свободный остаток и план погашения долгов. Только арифметика, без сети.
import { contribution, OTHER } from "./engine.js";

const MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
export const monthName = (m) => MONTHS_NOM[+m.slice(5, 7) - 1];

/** Полные месяцы с данными (текущий, ещё не закончившийся, не берём), не больше `max` последних. */
export function completeMonths(ops, today = new Date(), max = 6) {
  const cur = today.toISOString().slice(0, 7);
  const all = [...new Set(ops.map((o) => o.date.slice(0, 7)))].filter((m) => m < cur).sort();
  return all.slice(-max);
}

/** Остаток долга с учётом привязанных платежей. */
export function debtRemaining(debt, ops) {
  let paid = 0;
  for (const o of ops) {
    if (o.debtId !== debt.id || o.date < debt.asOf) continue;
    paid += o.kind === "expense" ? o.amount : -o.amount;
  }
  return Math.max(0, debt.amount - paid);
}

/**
 * Погашение долгов: каждый месяц начисляются проценты, вносятся минимальные
 * платежи, а всё сверх них идёт в долг с самой высокой ставкой («лавина»),
 * при равных ставках — в самый маленький. Возвращает срок и переплату.
 */
export function payoffPlan(debts, monthlyBudget, maxMonths = 120) {
  const list = debts.filter((d) => d.remaining > 0.5).map((d) => ({
    id: d.id, bal: d.remaining, r: (d.rate || 0) / 100 / 12, min: Math.min(d.minPayment || 0, d.remaining),
    interest: 0, month: null,
  }));
  const minTotal = list.reduce((s, d) => s + d.min, 0);
  const budget = Math.max(monthlyBudget, minTotal);
  let m = 0;
  while (list.some((d) => d.bal > 0.5) && m < maxMonths) {
    m++;
    for (const d of list) if (d.bal > 0.5) { const i = d.bal * d.r; d.bal += i; d.interest += i; }
    let left = budget;
    for (const d of list) if (d.bal > 0.5) { const p = Math.min(d.min || 0, d.bal, left); d.bal -= p; left -= p; }
    const order = list.filter((d) => d.bal > 0.5).sort((a, b) => b.r - a.r || a.bal - b.bal);
    for (const d of order) { if (left <= 0) break; const p = Math.min(d.bal, left); d.bal -= p; left -= p; }
    for (const d of list) if (d.bal <= 0.5 && d.month === null) d.month = m;
  }
  const done = list.every((d) => d.month !== null);
  return {
    budget, minTotal, months: done ? Math.max(0, ...list.map((d) => d.month)) : null,
    totalInterest: list.reduce((s, d) => s + d.interest, 0),
    byDebt: Object.fromEntries(list.map((d) => [d.id, { month: d.month, interest: d.interest }])),
  };
}

/** Когда наступит месяц через n месяцев: «в марте 2027». */
export function monthsFrom(n, today = new Date()) {
  if (n == null) return null;
  const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
  return `в ${MONTHS_PREP[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Главный расчёт.
 * settings: { cushionSaved, cushionMonths (за сколько месяцев собрать), cushionTarget (3 или 6), bufferPct }
 */
export function analyze({ ops, cats, debts = [], settings = {}, today = new Date() }) {
  const catById = new Map(cats.map((c) => [c.id, c]));
  const other = cats.find((c) => c.name === OTHER);
  const catOf = (o) => catById.get(o.categoryId) || other;
  const months = completeMonths(ops, today);
  const n = months.length;

  const per = new Map(); // id категории → { cat, byMonth: {m: сумма расходов} }
  let income = 0, essential = 0, otherExp = 0, debtPay = 0;
  const monthly = Object.fromEntries(months.map((m) => [m, { income: 0, expense: 0, debt: 0 }]));
  for (const o of ops) {
    const m = o.date.slice(0, 7);
    if (!monthly[m]) continue;
    const c = catOf(o);
    const v = contribution(o, c.kind);
    monthly[m].income += v.income; monthly[m].expense += v.expense; monthly[m].debt += v.debt;
    income += v.income; debtPay += v.debt;
    if (c.essential) essential += v.expense; else otherExp += v.expense;
    if (v.expense) {
      const x = per.get(c.id) || { cat: c, byMonth: {} };
      x.byMonth[m] = (x.byMonth[m] || 0) + v.expense;
      per.set(c.id, x);
    }
  }
  const avg = (x) => (n ? x / n : 0);
  const avgIncome = avg(income), avgEssential = avg(essential), avgOther = avg(otherExp), avgDebt = avg(debtPay);
  const avgFree = avgIncome - avgEssential - avgOther - avgDebt;

  // Категории: среднее и последний месяц относительно среднего
  const lastM = months[n - 1];
  const categories = [...per.values()].map(({ cat, byMonth }) => {
    const total = months.reduce((s, m) => s + (byMonth[m] || 0), 0);
    const a = avg(total);
    const last = byMonth[lastM] || 0;
    return { cat, avg: a, last, change: a > 0 ? (last - a) / a : 0 };
  }).filter((x) => x.avg > 0.5).sort((a, b) => b.avg - a.avg);

  // Подушка безопасности
  const saved = +settings.cushionSaved || 0;
  const targetMonthsOfExpenses = +settings.cushionTarget || 3;
  const collectIn = +settings.cushionMonths || 12;
  const target = avgEssential * targetMonthsOfExpenses;
  const cushionLeft = Math.max(0, target - saved);
  let cushionMonthly = cushionLeft / collectIn;
  // Не забираем на подушку больше половины свободного остатка
  const cushionCapped = avgFree > 0 && cushionMonthly > avgFree * 0.5;
  if (cushionCapped) cushionMonthly = avgFree * 0.5;
  if (avgFree <= 0) cushionMonthly = 0;

  // Долги: «безболезненная» сумма = свободный остаток − подушка − небольшой запас
  const bufferPct = settings.bufferPct ?? 0.05;
  const buffer = avgIncome * bufferPct;
  const debtList = debts.map((d) => ({ ...d, remaining: debtRemaining(d, ops) }));
  const totalDebt = debtList.reduce((s, d) => s + d.remaining, 0);
  const debtBudget = Math.max(0, avgFree - cushionMonthly - buffer);
  const plan = payoffPlan(debtList, debtBudget);
  const minOnly = payoffPlan(debtList, 0);

  return {
    months, n,
    avgIncome, avgEssential, avgOther, avgDebt, avgFree, monthly,
    categories,
    cushion: { saved, target, target3: avgEssential * 3, target6: avgEssential * 6, targetMonthsOfExpenses, collectIn, monthly: cushionMonthly, capped: cushionCapped, left: cushionLeft },
    debts: debtList, totalDebt, buffer, debtBudget, plan, minOnly,
  };
}

const rub = (v) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(v)) + " ₽";

/** Сводка для Claude: только итоговые суммы — без описаний операций, номеров карт и имён. */
export function claudeSummary(a, today = new Date()) {
  const L = [];
  const period = a.n ? `${monthName(a.months[0])}–${monthName(a.months[a.n - 1])} ${a.months[a.n - 1].slice(0, 4)}` : "нет полных месяцев";
  L.push("Я веду личный бюджет. Помоги разобраться с финансами: на чём можно сократить траты, сколько и как откладывать на подушку безопасности и как быстрее и безболезненнее закрыть долги. Ниже — сводка из моего приложения (средние за полные месяцы).");
  L.push("");
  L.push(`Период: ${period} (${a.n} мес.)`);
  L.push(`Средний доход в месяц: ${rub(a.avgIncome)}`);
  L.push(`Обязательные траты в месяц: ${rub(a.avgEssential)}`);
  L.push(`Остальные траты в месяц: ${rub(a.avgOther)}`);
  if (a.avgDebt) L.push(`Платежи по долгам в месяц: ${rub(a.avgDebt)}`);
  L.push(`Свободный остаток в месяц: ${rub(a.avgFree)}`);
  L.push("");
  L.push("Траты по категориям (среднее в месяц → последний месяц):");
  for (const c of a.categories) L.push(`- ${c.cat.name}${c.cat.essential ? " (обязательная)" : ""}: ${rub(c.avg)} → ${rub(c.last)}`);
  L.push("");
  L.push("По месяцам (доход / траты / платежи по долгам):");
  for (const m of a.months) { const x = a.monthly[m]; L.push(`- ${monthName(m)} ${m.slice(0, 4)}: ${rub(x.income)} / ${rub(x.expense)} / ${rub(x.debt)}`); }
  L.push("");
  L.push(`Подушка безопасности: накоплено ${rub(a.cushion.saved)}, цель ${a.cushion.targetMonthsOfExpenses} мес. обязательных трат = ${rub(a.cushion.target)}.`);
  if (a.debts.length) {
    L.push("");
    L.push("Долги:");
    let personN = 0;
    a.debts.forEach((d) => {
      const type = d.type === "card" ? "кредитная карта" : d.type === "loan" ? "кредит" : `долг человеку №${++personN}`;
      const parts = [`остаток ${rub(d.remaining)}`];
      if (d.rate) parts.push(`ставка ${String(d.rate).replace(".", ",")}% годовых`);
      if (d.minPayment) parts.push(`минимальный платёж ${rub(d.minPayment)}`);
      if (d.type === "card" && d.limit) parts.push(`лимит ${rub(d.limit)}`);
      L.push(`- ${type}: ${parts.join(", ")}`);
    });
  } else {
    L.push("Долгов нет.");
  }
  L.push("");
  L.push("Учитывай, что это средние значения по выпискам из банка; переводы между своими счетами в них не входят.");
  return L.join("\n");
}
