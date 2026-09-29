/** Borçlar ekranının durumu: yükleme, ekle / düzenle / sil, ödemeler. Hesaplar src/lib/debts.ts ve debtPayments.ts'te. */
import { useCallback, useEffect, useState } from 'react'
import type { DebtPaymentRow, DebtRow } from '../../lib/database.types'
import type { PaymentFormValue } from '../../lib/debtPayments'
import { addPayment, deletePayment, loadPayments, updatePayment } from '../../lib/debtPaymentsApi'
import type { DebtFormValue } from '../../lib/debts'
import { createDebt, deleteDebt, loadDebts, updateDebt } from '../../lib/debtsApi'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function useDebts() {
  const [debts, setDebts] = useState<DebtRow[] | null>(null)
  const [payments, setPayments] = useState<DebtPaymentRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([loadDebts(), loadPayments()])
      .then(([d, p]) => {
        setDebts(d)
        setPayments(p)
      })
      .catch((e: unknown) => setLoadError(errorText(e)))
  }, [])

  const putDebt = (row: DebtRow) =>
    setDebts((list) => {
      const rest = (list ?? []).filter((d) => d.id !== row.id)
      return [...rest, row]
    })

  /** Ekler ya da günceller; hata fırlatır (form gösterir). */
  const save = useCallback(async (existing: DebtRow | null, value: DebtFormValue) => {
    putDebt(existing ? await updateDebt(existing.id, value) : await createDebt(value))
  }, [])

  const remove = useCallback(async (row: DebtRow) => {
    await deleteDebt(row.id)
    setDebts((list) => (list ?? []).filter((d) => d.id !== row.id))
    setPayments((list) => list.filter((p) => p.debt_id !== row.id))
  }, [])

  /** Ödeme ekler / düzenler; bakiye veritabanında aynı işlemde güncellenir. */
  const savePayment = useCallback(async (debtId: string, existing: DebtPaymentRow | null, value: PaymentFormValue) => {
    const { payment, debt } = existing ? await updatePayment(existing, value) : await addPayment(debtId, value)
    setPayments((list) => [...list.filter((p) => p.id !== payment.id), payment])
    putDebt(debt)
  }, [])

  const removePayment = useCallback(async (row: DebtPaymentRow) => {
    const debt = await deletePayment(row)
    setPayments((list) => list.filter((p) => p.id !== row.id))
    putDebt(debt)
  }, [])

  return { debts, payments, loadError, save, remove, savePayment, removePayment }
}
