'use client'

import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

type Props = {
  value: string // datetime-local format: YYYY-MM-DDTHH:mm, or empty
  onChange: (value: string) => void
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parse(v: string) {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!m) return null
  return { year: +m[1], month: +m[2] - 1, day: +m[3], hour: +m[4], minute: +m[5] }
}

function fmt(year: number, month: number, day: number, hour: number, minute: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export default function RevealDatePicker({ value, onChange }: Props) {
  const parsed = parse(value)
  const today = new Date()

  const [viewYear, setViewYear] = useState(parsed?.year ?? today.getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.getMonth())

  const h24 = parsed?.hour ?? 12
  const minute = parsed?.minute ?? 0
  const isPM = h24 >= 12
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24

  const cells = useMemo(() => {
    const offset = new Date(viewYear, viewMonth, 1).getDay()
    const total = new Date(viewYear, viewMonth + 1, 0).getDate()
    return Array.from({ length: offset + total }, (_, i) => i < offset ? null : i - offset + 1)
  }, [viewYear, viewMonth])

  function pickDay(day: number) {
    onChange(fmt(viewYear, viewMonth, day, h24, minute))
  }

  function changeHour(h: number, pm: boolean) {
    if (!parsed) return
    const h24new = h === 12 ? (pm ? 12 : 0) : pm ? h + 12 : h
    onChange(fmt(parsed.year, parsed.month, parsed.day, h24new, parsed.minute))
  }

  function changeMinute(m: number) {
    if (!parsed) return
    onChange(fmt(parsed.year, parsed.month, parsed.day, parsed.hour, m))
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const isPast = (d: number) => new Date(viewYear, viewMonth, d) < todayStart

  const isSelected = (d: number) =>
    !!parsed && d === parsed.day && viewMonth === parsed.month && viewYear === parsed.year
  const isToday = (d: number) =>
    d === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()

  return (
    <div className="rounded-2xl overflow-hidden select-none" style={{ background: 'rgba(253,250,245,0.95)', border: '1px solid #E0D5C5' }}>
      {/* Month header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <button
          onClick={prevMonth}
          disabled={viewYear === today.getFullYear() && viewMonth <= today.getMonth()}
          className="w-7 h-7 rounded-full flex items-center justify-center transition"
          style={{
            color: viewYear === today.getFullYear() && viewMonth <= today.getMonth() ? '#C4B8A8' : '#8B6F4E',
            background: 'rgba(139,111,78,0.08)',
            opacity: viewYear === today.getFullYear() && viewMonth <= today.getMonth() ? 0.4 : 1,
            cursor: viewYear === today.getFullYear() && viewMonth <= today.getMonth() ? 'not-allowed' : 'pointer',
          }}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-sm font-bold tracking-wide" style={{ color: '#3D2B1A', fontFamily: 'var(--font-serif)' }}>
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} className="w-7 h-7 rounded-full flex items-center justify-center hover:opacity-70 transition" style={{ color: '#8B6F4E', background: 'rgba(139,111,78,0.08)' }}>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 px-3 mb-0.5">
        {DAYS.map(d => (
          <div key={d} className="text-center py-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#C4A882' }}>{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 px-3 pb-3 gap-y-1">
        {cells.map((day, i) => (
          <div key={i} className="flex items-center justify-center">
            {day ? (
              <button
                onClick={() => !isPast(day) && pickDay(day)}
                disabled={isPast(day)}
                className={`w-8 h-8 rounded-full text-xs flex items-center justify-center transition ${isPast(day) ? 'cursor-not-allowed' : 'hover:scale-110'}`}
                style={{
                  background: isPast(day) ? 'transparent' : isSelected(day) ? '#254F22' : isToday(day) ? 'rgba(37,79,34,0.1)' : 'transparent',
                  color: isPast(day) ? '#C4B8A8' : isSelected(day) ? '#FDFAF5' : isToday(day) ? '#254F22' : '#5C3D1E',
                  fontWeight: isSelected(day) || isToday(day) ? '700' : '500',
                  boxShadow: isSelected(day) ? '0 2px 8px rgba(37,79,34,0.35)' : 'none',
                  opacity: isPast(day) ? 0.45 : 1,
                }}
              >
                {day}
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {/* Time section */}
      <div style={{ borderTop: '1px solid #EAE0D0', opacity: parsed ? 1 : 0.4, pointerEvents: parsed ? 'auto' : 'none' }}>
        {/* Time header */}
        <div className="flex items-center px-3 pt-2.5 pb-1.5 gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest flex-1 text-center" style={{ color: '#C4A882' }}>Hour</span>
          <div style={{ width: 1 }} />
          <span className="text-[10px] font-semibold uppercase tracking-widest flex-1 text-center" style={{ color: '#C4A882' }}>Min</span>
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #E0D5C5' }}>
            {(['AM', 'PM'] as const).map(period => (
              <button
                key={period}
                onClick={() => changeHour(h12, period === 'PM')}
                className="text-[11px] px-2.5 py-1 font-bold transition"
                style={{
                  background: (period === 'PM') === isPM ? '#254F22' : 'rgba(92,61,30,0.07)',
                  color: (period === 'PM') === isPM ? '#FDFAF5' : '#8B6F4E',
                }}
              >
                {period}
              </button>
            ))}
          </div>
        </div>

        {/* Hour + Minute grids */}
        <div className="flex gap-2 px-3 pb-3">
          {/* Hours: 1–12 in 4 cols */}
          <div className="grid grid-cols-4 gap-1 flex-1">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
              <button
                key={h}
                onClick={() => changeHour(h, isPM)}
                className="h-7 rounded-lg text-[11px] font-semibold flex items-center justify-center transition hover:scale-105"
                style={{
                  background: h === h12 ? '#254F22' : 'rgba(92,61,30,0.07)',
                  color: h === h12 ? '#FDFAF5' : '#5C3D1E',
                  boxShadow: h === h12 ? '0 2px 6px rgba(37,79,34,0.3)' : 'none',
                }}
              >
                {String(h).padStart(2, '0')}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: '#EAE0D0', alignSelf: 'stretch' }} />

          {/* Minutes: 00–55 in 4 cols */}
          <div className="grid grid-cols-3 gap-1 flex-1">
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => (
              <button
                key={m}
                onClick={() => changeMinute(m)}
                className="h-7 rounded-lg text-[11px] font-semibold flex items-center justify-center transition hover:scale-105"
                style={{
                  background: m === minute ? '#254F22' : 'rgba(92,61,30,0.07)',
                  color: m === minute ? '#FDFAF5' : '#5C3D1E',
                  boxShadow: m === minute ? '0 2px 6px rgba(37,79,34,0.3)' : 'none',
                }}
              >
                :{String(m).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>

        {!parsed && (
          <p className="text-center text-[10px] pb-2" style={{ color: '#C4A882' }}>Pick a day first</p>
        )}
      </div>
    </div>
  )
}
