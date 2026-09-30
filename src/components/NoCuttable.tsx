/** Hiç kısılabilir kategori seçilmemişken gösterilen nötr mesaj (kıyas 0). */
import { Link } from 'react-router-dom'

export function NoCuttable() {
  return (
    <>
      Kısılabilir kategori seçilmemiş.{' '}
      <Link to="/ayarlar" className="font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
        Ayarlar › Kategoriler
      </Link>
      ’den kıyasa dahil edilecekleri seç.
    </>
  )
}
