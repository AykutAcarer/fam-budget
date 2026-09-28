/** Borçlar ekranının durumu: yükleme, ekle / düzenle / sil. Hesaplar src/lib/debts.ts'te. */
import { useCallback, useEffect, useState } from 'react'
import type { DebtRow } from '../../lib/database.types'
import type { DebtFormValue } from '../../lib/debts'
import { createDebt, deleteDebt, loadDebts, updateDebt } from '../../lib/debtsApi'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function useDebts() {
  const [debts, setDebts] = useState<DebtRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    loadDebts()
      .then(setDebts)
      .catch((e: unknown) => setLoadError(errorText(e)))
  }, [])

  /** Ekler ya da günceller; hata fırlatır (form gösterir). */
  const save = useCallback(async (existing: DebtRow | null, value: DebtFormValue) => {
    const row = existing ? await updateDebt(existing.id, value) : await createDebt(value)
    setDebts((list) => {
      const rest = (list ?? []).filter((d) => d.id !== row.id)
      return [...rest, row]
    })
  }, [])

  const remove = useCallback(async (row: DebtRow) => {
    await deleteDebt(row.id)
    setDebts((list) => (list ?? []).filter((d) => d.id !== row.id))
  }, [])

  return { debts, loadError, save, remove }
}
