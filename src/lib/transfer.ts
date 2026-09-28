/**
 * JSON içe/dışa aktarma — saf (yan etkisiz) kısım.
 *
 * Biçim: codex_prompt.md bölüm 8. İçe aktarmadan önce dosya burada doğrulanır
 * ve normalleştirilir (geçersiz tarihler ay sonuna çekilir, tutarlar 2 haneye
 * yuvarlanır); veritabanına yazma tek bir RPC (import_data) ile atomik yapılır.
 */
import type { CategoryRow, CategoryType, CycleRow, DebtRow, FixedExpenseRow, IncomeRow, VariableExpenseRow } from './database.types'
import { clampIsoDate } from './date'
import { roundMoney } from './money'

// ---------------------------------------------------------------------------
// Dosya biçimi
// ---------------------------------------------------------------------------

export interface FileCategory {
  key: string
  label: string
  type: CategoryType
  color: string
}

export interface FileDebt {
  name: string
  balance: number
  interest: string | null
  hasInterest: boolean
  dueDate: string | null
  priority: number
  note?: string | null
}

export interface FileIncome {
  date: string
  source: string
  amount: number
  received: boolean
  note?: string | null
}

export interface FileFixed {
  date: string
  item: string
  amount: number
  paid: boolean
  source?: string | null
  note?: string | null
}

export interface FileVariable {
  date: string
  category: string
  description: string
  amount: number
}

export interface FileCycle {
  id: string
  label: string
  start: string
  end: string
  isBaseline: boolean
  income: FileIncome[]
  fixed: FileFixed[]
  variable: FileVariable[]
}

export interface BudgetFile {
  meta: Record<string, unknown>
  categories: FileCategory[]
  debts: FileDebt[]
  cycles: FileCycle[]
}

export class ImportValidationError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Dosyada ${problems.length} sorun var:\n• ${problems.slice(0, 15).join('\n• ')}${problems.length > 15 ? '\n• …' : ''}`)
    this.name = 'ImportValidationError'
  }
}

// ---------------------------------------------------------------------------
// Doğrulama + normalleştirme
// ---------------------------------------------------------------------------

const CATEGORY_TYPES: readonly CategoryType[] = ['zorunlu', 'kisilabilir', 'yari', 'borc']
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const DUE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Alan okuyucu: hataları yol bilgisiyle toplar, geçersiz değerde undefined döner. */
class Reader {
  problems: string[] = []
  warnings: string[] = []

  fail(path: string, msg: string): undefined {
    this.problems.push(`${path}: ${msg}`)
    return undefined
  }

  array(o: Obj, key: string, path: string, required = false): unknown[] {
    const v = o[key]
    if (v === undefined || v === null) {
      if (required) this.fail(`${path}${key}`, 'eksik')
      return []
    }
    if (!Array.isArray(v)) return this.fail(`${path}${key}`, 'liste olmalı') ?? []
    return v
  }

  text(o: Obj, key: string, path: string, opts: { optional?: boolean; fallback?: string } = {}): string | undefined {
    const v = o[key]
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
      if (opts.fallback !== undefined) return opts.fallback
      if (opts.optional) return undefined
      return this.fail(`${path}.${key}`, 'boş olamaz')
    }
    if (typeof v !== 'string') return this.fail(`${path}.${key}`, 'metin olmalı')
    return v.trim()
  }

  amount(o: Obj, key: string, path: string): number | undefined {
    const v = o[key]
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v
    if (typeof n !== 'number' || !Number.isFinite(n)) return this.fail(`${path}.${key}`, 'sayı olmalı')
    if (n < 0) return this.fail(`${path}.${key}`, 'negatif olamaz')
    return roundMoney(n)
  }

  bool(o: Obj, key: string, fallback = false): boolean {
    const v = o[key]
    return typeof v === 'boolean' ? v : fallback
  }

  date(o: Obj, key: string, path: string): string | undefined {
    const v = o[key]
    if (typeof v !== 'string') return this.fail(`${path}.${key}`, 'tarih (YYYY-MM-DD) olmalı')
    try {
      const fixed = clampIsoDate(v)
      if (fixed !== v) this.warnings.push(`${path}.${key}: "${v}" geçersiz, "${fixed}" olarak düzeltildi`)
      return fixed
    } catch {
      return this.fail(`${path}.${key}`, `geçersiz tarih "${v}"`)
    }
  }
}

export interface NormalizeResult {
  data: BudgetFile
  /** Düzeltilen ama reddedilmeyen şeyler (ör. ay sonuna çekilen tarih). */
  warnings: string[]
}

/**
 * Ham JSON'u doğrular ve normalleştirir. Sorun varsa ImportValidationError fırlatır.
 * @param knownCategoryKeys Kullanıcının hesabındaki kategori key'leri; dosyada
 *   tanımlanmamış ama kullanıcıda olan kategoriler de geçerli sayılır.
 */
export function normalizeImport(raw: unknown, knownCategoryKeys: Iterable<string> = []): NormalizeResult {
  const r = new Reader()
  if (!isObj(raw)) throw new ImportValidationError(['Dosya bir JSON nesnesi olmalı'])

  const categories: FileCategory[] = []
  r.array(raw, 'categories', '').forEach((c, i) => {
    const p = `categories[${i}]`
    if (!isObj(c)) return r.fail(p, 'nesne olmalı')
    const key = r.text(c, 'key', p)
    const label = r.text(c, 'label', p, { fallback: key ?? '' })
    const type = c.type as CategoryType
    if (!CATEGORY_TYPES.includes(type)) r.fail(`${p}.type`, `'${CATEGORY_TYPES.join("' | '")}' olmalı`)
    const color = typeof c.color === 'string' && HEX_COLOR.test(c.color) ? c.color : undefined
    if (!color) r.fail(`${p}.color`, '#RRGGBB biçiminde olmalı')
    if (key && label !== undefined && color && CATEGORY_TYPES.includes(type)) categories.push({ key, label, type, color })
  })

  const categoryKeys = new Set([...knownCategoryKeys, ...categories.map((c) => c.key)])

  const debts: FileDebt[] = []
  r.array(raw, 'debts', '').forEach((d, i) => {
    const p = `debts[${i}]`
    if (!isObj(d)) return r.fail(p, 'nesne olmalı')
    const name = r.text(d, 'name', p)
    const balance = r.amount(d, 'balance', p)
    let dueDate: string | null = null
    if (typeof d.dueDate === 'string' && d.dueDate !== '') {
      if (DUE_MONTH.test(d.dueDate)) dueDate = d.dueDate
      else dueDate = r.date(d, 'dueDate', p) ?? null
    }
    const priority = typeof d.priority === 'number' && Number.isInteger(d.priority) ? d.priority : 100
    if (name !== undefined && balance !== undefined) {
      debts.push({
        name,
        balance,
        interest: r.text(d, 'interest', p, { optional: true }) ?? null,
        hasInterest: r.bool(d, 'hasInterest'),
        dueDate,
        priority,
        note: r.text(d, 'note', p, { optional: true }) ?? null,
      })
    }
  })

  const cycles: FileCycle[] = []
  const seenIds = new Set<string>()
  r.array(raw, 'cycles', '').forEach((c, i) => {
    const p = `cycles[${i}]`
    if (!isObj(c)) return r.fail(p, 'nesne olmalı')
    const id = r.text(c, 'id', p)
    if (id && seenIds.has(id)) r.fail(`${p}.id`, `"${id}" birden fazla kez geçiyor`)
    if (id) seenIds.add(id)
    const start = r.date(c, 'start', p)
    const end = r.date(c, 'end', p)
    if (start && end && end < start) r.fail(p, 'bitiş tarihi başlangıçtan önce')

    const income: FileIncome[] = []
    r.array(c, 'income', `${p}.`).forEach((x, j) => {
      const q = `${p}.income[${j}]`
      if (!isObj(x)) return r.fail(q, 'nesne olmalı')
      const date = r.date(x, 'date', q)
      const source = r.text(x, 'source', q)
      const amount = r.amount(x, 'amount', q)
      if (date && source !== undefined && amount !== undefined)
        income.push({ date, source, amount, received: r.bool(x, 'received'), note: r.text(x, 'note', q, { optional: true }) ?? null })
    })

    const fixed: FileFixed[] = []
    r.array(c, 'fixed', `${p}.`).forEach((x, j) => {
      const q = `${p}.fixed[${j}]`
      if (!isObj(x)) return r.fail(q, 'nesne olmalı')
      const date = r.date(x, 'date', q)
      const item = r.text(x, 'item', q)
      const amount = r.amount(x, 'amount', q)
      if (date && item !== undefined && amount !== undefined)
        fixed.push({
          date,
          item,
          amount,
          paid: r.bool(x, 'paid'),
          source: r.text(x, 'source', q, { optional: true }) ?? null,
          note: r.text(x, 'note', q, { optional: true }) ?? null,
        })
    })

    const variable: FileVariable[] = []
    r.array(c, 'variable', `${p}.`).forEach((x, j) => {
      const q = `${p}.variable[${j}]`
      if (!isObj(x)) return r.fail(q, 'nesne olmalı')
      const date = r.date(x, 'date', q)
      const category = r.text(x, 'category', q)
      if (category !== undefined && !categoryKeys.has(category)) r.fail(`${q}.category`, `bilinmeyen kategori "${category}"`)
      const amount = r.amount(x, 'amount', q)
      if (date && category !== undefined && categoryKeys.has(category) && amount !== undefined)
        variable.push({ date, category, description: r.text(x, 'description', q, { fallback: '' }) ?? '', amount })
    })

    if (id && start && end) {
      cycles.push({
        id,
        label: r.text(c, 'label', p, { fallback: id }) ?? id,
        start,
        end,
        isBaseline: r.bool(c, 'isBaseline'),
        income,
        fixed,
        variable,
      })
    }
  })

  if (cycles.filter((c) => c.isBaseline).length > 1) r.problems.push('En fazla bir döngü baz ay (isBaseline) olabilir')

  if (r.problems.length) throw new ImportValidationError(r.problems)
  return {
    data: { meta: isObj(raw.meta) ? raw.meta : {}, categories, debts, cycles },
    warnings: r.warnings,
  }
}

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

export interface ExportRows {
  categories: CategoryRow[]
  debts: DebtRow[]
  cycles: CycleRow[]
  income: IncomeRow[]
  fixed: FixedExpenseRow[]
  variable: VariableExpenseRow[]
}

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date)

/** Veritabanı satırlarından içe aktarılabilir dosya üretir (aynı biçim → yedek geri yüklenebilir). */
export function buildExport(rows: ExportRows, generatedAt: string): BudgetFile {
  const perCycle = <T extends { cycle_id: string; date: string }>(list: T[], cycleId: string) =>
    list.filter((x) => x.cycle_id === cycleId).sort(byDate)

  return {
    meta: { currency: 'EUR', locale: 'de-DE', generatedAt, cycleModel: 'payday-anchored', app: 'Bütçem' },
    categories: [...rows.categories]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ key, label, type, color }) => ({ key, label, type, color })),
    debts: [...rows.debts]
      .sort((a, b) => a.priority - b.priority)
      .map((d) => ({
        name: d.name,
        balance: Number(d.balance),
        interest: d.interest,
        hasInterest: d.has_interest,
        dueDate: d.due_date,
        priority: d.priority,
        note: d.note,
      })),
    cycles: [...rows.cycles]
      .sort((a, b) => a.start_date.localeCompare(b.start_date))
      .map((c) => ({
        id: c.key,
        label: c.label,
        start: c.start_date,
        end: c.end_date,
        isBaseline: c.is_baseline,
        income: perCycle(rows.income, c.id).map((x) => ({
          date: x.date,
          source: x.source,
          amount: Number(x.amount),
          received: x.received,
          note: x.note,
        })),
        fixed: perCycle(rows.fixed, c.id).map((x) => ({
          date: x.date,
          item: x.item,
          amount: Number(x.amount),
          paid: x.paid,
          source: x.source,
          note: x.note,
        })),
        variable: perCycle(rows.variable, c.id).map((x) => ({
          date: x.date,
          category: x.category,
          description: x.description,
          amount: Number(x.amount),
        })),
      })),
  }
}
