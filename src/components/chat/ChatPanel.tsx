/**
 * WhatsApp benzeri sohbet akışı + altta sabit giriş kutusu.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { formatEur } from '../../lib/format'
import { SendIcon } from '../icons'
import { Card, CardTitle } from '../ui'
import type { ChatMessage, PendingConfirm, useChat } from './useChat'

type Chat = ReturnType<typeof useChat>

const time = (at: number) => new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })

function CategoryDot({ color }: { color?: string }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full ring-1 ring-slate-900/15 dark:ring-white/20"
      style={{ backgroundColor: color ?? '#D9D2E9' }}
      aria-hidden="true"
    />
  )
}

function BotBubble({
  msg,
  labels,
  colors,
  onUndo,
}: {
  msg: Extract<ChatMessage, { role: 'bot' }>
  labels: ReadonlyMap<string, string>
  colors: ReadonlyMap<string, string>
  onUndo: () => void
}) {
  const tone =
    msg.tone === 'error'
      ? 'bg-red-50 text-red-900 dark:bg-red-950/60 dark:text-red-100'
      : 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
  const allUndone = msg.expenses?.every((e) => e.undone)
  return (
    <div className="flex">
      <div className={`max-w-[85%] rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm ${tone}`}>
        {msg.expenses && msg.expenses.length > 0 && (
          <ul className="mb-1.5 space-y-1">
            {msg.expenses.map((e) => (
              <li key={e.id} className={`flex items-center gap-2 ${e.undone ? 'line-through opacity-60' : ''}`}>
                <CategoryDot color={colors.get(e.category)} />
                <span className="font-medium">{labels.get(e.category) ?? e.category}</span>
                <span className="ml-auto pl-2 font-semibold tabular-nums">{formatEur(e.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="whitespace-pre-line">{msg.text}</p>
        <div className="mt-1 flex items-center justify-end gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          {msg.queued && <span title="Bağlantı gelince gönderilecek">⏳ cihazda bekliyor</span>}
          {msg.expenses?.length ? (
            allUndone ? (
              <span>geri alındı</span>
            ) : (
              <button type="button" onClick={onUndo} className="font-semibold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300">
                Geri al
              </button>
            )
          ) : null}
          <span>{time(msg.at)}</span>
        </div>
      </div>
    </div>
  )
}

function ConfirmCard({
  pending,
  categories,
  colors,
  onConfirm,
  onCancel,
}: {
  pending: PendingConfirm
  categories: { key: string; label: string }[]
  colors: ReadonlyMap<string, string>
  onConfirm: (choice: Record<string, string>) => void
  onCancel: () => void
}) {
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(pending.expenses.map((e) => [e.id, e.category])),
  )
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-sm dark:border-amber-500/40 dark:bg-amber-950/40">
      <p className="font-medium text-amber-950 dark:text-amber-100">{pending.question}</p>
      {pending.expenses.map((e) => (
        <fieldset key={e.id} className="mt-3">
          <legend className="text-slate-700 dark:text-slate-200">
            <span className="font-semibold tabular-nums">{formatEur(e.amount)}</span> · {e.description}
          </legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const selected = choice[e.id] === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setChoice((s) => ({ ...s, [e.id]: c.key }))}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${
                    selected
                      ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white'
                      : 'bg-white text-slate-700 ring-slate-900/10 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/10'
                  }`}
                >
                  <CategoryDot color={colors.get(c.key)} />
                  {c.label}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onConfirm(choice)}
          className="flex-1 rounded-xl bg-emerald-600 py-2.5 font-semibold text-white hover:bg-emerald-700"
        >
          Kaydet
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-4 py-2.5 font-semibold text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-slate-900/60"
        >
          Vazgeç
        </button>
      </div>
    </div>
  )
}

export function ChatPanel({ chat, colors }: { chat: Chat; colors: ReadonlyMap<string, string> }) {
  const [input, setInput] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const { messages, pending, busy, outbox, labels, categories } = chat
  const visible = messages.slice(-30)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, pending, busy])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    void chat.send(input)
    setInput('')
  }

  return (
    <>
      <Card>
        <CardTitle>Sohbet</CardTitle>
        <div className="mt-3 space-y-2.5" aria-live="polite">
          {visible.length === 0 && (
            <div className="flex">
              <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-2.5 text-sm dark:bg-slate-800">
                Merhaba! Harcamanı buraya yazman yeterli, ör. <b>“8,25 halısaha”</b> ya da{' '}
                <b>“işte öğlen atıştırmalık 3,72”</b>. Gerisini ben hallederim. 💪
              </p>
            </div>
          )}
          {visible.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-tr-md bg-emerald-600 px-3.5 py-2 text-sm text-white">
                  {m.text}
                  <span className="ml-2 align-bottom text-[11px] text-emerald-100">{time(m.at)}</span>
                </p>
              </div>
            ) : (
              <BotBubble key={m.id} msg={m} labels={labels} colors={colors} onUndo={() => void chat.undo(m.id)} />
            ),
          )}
          {pending && (
            <ConfirmCard
              key={pending.text}
              pending={pending}
              categories={categories}
              colors={colors}
              onConfirm={(c) => void chat.confirm(c)}
              onCancel={chat.cancel}
            />
          )}
          {busy && (
            <div className="flex" role="status" aria-label="Yazıyor">
              <span className="flex gap-1 rounded-2xl rounded-tl-md bg-slate-100 px-4 py-3 dark:bg-slate-800">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="size-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
                ))}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </Card>

      {/* Sabit sohbet kutusunun kapladığı alan kadar boşluk */}
      <div className="h-16" aria-hidden="true" />

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
      >
        {outbox.length > 0 && (
          <p className="mx-auto mb-1.5 max-w-2xl text-xs text-amber-700 dark:text-amber-300">
            ⏳ {outbox.length} harcama cihazda bekliyor; bağlantı gelince gönderilecek.
          </p>
        )}
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={!!pending}
            enterKeyHint="send"
            autoComplete="off"
            maxLength={500}
            aria-label="Harcama yaz"
            placeholder={pending ? 'Önce yukarıdaki soruyu yanıtla' : 'ör. 8,25 halısaha'}
            className="h-12 flex-1 rounded-full border-0 bg-white px-4 text-base shadow-sm ring-1 ring-slate-900/10 placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:opacity-60 dark:bg-slate-900 dark:ring-white/10"
          />
          <button
            type="submit"
            disabled={busy || !!pending || !input.trim()}
            aria-label="Gönder"
            className="flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
          >
            <SendIcon className="size-5" />
          </button>
        </div>
      </form>
    </>
  )
}
