/**
 * Gelir ve sabit giderler ekranının durumu: yükleme, ödendi / alındı işaretleme
 * (iyimser), ekle / düzenle / sil. Hesaplar src/lib/fixed.ts ve src/lib/income.ts'te.
 */
import { useCallback, useEffect, useState } from 'react'
import type { FixedExpenseRow, IncomeRow } from '../../lib/database.types'
import { createFixed, deleteFixed, loadFixed, updateFixed, type FixedData, type FixedInput } from '../../lib/fixedApi'
import { withReceived, type IncomeFormValue } from '../../lib/income'
import { createIncome, deleteIncome, updateIncome } from '../../lib/incomeApi'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function useFixed(today: string) {
  const [data, setData] = useState<FixedData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Son işlemin hatası (ör. ödendi işaretlenemedi); kullanıcıya gösterilir. */
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())

  const reload = useCallback(async () => {
    try {
      setData(await loadFixed(today))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorText(e))
    }
  }, [today])

  useEffect(() => {
    void reload()
  }, [reload])

  const replaceItem = (row: FixedExpenseRow) =>
    setData((d) => (d ? { ...d, items: d.items.map((i) => (i.id === row.id ? row : i)) } : d))

  const markPending = (id: string, on: boolean) =>
    setPendingIds((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  /** Ödendi ↔ ödenecek. Ekran hemen güncellenir; yazılamazsa geri alınır. */
  const togglePaid = useCallback(async (row: FixedExpenseRow) => {
    setActionError(null)
    markPending(row.id, true)
    replaceItem({ ...row, paid: !row.paid })
    try {
      replaceItem(await updateFixed(row.id, { paid: !row.paid }))
    } catch (e) {
      replaceItem(row)
      setActionError(`“${row.item}” güncellenemedi: ${errorText(e)}`)
    } finally {
      markPending(row.id, false)
    }
  }, [])

  /** Yeni kalem ekler ya da mevcut kalemi günceller. Hata fırlatır (form gösterir). */
  const save = useCallback(
    async (existing: FixedExpenseRow | null, input: FixedInput) => {
      setActionError(null)
      if (existing) {
        replaceItem(await updateFixed(existing.id, input))
      } else {
        const row = await createFixed(input)
        // İlk kalemde döngü de oluşmuş olabilir; en doğrusu yeniden yüklemek.
        if (!data?.cycle) await reload()
        else setData((d) => (d ? { ...d, items: [...d.items, row] } : d))
      }
    },
    [data?.cycle, reload],
  )

  const remove = useCallback(async (row: FixedExpenseRow) => {
    setActionError(null)
    await deleteFixed(row.id)
    setData((d) => (d ? { ...d, items: d.items.filter((i) => i.id !== row.id) } : d))
  }, [])

  // ---- Gelir -------------------------------------------------------------
  const replaceIncome = (row: IncomeRow) =>
    setData((d) => (d ? { ...d, income: d.income.map((i) => (i.id === row.id ? row : i)) } : d))

  /** Alındı ↔ alınmadı. Ekran hemen güncellenir; yazılamazsa geri alınır. */
  const toggleReceived = useCallback(async (row: IncomeRow) => {
    setActionError(null)
    markPending(row.id, true)
    setData((d) => (d ? { ...d, income: withReceived(d.income, row.id, !row.received) } : d))
    try {
      replaceIncome(await updateIncome(row.id, { received: !row.received }))
    } catch (e) {
      replaceIncome(row)
      setActionError(`“${row.source}” güncellenemedi: ${errorText(e)}`)
    } finally {
      markPending(row.id, false)
    }
  }, [])

  /** Gelir ekler ya da günceller. Hata fırlatır (form gösterir). */
  const saveIncome = useCallback(
    async (existing: IncomeRow | null, value: IncomeFormValue) => {
      setActionError(null)
      if (existing) {
        replaceIncome(await updateIncome(existing.id, value))
      } else {
        const row = await createIncome(value)
        if (!data?.cycle) await reload()
        else setData((d) => (d ? { ...d, income: [...d.income, row] } : d))
      }
    },
    [data?.cycle, reload],
  )

  const removeIncome = useCallback(async (row: IncomeRow) => {
    setActionError(null)
    await deleteIncome(row.id)
    setData((d) => (d ? { ...d, income: d.income.filter((i) => i.id !== row.id) } : d))
  }, [])

  return { data, loadError, actionError, pendingIds, togglePaid, save, remove, toggleReceived, saveIncome, removeIncome }
}
