import { Card, PageHeader } from '../components/ui'

/** Henüz yapılmamış ekranlar için geçici sayfa. */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <p className="text-sm text-slate-500 dark:text-slate-400">Bu ekran çok yakında burada olacak.</p>
      </Card>
    </>
  )
}
