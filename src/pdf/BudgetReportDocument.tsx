/**
 * PDF raporu (react-pdf). Yalnız çizer: tüm sayılar buildReport'tan
 * (src/lib/report.ts → uygulamanın seçicileri) gelir, burada hesap yapılmaz.
 * Grafikler aynı veriden react-pdf SVG'siyle yeniden çizilir; emoji yok.
 */
import { Circle, Document, G, Page, Path, Rect, StyleSheet, Svg, Text, View } from '@react-pdf/renderer'
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import type { ReactNode } from 'react'
import { formatEur, formatShare, formatSignedEur } from '../lib/format'
import { DEBTS_UNAVAILABLE_NOTE, type BudgetReport } from '../lib/report'
import { PDF_FONT } from './fonts'
import { PDF_COLORS as C } from './theme'

const s = StyleSheet.create({
  page: { fontFamily: PDF_FONT, fontSize: 9.5, color: C.text, paddingTop: 34, paddingBottom: 48, paddingHorizontal: 36, backgroundColor: C.white },
  band: { height: 5, backgroundColor: C.accent, borderRadius: 2, marginBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  title: { fontSize: 20, fontWeight: 700 },
  cycle: { fontSize: 12, marginTop: 2 },
  meta: { fontSize: 8.5, color: C.muted, textAlign: 'right' },
  section: { marginTop: 16 },
  h2: { fontSize: 12, fontWeight: 700, marginBottom: 6 },
  note: { fontSize: 8.5, color: C.muted, marginTop: 4 },
  italic: { fontStyle: 'italic' },
  row: { flexDirection: 'row' },
  tiles: { flexDirection: 'row', gap: 6 },
  tile: { flex: 1, backgroundColor: C.surface, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: C.border },
  tileLabel: { fontSize: 8, color: C.muted },
  tileValue: { fontSize: 13, fontWeight: 700, marginTop: 3 },
  tileSub: { fontSize: 7.5, color: C.muted, marginTop: 2 },
  table: { borderTopWidth: 1, borderColor: C.border },
  tr: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: C.border, paddingVertical: 4 },
  th: { fontSize: 8, color: C.muted, fontWeight: 700 },
  num: { textAlign: 'right' },
  totalRow: { flexDirection: 'row', paddingVertical: 5, fontWeight: 700 },
  dot: { width: 7, height: 7, borderRadius: 3.5, marginRight: 6 },
  footer: { position: 'absolute', bottom: 20, left: 36, right: 36, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: C.subtle },
})

// ---------------------------------------------------------------------------
// Yardımcı bileşenler
// ---------------------------------------------------------------------------

function Section({ title, children, keepTogether = true }: { title: string; children: ReactNode; keepTogether?: boolean }) {
  return (
    <View style={s.section} wrap={!keepTogether}>
      <Text style={s.h2}>{title}</Text>
      {children}
    </View>
  )
}

function Tile({ label, value, sub, color, bg }: { label: string; value: string; sub?: string; color?: string; bg?: string }) {
  return (
    <View style={[s.tile, bg ? { backgroundColor: bg } : {}]}>
      <Text style={s.tileLabel}>{label}</Text>
      <Text style={[s.tileValue, color ? { color } : {}]}>{value}</Text>
      {sub ? <Text style={s.tileSub}>{sub}</Text> : null}
    </View>
  )
}

const signColor = (n: number, invert = false) => (n === 0 ? C.text : (n < 0) !== invert ? C.bad : C.good)

/** Donut dilimi (halka parçası) yolu. Açılar radyan, 12 yönünden saat yönünde. */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(3)} ${(cy - r * Math.cos(a)).toFixed(3)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`
}

function Donut({ slices, size = 132 }: { slices: { color: string; share: number }[]; size?: number }) {
  const c = size / 2
  const r1 = c - 2
  const r0 = r1 * 0.6
  let a = 0
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.length === 1 ? (
        <Circle cx={c} cy={c} r={(r0 + r1) / 2} stroke={slices[0].color} strokeWidth={r1 - r0} fill="none" />
      ) : (
        <G>
          {slices.map((sl, i) => {
            const a0 = a
            a += sl.share * 2 * Math.PI
            if (sl.share <= 0) return null
            return <Path key={i} d={arcPath(c, c, r0, r1, a0, a)} fill={sl.color} stroke={C.white} strokeWidth={1.5} />
          })}
        </G>
      )}
    </Svg>
  )
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const W = 300
  const w = max > 0 ? (value / max) * W : 0
  return (
    <View style={[s.row, { alignItems: 'center', marginTop: 4 }]}>
      <Text style={{ width: 48, fontSize: 8, color: C.muted }}>{label}</Text>
      <Svg width={W} height={8}>
        <Rect x={0} y={0} width={W} height={8} rx={4} fill={C.track} />
        {w > 0 ? <Rect x={0} y={0} width={Math.max(w, 4)} height={8} rx={4} fill={color} /> : null}
      </Svg>
      <Text style={{ marginLeft: 8, fontSize: 8.5 }}>{formatEur(value)}</Text>
    </View>
  )
}

const dayMonth = (date: string) => dayjs(date).locale('tr').format('D MMM')

// ---------------------------------------------------------------------------
// Belge
// ---------------------------------------------------------------------------

export function BudgetReportDocument({ report: r }: { report: BudgetReport }) {
  const cmp = r.comparison
  return (
    <Document title={`${r.title} — ${r.cycleLabel}`} author="Bütçem" language="tr">
      <Page size="A4" style={s.page}>
        {/* 1. Başlık */}
        <View style={s.band} fixed />
        <View style={s.headerRow}>
          <View>
            <Text style={s.title}>{r.title}</Text>
            <Text style={s.cycle}>{r.cycleLabel}</Text>
          </View>
          <View>
            <Text style={s.meta}>
              Döngünün {r.day}. günü / {r.totalDays}
            </Text>
            <Text style={s.meta}>Oluşturulma: {r.generatedAt}</Text>
          </View>
        </View>

        {/* 2. Durum özeti */}
        <Section title="Durum özeti">
          <View style={s.tiles}>
            <Tile label="Toplam gelir" value={formatEur(r.summary.income.total)} sub={`Alınan ${formatEur(r.summary.income.received)} · Beklenen ${formatEur(r.summary.income.expected)}`} />
            <Tile label="Sabit gider" value={formatEur(r.summary.fixed.total)} sub={`Ödenen ${formatEur(r.summary.fixed.paid)} · Kalan ${formatEur(r.summary.fixed.remaining)}`} />
            <Tile label="Değişken harcama" value={formatEur(r.summary.variable)} sub="Bugüne kadar, kredi kartı dahil" />
            <Tile
              label="Nakit akışı"
              value={formatSignedEur(r.summary.cashFlow)}
              sub="Gelir − sabit − değişken"
              color={signColor(r.summary.cashFlow)}
              bg={r.summary.cashFlow < 0 ? C.badBg : r.summary.cashFlow > 0 ? C.goodBg : undefined}
            />
          </View>
        </Section>

        {/* 3. Kategori dağılımı */}
        <Section title="Kategori dağılımı (değişken harcamalar)">
          {r.categories.rows.length === 0 ? (
            <Text style={[s.note, s.italic]}>Bu döngüde henüz değişken harcama yok.</Text>
          ) : (
            <View style={[s.row, { alignItems: 'flex-start', gap: 18 }]}>
              <Donut slices={r.categories.rows} />
              <View style={{ flex: 1 }}>
                <View style={[s.tr, { borderTopWidth: 1 }]}>
                  <Text style={[s.th, { flex: 1 }]}>Kategori</Text>
                  <Text style={[s.th, s.num, { width: 70 }]}>Tutar</Text>
                  <Text style={[s.th, s.num, { width: 36 }]}>Pay</Text>
                </View>
                {r.categories.rows.map((c) => (
                  <View key={c.key} style={s.tr} wrap={false}>
                    <View style={[s.row, { flex: 1, alignItems: 'center' }]}>
                      <View style={[s.dot, { backgroundColor: c.color }]} />
                      <Text>{c.label}</Text>
                    </View>
                    <Text style={[s.num, { width: 70 }]}>{formatEur(c.amount)}</Text>
                    <Text style={[s.num, { width: 36, color: C.muted }]}>{formatShare(c.share)}</Text>
                  </View>
                ))}
                <View style={s.totalRow}>
                  <Text style={{ flex: 1 }}>Toplam</Text>
                  <Text style={[s.num, { width: 70 }]}>{formatEur(r.categories.total)}</Text>
                  <Text style={{ width: 36 }} />
                </View>
              </View>
            </View>
          )}
        </Section>

        {/* 4. Kısılabilir kıyas */}
        <Section title="Kısılabilir harcamalar · baz aya göre">
          {cmp.state === 'noCuttable' ? (
            <Text style={s.note}>Kısılabilir kategori seçilmemiş (Ayarlar › Kategoriler).</Text>
          ) : cmp.state === 'noBaseline' ? (
            <Text style={s.note}>Baz ay seçili değil; kıyas yapılamadı.</Text>
          ) : cmp.state === 'activeIsBaseline' || !cmp.values ? (
            <Text style={s.note}>Bu döngü baz ay olarak seçili; kıyas bir sonraki döngüde başlar.</Text>
          ) : (
            <View>
              <Text style={s.note}>
                {cmp.labels.join(' + ')} · {r.day}. güne kadar · baz ay {cmp.baselineLabel}
              </Text>
              <View style={[s.tiles, { marginTop: 6 }]}>
                <Tile label="Bu ay" value={formatEur(cmp.values.dortluBuAy)} />
                <Tile label="Baz ay (aynı gün)" value={formatEur(cmp.values.dortluBazAy)} />
                <Tile
                  label={cmp.values.fark < 0 ? 'Fark (baz ayın altında)' : cmp.values.fark > 0 ? 'Fark (baz ayın üstünde)' : 'Fark'}
                  value={formatSignedEur(cmp.values.fark)}
                  color={signColor(cmp.values.fark, true)}
                  bg={cmp.values.fark < 0 ? C.goodBg : cmp.values.fark > 0 ? C.badBg : undefined}
                />
              </View>
              <View style={{ marginTop: 6 }}>
                <Bar
                  label="Bu ay"
                  value={cmp.values.dortluBuAy}
                  max={Math.max(cmp.values.dortluBuAy, cmp.values.dortluBazAy)}
                  color={cmp.values.fark < 0 ? C.good : cmp.values.fark > 0 ? C.bad : C.muted}
                />
                <Bar label="Baz ay" value={cmp.values.dortluBazAy} max={Math.max(cmp.values.dortluBuAy, cmp.values.dortluBazAy)} color={C.subtle} />
              </View>
            </View>
          )}
        </Section>

        {/* 5. Kredi kartı */}
        <Section title="Kredi kartı">
          {r.creditCard ? (
            <View>
              <View style={s.tiles}>
                <Tile label="Dönem başı borç" value={formatEur(r.creditCard.opening)} />
                <Tile label="Bu dönem ödenen" value={formatEur(r.creditCard.paid)} color={C.good} bg={C.goodBg} />
                <Tile label="Kalan borç" value={formatEur(r.creditCard.remaining)} />
              </View>
              {r.creditCard.overpaid > 0 ? (
                <Text style={s.note}>Bu dönem dönem başı borçtan {formatEur(r.creditCard.overpaid)} fazla ödendi.</Text>
              ) : null}
            </View>
          ) : (
            <Text style={s.note}>Bu döngü henüz oluşmadı.</Text>
          )}
        </Section>

        {/* 6. Borçlar */}
        <Section title="Borçlar (öncelik sırasıyla)" keepTogether={r.debts.rows.length < 12}>
          {!r.debts.available ? (
            <Text style={[s.note, s.italic]}>{DEBTS_UNAVAILABLE_NOTE}</Text>
          ) : r.debts.rows.length === 0 ? (
            <Text style={s.note}>Kayıtlı borç yok.</Text>
          ) : (
            <View style={s.table}>
              {r.debts.rows.map((d, i) => (
                <View key={i} style={s.tr} wrap={false}>
                  <Text style={{ width: 22, color: C.muted }}>{d.priority}</Text>
                  <Text style={{ flex: 1 }}>{d.name}</Text>
                  <Text style={[s.num, { width: 90 }]}>{formatEur(d.balance)}</Text>
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={{ flex: 1 }}>Toplam borç</Text>
                <Text style={[s.num, { width: 90 }]}>{formatEur(r.debts.total)}</Text>
              </View>
            </View>
          )}
        </Section>

        {/* 7. Sabit giderler */}
        <Section title="Her ay düzenli ödenenler" keepTogether={r.fixed.duzenli.length < 12}>
          {r.fixed.duzenli.length === 0 ? (
            <Text style={s.note}>Düzenli ödeme yok.</Text>
          ) : (
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={[s.th, { width: 44 }]}>Gün</Text>
                <Text style={[s.th, { flex: 1 }]}>Kalem</Text>
                <Text style={[s.th, { width: 60 }]}>Durum</Text>
                <Text style={[s.th, s.num, { width: 80 }]}>Tutar</Text>
              </View>
              {r.fixed.duzenli.map((f, i) => (
                <View key={i} style={s.tr} wrap={false}>
                  <Text style={{ width: 44, color: C.muted }}>{dayMonth(f.date)}</Text>
                  <Text style={{ flex: 1 }}>{f.item}</Text>
                  <Text style={{ width: 60, color: f.paid ? C.good : C.muted }}>{f.paid ? 'ödendi' : 'ödenecek'}</Text>
                  <Text style={[s.num, { width: 80 }]}>{formatEur(f.amount)}</Text>
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={{ flex: 1 }}>Aylık düzenli toplam</Text>
                <Text style={[s.num, { width: 80 }]}>{formatEur(r.fixed.duzenliTotal)}</Text>
              </View>
            </View>
          )}
        </Section>

        <Section title="Taksitler" keepTogether={r.fixed.taksit.length < 12}>
          {r.fixed.taksit.length === 0 ? (
            <Text style={s.note}>Taksit yok.</Text>
          ) : (
            <View style={s.table}>
              <View style={s.tr}>
                <Text style={[s.th, { width: 44 }]}>Gün</Text>
                <Text style={[s.th, { flex: 1 }]}>Kalem</Text>
                <Text style={[s.th, { width: 100 }]}>Kalan</Text>
                <Text style={[s.th, { width: 70 }]}>Tahmini bitiş</Text>
                <Text style={[s.th, s.num, { width: 70 }]}>Aylık</Text>
              </View>
              {r.fixed.taksit.map((f, i) => (
                <View key={i} style={s.tr} wrap={false}>
                  <Text style={{ width: 44, color: C.muted }}>{dayMonth(f.date)}</Text>
                  <Text style={{ flex: 1 }}>{f.item}</Text>
                  <Text style={{ width: 100, color: f.paid ? C.good : C.text }}>{f.remaining}</Text>
                  <Text style={{ width: 70, color: C.muted }}>{f.endMonth ?? '—'}</Text>
                  <Text style={[s.num, { width: 70 }]}>{formatEur(f.amount)}</Text>
                </View>
              ))}
              <View style={s.totalRow}>
                <Text style={{ flex: 1 }}>Aylık taksit yükü</Text>
                <Text style={[s.num, { width: 70 }]}>{formatEur(r.fixed.taksitTotal)}</Text>
              </View>
            </View>
          )}
        </Section>

        {/* Alt bilgi (her sayfada) */}
        <View style={s.footer} fixed>
          <Text>
            {r.title} · {r.cycleLabel}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Sayfa ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
