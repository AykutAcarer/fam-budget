/**
 * chat-expense Edge Function testleri — Anthropic API mock'lanır.
 * Gerçek model davranışı için bkz. chat-expense.live.test.ts (API anahtarı gerekir).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_CATEGORY_KEYS,
  handleRequest,
  isOriginAllowed,
  parseAllowedOrigins,
  TOOL_NAME,
  type ChatResult,
  type HandlerDeps,
  type ParsedExpense,
} from '../functions/chat-expense/handler'
import { SYSTEM_PROMPT } from '../functions/chat-expense/system_prompt'

const TODAY = '2026-09-28'
const CATEGORIES = DEFAULT_CATEGORY_KEYS.map((key) => ({ key, label: key }))

function claudeResponse(input: unknown, stop_reason = 'tool_use') {
  return new Response(
    JSON.stringify({
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      stop_reason,
      content: [{ type: 'tool_use', id: 'toolu_1', name: TOOL_NAME, input }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

function setup(upstream: () => Response | Promise<Response>, overrides: Partial<HandlerDeps> = {}) {
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => upstream())
  const env: Record<string, string> = { ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'test-haiku' }
  const deps: HandlerDeps = {
    env: (n) => env[n],
    fetch: fetchMock as unknown as typeof fetch,
    verifyUser: async (req) => (req.headers.get('Authorization') === 'Bearer valid' ? 'user-1' : null),
    systemPrompt: SYSTEM_PROMPT,
    ...overrides,
  }
  const call = (body: unknown, auth = 'Bearer valid') =>
    handleRequest(
      new Request('http://localhost/chat-expense', {
        method: 'POST',
        headers: { Authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      deps,
    )
  const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
  return { fetchMock, call, sentBody, env }
}

const parseBody = (message: string) => ({ mode: 'parse', message, context: { today: TODAY, categories: CATEGORIES } })

describe('system prompt', () => {
  it('app_system_prompt.md içeriğinin tamamıdır (npm run sync:prompt)', () => {
    const md = readFileSync(join(import.meta.dirname, '..', '..', 'app_system_prompt.md'), 'utf8').replace(/\r\n/g, '\n')
    expect(SYSTEM_PROMPT).toBe(md)
  })
})

describe('Anthropic isteği', () => {
  it('doğru endpoint, başlıklar, model, zorunlu tool ve system prompt', async () => {
    const { call, fetchMock, sentBody } = setup(() => claudeResponse({ expenses: [], reply: 'x', clarify: null }))
    await call(parseBody('8,25 halısaha'))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init?.headers).toEqual({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' })

    const body = sentBody()
    expect(body.model).toBe('test-haiku')
    expect(body.max_tokens).toBe(500)
    expect(body.system).toBe(SYSTEM_PROMPT)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'harcama_kaydet' })
    expect(body.tools).toHaveLength(1)
    const schema = body.tools[0].input_schema
    expect(body.tools[0].strict).toBe(true)
    expect(schema.required).toEqual(['expenses', 'reply', 'clarify'])
    expect(schema.properties.expenses.items.properties.category.enum).toEqual([...DEFAULT_CATEGORY_KEYS])
    expect(body.messages).toEqual([{ role: 'user', content: expect.stringContaining('<mesaj>8,25 halısaha</mesaj>') }])
    expect(body.messages[0].content).toContain('GÖREV 1')
    expect(body.messages[0].content).toContain(`"today":"${TODAY}"`)
  })

  it('kategori enum\'u kullanıcının kategorilerinden üretilir', async () => {
    const { call, sentBody } = setup(() => claudeResponse({ expenses: [], reply: 'x', clarify: null }))
    await call({ mode: 'parse', message: 'x 5', context: { today: TODAY, categories: [{ key: 'sosyal', label: 'S' }, { key: 'spor', label: 'Spor' }] } })
    expect(sentBody().tools[0].input_schema.properties.expenses.items.properties.category.enum).toEqual(['sosyal', 'spor'])
  })

  it('kullanıcının anahtar kelimeleri bağlamda modele gider; bozuk olanlar elenir', async () => {
    const { call, sentBody } = setup(() => claudeResponse({ expenses: [], reply: 'x', clarify: null }))
    await call({
      mode: 'parse',
      message: 'fitness 30',
      context: {
        today: TODAY,
        categories: [
          { key: 'sosyal', label: 'Sosyal', keywords: [] },
          { key: 'spor', label: 'Spor', keywords: ['fitness', 42, ' ', 'yüzme'] },
        ],
      },
    })
    const content: string = sentBody().messages[0].content
    expect(content).toContain('{"key":"spor","label":"Spor","keywords":["fitness","yüzme"]}')
    expect(content).toContain('{"key":"sosyal","label":"Sosyal"}')
    expect(content).toContain('context.categories')
  })

  it('reply modu kıyas rakamlarını bağlamda gönderir', async () => {
    const comparison = { cycleDay: 14, dortluBuAy: 120.5, dortluBazAy: 160.25, fark: -39.75, kategoriBuAy: 16.5, kategoriBazAyTumAy: 33 }
    const { call, sentBody } = setup(() =>
      claudeResponse({ expenses: [{ amount: 1, category: 'is', date: TODAY, description: 'x', needsConfirm: false }], reply: 'Harika 🎯', clarify: 'x' }),
    )
    const res = await call({
      mode: 'reply',
      message: '8,25 halısaha',
      context: { today: TODAY, categories: CATEGORIES, comparison, saved: [{ amount: 8.25, category: 'halisaha', date: TODAY, description: 'halısaha' }] },
    })
    const content: string = sentBody().messages[0].content
    expect(content).toContain('GÖREV 2')
    expect(content).toContain('"fark":-39.75')
    expect(content).toContain('"dortluBazAy":160.25')
    // reply modunda yapay zekanın ürettiği kalemler yok sayılır.
    expect(await res.json()).toEqual({ expenses: [], reply: 'Harika 🎯', clarify: null })
  })
})

describe('çıktı — 10 örnek cümle (mock yapay zeka)', () => {
  const e = (amount: number, category: string, description: string, date = TODAY): ParsedExpense => ({
    amount, category, date, description, needsConfirm: false,
  })
  const cases: [string, ParsedExpense][] = [
    ['8,25 halısaha', e(8.25, 'halisaha', 'halısaha')],
    ['işte öğlen atıştırmalık 3,72', e(3.72, 'is', 'işte öğlen atıştırmalık')],
    ['20 döner', e(20, 'sosyal', 'döner')],
    ['dün 33 yakıt', e(33, 'yakit', 'yakıt', '2026-09-27')],
    ['eşime 30 verdim', e(30, 'hanim', 'eşime verdim')],
    ['eşime döner 9', e(9, 'sosyal', 'eşime döner')],
    ['1,95 hanım kahvaltı', e(1.95, 'kahvalti', 'hanım kahvaltı')],
    ['25 eylülde 15 mutfak', e(15, 'mutfak', 'mutfak', '2026-09-25')],
    ['Rossmann 6,98', e(6.98, 'temizlik', 'Rossmann')],
    ['kredi kartı 210 ödedim', e(210, 'kredi karti', 'kredi kartı ödemesi')],
  ]

  it.each(cases)('"%s"', async (message, expense) => {
    const { call } = setup(() => claudeResponse({ expenses: [expense], reply: 'Kaydettim.', clarify: null }))
    const res = await call(parseBody(message))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ expenses: [expense], reply: 'Kaydettim.', clarify: null } satisfies ChatResult)
  })
})

describe('çıktı temizleme (savunmacı)', () => {
  it('bilinmeyen kategori → sosyal + needsConfirm; bozuk tarih → bugün; geçersiz tutar elenir', async () => {
    const { call } = setup(() =>
      claudeResponse({
        expenses: [
          { amount: 8.254, category: 'uydurma', date: 'dün', description: '  x  ', needsConfirm: false },
          { amount: -5, category: 'is', date: TODAY, description: 'negatif', needsConfirm: false },
          { amount: 'on', category: 'is', date: TODAY, description: 'metin', needsConfirm: false },
        ],
        reply: 'ok',
        clarify: '  ',
      }),
    )
    expect(await (await call(parseBody('x'))).json()).toEqual({
      expenses: [{ amount: 8.25, category: 'sosyal', date: TODAY, description: 'x', needsConfirm: true }],
      reply: 'ok',
      clarify: null,
    })
  })

  it('clarify iletilir', async () => {
    const { call } = setup(() =>
      claudeResponse({
        expenses: [{ amount: 12, category: 'sosyal', date: TODAY, description: 'kahve+simit', needsConfirm: true }],
        reply: '',
        clarify: "Bu 'is' mi 'kahvalti' mı?",
      }),
    )
    const out = await (await call(parseBody('12 kahve simit'))).json()
    expect(out.clarify).toBe("Bu 'is' mi 'kahvalti' mı?")
    expect(out.expenses[0].needsConfirm).toBe(true)
  })
})

describe('hata yolları', () => {
  it('giriş yapmamış kullanıcı 401 alır ve Anthropic çağrılmaz', async () => {
    const { call, fetchMock } = setup(() => claudeResponse({}))
    expect((await call(parseBody('8,25 halısaha'), 'Bearer anon-key')).status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('geçersiz gövde 400', async () => {
    const { call } = setup(() => claudeResponse({}))
    expect((await call({ mode: 'parse', message: '', context: { today: TODAY } })).status).toBe(400)
    expect((await call({ mode: 'x', message: 'a', context: { today: TODAY } })).status).toBe(400)
    expect((await call({ mode: 'parse', message: 'a'.repeat(501), context: { today: TODAY } })).status).toBe(400)
    expect((await call({ mode: 'parse', message: 'a', context: { today: '28.09.2026' } })).status).toBe(400)
  })

  it('secret eksikse 500 not_configured', async () => {
    const { call, env, fetchMock } = setup(() => claudeResponse({}))
    delete env.ANTHROPIC_MODEL
    const res = await call(parseBody('8,25 halısaha'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Anthropic hatası 502 olur, hata gövdesi istemciye sızmaz', async () => {
    const { call } = setup(() => new Response('{"error":{"message":"secret detail"}}', { status: 529 }))
    const res = await call(parseBody('8,25 halısaha'))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'upstream_error', status: 529 })
  })

  it('ağ hatası 502', async () => {
    const { call } = setup(() => {
      throw new TypeError('fetch failed')
    })
    expect((await call(parseBody('8,25 halısaha'))).status).toBe(502)
  })

  it('refusal / max_tokens / tool_use yok → 502', async () => {
    for (const stop of ['refusal', 'max_tokens']) {
      const { call } = setup(() => claudeResponse({}, stop))
      expect((await call(parseBody('x 1'))).status).toBe(502)
    }
    const { call } = setup(() => new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }] })))
    expect((await call(parseBody('x 1'))).status).toBe(502)
  })

  it('CORS ön isteği', async () => {
    const verifyUser = vi.fn(async () => null)
    const res = await handleRequest(new Request('http://localhost/chat-expense', { method: 'OPTIONS' }), {
      env: () => undefined,
      fetch,
      verifyUser,
      systemPrompt: '',
    })
    expect(verifyUser).not.toHaveBeenCalled()
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
  })
})

describe('CORS', () => {
  const PROD = 'https://butcem.vercel.app'
  const request = (method: string, origin?: string) =>
    new Request('http://localhost/chat-expense', {
      method,
      headers: { Authorization: 'Bearer valid', 'content-type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: method === 'POST' ? JSON.stringify(parseBody('8,25 halısaha')) : undefined,
    })

  function deps(allowedOrigins?: string) {
    const fetchMock = vi.fn(async () => claudeResponse({ expenses: [], reply: 'ok', clarify: null }))
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'm', ALLOWED_ORIGINS: allowedOrigins }
    const d: HandlerDeps = {
      env: (n) => env[n],
      fetch: fetchMock as unknown as typeof fetch,
      verifyUser: async () => 'user-1',
      systemPrompt: '',
    }
    return { d, fetchMock }
  }

  it('parseAllowedOrigins: virgül/boşluk, sondaki / temizlenir; boşsa yerel varsayılanlar', () => {
    expect(parseAllowedOrigins(`${PROD}/, http://localhost:5173`)).toEqual([PROD, 'http://localhost:5173'])
    expect(parseAllowedOrigins(undefined)).toEqual(DEFAULT_ALLOWED_ORIGINS)
    expect(parseAllowedOrigins('  ')).toEqual(DEFAULT_ALLOWED_ORIGINS)
  })

  it('isOriginAllowed: tam eşleşme ve alt alan jokeri', () => {
    const list = [PROD, 'https://fam-budget-*.vercel.app']
    expect(isOriginAllowed(PROD, list)).toBe(true)
    expect(isOriginAllowed('https://fam-budget-git-main-aykut.vercel.app', list)).toBe(true)
    expect(isOriginAllowed('https://evil.vercel.app', list)).toBe(false)
    expect(isOriginAllowed('https://fam-budget-x.vercel.app.evil.com', list)).toBe(false)
    expect(isOriginAllowed('https://butcem.vercel.app.evil.com', list)).toBe(false)
    expect(isOriginAllowed(null, list)).toBe(false)
  })

  it('izinli origin: ön istek 204 + origin yansıtılır; gerçek yanıtta da ACAO var', async () => {
    const { d } = deps(PROD)
    const pre = await handleRequest(request('OPTIONS', PROD), d)
    expect(pre.status).toBe(204)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe(PROD)
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('content-type')
    expect(pre.headers.get('Vary')).toBe('Origin')
    const res = await handleRequest(request('POST', PROD), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PROD)
  })

  it('izinsiz origin: 403, ACAO yok, Anthropic çağrılmaz', async () => {
    const { d, fetchMock } = deps(PROD)
    const pre = await handleRequest(request('OPTIONS', 'https://evil.example'), d)
    expect(pre.status).toBe(403)
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBeNull()
    const res = await handleRequest(request('POST', 'https://evil.example'), d)
    expect(res.status).toBe(403)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("secret yoksa yalnız yerel geliştirme origin'leri", async () => {
    const { d } = deps(undefined)
    expect((await handleRequest(request('OPTIONS', 'http://localhost:5173'), d)).status).toBe(204)
    expect((await handleRequest(request('OPTIONS', PROD), d)).status).toBe(403)
  })

  it("origin'siz istek (sunucu/curl) CORS'a takılmaz ama JWT ister", async () => {
    const { d } = deps(PROD)
    expect((await handleRequest(request('POST'), d)).status).toBe(200)
    const noAuth = { ...d, verifyUser: async () => null }
    expect((await handleRequest(request('POST'), noAuth)).status).toBe(401)
  })
})

describe('reply modu — tekrar bilgisi', () => {
  const repeat = { category: 'kahvalti', gunSayisi: 5, pencereGun: 7, kategoriToplam: 18.4, hatirlat: true }
  const body = (r: unknown) => ({
    mode: 'reply',
    message: '2,5 simit',
    context: { today: TODAY, categories: CATEGORIES, comparison: null, saved: [], repeat: r },
  })

  it('geçerli repeat bağlamda gider; tekrar talimatı gönderilir', async () => {
    const { call, sentBody } = setup(() => claudeResponse({ expenses: [], reply: 'ok', clarify: null }))
    await call(body(repeat))
    const content: string = sentBody().messages[0].content
    expect(content).toContain('"repeat":{"category":"kahvalti","gunSayisi":5,"pencereGun":7,"kategoriToplam":18.4,"hatirlat":true}')
    expect(content).toContain('context.repeat.hatirlat true ise')
  })

  it('bozuk repeat yok sayılır (null)', async () => {
    const { call, sentBody } = setup(() => claudeResponse({ expenses: [], reply: 'ok', clarify: null }))
    await call(body({ ...repeat, hatirlat: 'evet' }))
    expect(sentBody().messages[0].content).toContain('"repeat":null')
  })

  it('parse modunda repeat bağlama eklenmez', async () => {
    const { call, sentBody } = setup(() => claudeResponse({ expenses: [], reply: 'ok', clarify: null }))
    await call({ mode: 'parse', message: 'x 1', context: { today: TODAY, categories: CATEGORIES, repeat } })
    expect(sentBody().messages[0].content).not.toContain('"repeat"')
  })
})
