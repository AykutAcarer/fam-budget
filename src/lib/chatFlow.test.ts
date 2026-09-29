import { describe, expect, it, vi } from 'vitest'
import type { ChatContext, ChatResult } from '../../supabase/functions/chat-expense/handler'
import type { BudgetData } from './budget'
import { interpret, saveAndRespond, type FlowDeps, type FlowEnv } from './chatFlow'
import type { CycleRow, VariableExpenseRow } from './database.types'
import type { NewExpense } from './outbox'

const TODAY = '2026-09-17' // aktif döngünün 3. günü

const cycle = (id: string, start: string, end: string, is_baseline = false): CycleRow => ({
  id, user_id: 'u', key: start.slice(0, 7), label: id, start_date: start, end_date: end, is_baseline, created_at: '',
})
const expense = (cycle_id: string, date: string, category: string, amount: number): VariableExpenseRow => ({
  id: `${cycle_id}-${date}-${category}`, user_id: 'u', cycle_id, date, category, description: '', amount, created_at: '',
})

// Baz ay 3. güne kadar dörtlü: 4.45 + 6.89 + 8.25 = 19.59
const baselineVariable = [
  expense('b', '2026-08-15', 'kahvalti', 4.45),
  expense('b', '2026-08-16', 'is', 6.89),
  expense('b', '2026-08-17', 'halisaha', 8.25),
  expense('b', '2026-08-17', 'mutfak', 40),
]

function budget(activeVariable: VariableExpenseRow[] = []): BudgetData {
  return {
    categories: [],
    active: {
      cycle: cycle('a', '2026-09-15', '2026-10-14'),
      window: { label: 'x', start: '2026-09-15', end: '2026-10-14' },
      income: [],
      fixed: [],
      variable: activeVariable,
    },
    baseline: { cycle: cycle('b', '2026-08-15', '2026-09-14', true), variable: baselineVariable },
  }
}

const context: ChatContext = {
  today: TODAY,
  categories: ['mutfak', 'yakit', 'kahvalti', 'is', 'halisaha', 'sosyal', 'hanim'].map((key) => ({ key, label: key })),
}
const labels = new Map([['halisaha', 'Halı saha'], ['sosyal', 'Sosyal / diğer'], ['yakit', 'Yakıt']])
const env = (data: BudgetData | null = budget()): FlowEnv => ({ today: TODAY, context, labels, data })

function makeDeps(over: Partial<FlowDeps> = {}) {
  let n = 0
  let stored: VariableExpenseRow[] = []
  const base = {
    parseWithAI: vi.fn<FlowDeps['parseWithAI']>(async () => ({ expenses: [], reply: '', clarify: null })),
    replyWithAI: vi.fn<FlowDeps['replyWithAI']>(async () => 'Harika!'),
    saveExpenses: vi.fn<FlowDeps['saveExpenses']>(async (items) => {
      stored = [...stored, ...items.map((i) => ({ ...i, user_id: 'u', cycle_id: 'a', created_at: '' }))]
      return { queued: false }
    }),
    reload: vi.fn<FlowDeps['reload']>(async () => budget(stored)),
    pendingOutbox: vi.fn<FlowDeps['pendingOutbox']>(() => []),
    newId: () => `id-${++n}`,
  }
  // Testlerde .mock'a erişilen fonksiyonlar her zaman vi.fn ile verilir.
  return { ...base, ...over } as typeof base
}

const ai = (r: Partial<ChatResult>): FlowDeps['parseWithAI'] => async () => ({ expenses: [], reply: '', clarify: null, ...r })
const halisaha = { amount: 8.25, category: 'halisaha', date: TODAY, description: 'halısaha', needsConfirm: false }

describe('interpret', () => {
  it('yapay zeka net sonuç verirse kaydetme adımı', async () => {
    const deps = makeDeps({ parseWithAI: vi.fn(ai({ expenses: [halisaha] })) })
    const step = await interpret('8,25 halısaha', env(), deps)
    expect(step).toEqual({
      kind: 'save',
      source: 'ai',
      unmatched: false,
      items: [{ id: 'id-1', amount: 8.25, category: 'halisaha', date: TODAY, description: 'halısaha' }],
    })
    expect(deps.parseWithAI).toHaveBeenCalledWith('8,25 halısaha', context)
  })

  it('clarify veya needsConfirm → onay adımı', async () => {
    const deps = makeDeps({
      parseWithAI: ai({ expenses: [{ ...halisaha, category: 'sosyal', needsConfirm: true }], clarify: "Bu 'is' mi 'sosyal' mı?" }),
    })
    const step = await interpret('12 bir şey', env(), deps)
    expect(step.kind).toBe('confirm')
    if (step.kind === 'confirm') expect(step.pending.question).toBe("Bu 'is' mi 'sosyal' mı?")
  })

  it('harcama yoksa yapay zekanın cevabı mesaj olarak döner', async () => {
    const deps = makeDeps({ parseWithAI: ai({ reply: 'Tutarı da yazar mısın?' }) })
    expect(await interpret('merhaba', env(), deps)).toEqual({ kind: 'message', text: 'Tutarı da yazar mısın?' })
  })

  it('yapay zekaya ulaşılamazsa kural tabanlı yedek devreye girer', async () => {
    const deps = makeDeps({ parseWithAI: async () => Promise.reject(new Error('offline')) })
    expect(await interpret('dün 33 yakıt', env(), deps)).toEqual({
      kind: 'save',
      source: 'fallback',
      unmatched: false,
      items: [{ id: 'id-1', amount: 33, category: 'yakit', date: '2026-09-16', description: 'yakıt' }],
    })
  })

  it('yedek parser tanımadığı kategoriyi "sosyal" yapar ve işaretler', async () => {
    const deps = makeDeps({ parseWithAI: async () => Promise.reject(new Error('offline')) })
    const step = await interpret('12 hediye', env(), deps)
    expect(step).toMatchObject({ kind: 'save', unmatched: true, items: [{ category: 'sosyal' }] })
  })

  it('yedek parser tutar bulamazsa kullanıcıya örnek verir', async () => {
    const deps = makeDeps({ parseWithAI: async () => Promise.reject(new Error('offline')) })
    expect(await interpret('halısaha', env(), deps)).toMatchObject({ kind: 'message' })
  })
})

describe('saveAndRespond', () => {
  const items: NewExpense[] = [{ id: 'id-1', amount: 8.25, category: 'halisaha', date: TODAY, description: 'halısaha' }]

  it('kaydeder, kıyası kodla hesaplar ve yapay zekaya hazır rakamları verir', async () => {
    const deps = makeDeps({ replyWithAI: vi.fn(async () => 'Halı saha 8,25 € kaydettim. Baz ayın 11,34 € altındasın 🎯') })
    const reply = await saveAndRespond('8,25 halısaha', items, 'ai', false, env(), deps)

    expect(deps.saveExpenses).toHaveBeenCalledWith(items)
    // Bu ay 3. güne kadar dörtlü 8.25; baz ay 19.59 → fark −11.34
    const [, , comparison, saved] = deps.replyWithAI.mock.calls[0]
    expect(comparison).toEqual({
      cycleDay: 3,
      dortluBuAy: 8.25,
      dortluBazAy: 19.59,
      fark: -11.34,
      kategori: { key: 'halisaha', buAy: 8.25, bazAyTumAy: 8.25 },
    })
    expect(saved).toEqual([{ amount: 8.25, category: 'halisaha', date: TODAY, description: 'halısaha' }])
    expect(reply).toEqual({ text: 'Halı saha 8,25 € kaydettim. Baz ayın 11,34 € altındasın 🎯', author: 'ai', queued: false, items })
  })

  it('yapay zeka uydurma rakam yazarsa kodla üretilen özet gösterilir', async () => {
    const deps = makeDeps({ replyWithAI: async () => 'Baz ayın 50,00 € altındasın!' })
    const reply = await saveAndRespond('8,25 halısaha', items, 'ai', false, env(), deps)
    expect(reply.author).toBe('kod')
    expect(reply.text.replace(/ /g, ' ')).toBe('Halı saha 8,25 € kaydedildi. Kısılabilir harcamalarda baz ayın 11,34 € altındasın 🎯')
  })

  it('cevap çağrısı başarısızsa da kayıt kaybolmaz, özet gösterilir', async () => {
    const deps = makeDeps({ replyWithAI: async () => Promise.reject(new Error('502')) })
    const reply = await saveAndRespond('8,25 halısaha', items, 'ai', false, env(), deps)
    expect(deps.saveExpenses).toHaveBeenCalledOnce()
    expect(reply.author).toBe('kod')
  })

  it('yedek parser kaynağında yapay zeka cevabı istenmez', async () => {
    const deps = makeDeps()
    await saveAndRespond('8,25 halısaha', items, 'fallback', false, env(), deps)
    expect(deps.replyWithAI).not.toHaveBeenCalled()
  })

  it('çevrimdışı: kuyruğa alınır, kıyas bekleyen kalemlerle hesaplanır, yeniden yükleme yapılmaz', async () => {
    const deps = makeDeps({
      saveExpenses: async () => ({ queued: true }),
      pendingOutbox: () => items,
    })
    const reply = await saveAndRespond('8,25 halısaha', items, 'ai', false, env(), deps)
    expect(deps.reload).not.toHaveBeenCalled()
    expect(deps.replyWithAI).not.toHaveBeenCalled()
    expect(reply.queued).toBe(true)
    expect(reply.text).toContain('internet gelince')
    expect(reply.text.replace(/ /g, ' ')).toContain('baz ayın 11,34 € altındasın')
  })

  it('kayıt veri hatasıyla başarısızsa hata yukarı iletilir', async () => {
    const deps = makeDeps({ saveExpenses: async () => Promise.reject(new Error('foreign key')) })
    await expect(saveAndRespond('x', items, 'ai', false, env(), deps)).rejects.toThrow('foreign key')
  })

  it('baz ay yoksa kıyas null gönderilir', async () => {
    const data = budget()
    data.baseline = null
    const deps = makeDeps({ reload: async () => data })
    await saveAndRespond('8,25 halısaha', items, 'ai', false, env(data), deps)
    expect(deps.replyWithAI.mock.calls[0][2]).toBeNull()
  })
})

describe('saveAndRespond — tekrar hatırlatması', () => {
  const kahvalti = (date: string) => ({ ...expense('a', date, 'kahvalti', 3), id: `k-${date}` })
  const withTypes = (variable: VariableExpenseRow[]): BudgetData => ({
    ...budget(variable),
    categories: [
      { id: '1', user_id: 'u', key: 'kahvalti', label: 'Kahvaltı', type: 'kisilabilir', color: '#B78C11', sort_order: 4, keywords: [], created_at: '' },
      { id: '2', user_id: 'u', key: 'mutfak', label: 'Mutfak', type: 'zorunlu', color: '#22A06B', sort_order: 1, keywords: [], created_at: '' },
    ],
  })
  // Bugün 18 Eyl (döngünün 4. günü): 15, 16, 17 Eyl'deki kahvaltılar + bugün kaydedilen → 4 farklı gün.
  const TODAY4 = '2026-09-18'
  const env4 = (data: BudgetData): FlowEnv => ({ today: TODAY4, context, labels, data })

  it('kısılabilir kategoride 4. gün → hatirlat=true, sayılar yapay zekaya gider ve cevapta kullanılabilir', async () => {
    const existing = ['2026-09-15', '2026-09-16', '2026-09-17'].map(kahvalti)
    const saved: NewExpense = { id: 'new', amount: 2.5, category: 'kahvalti', date: TODAY4, description: 'simit' }
    const deps = makeDeps({
      reload: vi.fn(async () => withTypes([...existing, { ...saved, user_id: 'u', cycle_id: 'a', created_at: '' }])),
      replyWithAI: vi.fn(async () => 'Kahvaltı 2,50 € kaydettim. Bu hafta 4. gün kahvaltı dışarıda, toplam 11,50 € — evden getirmek dörtlüyü rahatlatır 🙂'),
    })
    const reply = await saveAndRespond('2,5 simit', [saved], 'ai', false, env4(withTypes(existing)), deps)
    const repeat = deps.replyWithAI.mock.calls[0][4]
    expect(repeat).toEqual({ category: 'kahvalti', gunSayisi: 4, pencereGun: 7, kategoriToplam: 11.5, hatirlat: true })
    expect(reply.author).toBe('ai') // 4 ve 11,50 verilen sayılar → kabul
  })

  it('3. gün → hatirlat=false', async () => {
    const existing = ['2026-09-16', '2026-09-17'].map(kahvalti)
    const saved: NewExpense = { id: 'new', amount: 2.5, category: 'kahvalti', date: TODAY4, description: 'simit' }
    const deps = makeDeps({ reload: vi.fn(async () => withTypes([...existing, { ...saved, user_id: 'u', cycle_id: 'a', created_at: '' }])) })
    await saveAndRespond('2,5 simit', [saved], 'ai', false, env4(withTypes(existing)), deps)
    expect(deps.replyWithAI.mock.calls[0][4]).toMatchObject({ gunSayisi: 3, hatirlat: false })
  })

  it('zorunlu kategoride her gün olsa da hatirlat=false', async () => {
    const existing = ['2026-09-15', '2026-09-16', '2026-09-17'].map((d) => ({ ...expense('a', d, 'mutfak', 20), id: `m-${d}` }))
    const saved: NewExpense = { id: 'new', amount: 20, category: 'mutfak', date: TODAY4, description: 'market' }
    const deps = makeDeps({ reload: vi.fn(async () => withTypes([...existing, { ...saved, user_id: 'u', cycle_id: 'a', created_at: '' }])) })
    await saveAndRespond('20 market', [saved], 'ai', false, env4(withTypes(existing)), deps)
    expect(deps.replyWithAI.mock.calls[0][4]).toMatchObject({ gunSayisi: 4, hatirlat: false })
  })

  it('yapay zeka tekrar cümlesinde uydurma toplam yazarsa kodla yazılmış özet gösterilir', async () => {
    const existing = ['2026-09-15', '2026-09-16', '2026-09-17'].map(kahvalti)
    const saved: NewExpense = { id: 'new', amount: 2.5, category: 'kahvalti', date: TODAY4, description: 'simit' }
    const deps = makeDeps({
      reload: vi.fn(async () => withTypes([...existing, { ...saved, user_id: 'u', cycle_id: 'a', created_at: '' }])),
      replyWithAI: vi.fn(async () => 'Kaydettim. Bu hafta kahvaltıya 40,00 € gitti.'),
    })
    const reply = await saveAndRespond('2,5 simit', [saved], 'ai', false, env4(withTypes(existing)), deps)
    expect(reply.author).toBe('kod')
  })
})
