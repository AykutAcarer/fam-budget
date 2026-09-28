/**
 * chat-expense — GERÇEK Claude API ile uçtan uca test (isteğe bağlı, ücretli).
 *
 * Yalnızca ANTHROPIC_API_KEY ortam değişkeni tanımlıysa çalışır; aksi halde atlanır.
 * Anahtarı dosyaya yazmayın, yalnızca komut satırında verin:
 *   PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; $env:ANTHROPIC_MODEL="claude-haiku-4-5"; npm run test:ai
 *   bash:       ANTHROPIC_API_KEY=sk-ant-... ANTHROPIC_MODEL=claude-haiku-4-5 npm run test:ai
 * Maliyet: 10 küçük Haiku çağrısı (~1 sent).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORY_KEYS, handleRequest } from '../functions/chat-expense/handler'
import { SYSTEM_PROMPT } from '../functions/chat-expense/system_prompt'

const apiKey = process.env.ANTHROPIC_API_KEY
const model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-4-5'
const TODAY = '2026-09-28'

async function parse(message: string) {
  const res = await handleRequest(
    new Request('http://localhost/chat-expense', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'parse',
        message,
        context: { today: TODAY, categories: DEFAULT_CATEGORY_KEYS.map((key) => ({ key, label: key })) },
      }),
    }),
    {
      env: (n) => ({ ANTHROPIC_API_KEY: apiKey, ANTHROPIC_MODEL: model })[n],
      fetch,
      verifyUser: async () => 'live-test',
      systemPrompt: SYSTEM_PROMPT,
    },
  )
  expect(res.status).toBe(200)
  return res.json()
}

describe.skipIf(!apiKey)(`chat-expense canlı (${model})`, () => {
  it.each([
    ['8,25 halısaha', 8.25, 'halisaha', TODAY],
    ['işte öğlen atıştırmalık 3,72', 3.72, 'is', TODAY],
    ['20 döner', 20, 'sosyal', TODAY],
    ['dün 33 yakıt', 33, 'yakit', '2026-09-27'],
    ['eşime 30 verdim', 30, 'hanim', TODAY],
    ['eşime döner 9', 9, 'sosyal', TODAY],
    ['1,95 hanım kahvaltı', 1.95, 'kahvalti', TODAY],
    ['25 eylülde 15 mutfak', 15, 'mutfak', '2026-09-25'],
    ['Rossmann 6,98', 6.98, 'temizlik', TODAY],
    ['kredi kartı 210 ödedim', 210, 'kredi karti', TODAY],
  ])('"%s" → %s € %s', async (message, amount, category, date) => {
    const out = await parse(message)
    expect(out.expenses).toHaveLength(1)
    expect(out.expenses[0]).toMatchObject({ amount, category, date })
  }, 30_000)
})
