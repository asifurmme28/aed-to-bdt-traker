import { useState, useEffect, useCallback, useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { RefreshCw, Sun, Moon, ArrowUpRight, Clock, Link2, AlertTriangle, Trophy } from 'lucide-react'

const DEFAULT_API = 'https://open.er-api.com/v6/latest/AED'

// Providers don't publish public rate APIs, so each rate is modelled as the live
// mid-market rate minus a typical margin. Margins/fees are indicative — edit freely.
const PROVIDERS = [
  { name: 'Wise', url: 'https://wise.com', margin: 0.0045, fee: 12, eta: 'Seconds – 1 day' },
  { name: 'Lulu Exchange', url: 'https://luluexchange.com/', margin: 0.0065, fee: 10, eta: 'Minutes' },
  { name: 'Federal Exchange', url: 'https://federalexchange.ae/', margin: 0.0085, fee: 12, eta: 'Minutes – 1 hour' },
  { name: 'Universal Exchange', url: 'https://www.universalexchange.net/', margin: 0.0105, fee: 10, eta: 'Minutes – 2 hours' },
  { name: 'Sharaf Exchange', url: 'https://sharafexchange.ae/', margin: 0.0125, fee: 15, eta: 'Minutes – 1 day' },
  { name: 'Western Union', url: 'https://www.westernunion.com/ae/en/home.html', margin: 0.022, fee: 15, eta: 'Minutes' },
  { name: 'Bank transfer', url: null, margin: 0.028, fee: 25, eta: '1 – 3 business days' },
]

const fmt = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const iso = (d) => d.toISOString().slice(0, 10)
const card = 'rounded-2xl border border-black/10 bg-white dark:border-white/10 dark:bg-[#14201A]'
const muted = 'text-slate-500 dark:text-slate-400'
const focus = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600'

// Accepts common shapes: {rates:{BDT}}, {conversion_rates:{BDT}}, {BDT}, {rate}, {result}
function pick(j) {
  const v = j?.rates?.BDT ?? j?.conversion_rates?.BDT ?? j?.data?.BDT ?? j?.BDT ?? j?.rate ?? j?.result ?? j?.conversion_rate
  const n = Number(v?.value ?? v)
  return Number.isFinite(n) && n > 0 ? n : null
}

async function fetchRate(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Rate source responded with ${res.status}`)
  const rate = pick(await res.json())
  if (!rate) throw new Error('No AED→BDT rate found in the response (expected e.g. rates.BDT)')
  return rate
}

async function fetchHistory(days, live) {
  try {
    const url = `https://api.frankfurter.dev/v1/${iso(new Date(Date.now() - days * 864e5))}..${iso(new Date())}?base=AED&symbols=BDT`
    const res = await fetch(url)
    if (!res.ok) throw new Error('no history')
    const j = await res.json()
    const pts = Object.entries(j.rates || {}).map(([d, r]) => ({ label: d.slice(5), rate: r.BDT })).filter((p) => p.rate)
    if (pts.length > 2) return { pts, simulated: false }
  } catch { /* fall through */ }
  // Fallback: deterministic random walk ending at the live rate, clearly flagged in the UI.
  let seed = days * 7919
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5
  const pts = []
  let v = live
  for (let i = 0; i <= days; i++) {
    pts.unshift({ label: iso(new Date(Date.now() - i * 864e5)).slice(5), rate: v })
    v *= 1 + rnd() * 0.006
  }
  return { pts, simulated: true }
}

export default function App() {
  const [dark, setDark] = useState(() => {
    const s = localStorage.getItem('theme')
    return s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [amount, setAmount] = useState('1000')
  const [api, setApi] = useState(() => localStorage.getItem('api') || DEFAULT_API)
  const [draft, setDraft] = useState(api)
  const [rate, setRate] = useState(null)
  const [updated, setUpdated] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [range, setRange] = useState('7D')
  const [hist, setHist] = useState(null)
  const [ticks, setTicks] = useState([])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetchRate(api)
      const now = new Date()
      setRate(r); setUpdated(now); setError(null)
      setTicks((t) => [...t.slice(-59), { label: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), rate: r }])
    } catch (e) {
      setError(e.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id) }, [load])

  const ready = rate !== null
  useEffect(() => {
    if (range === 'Live' || !ready) return
    let off = false
    fetchHistory(range === '7D' ? 7 : 30, rate).then((h) => !off && setHist(h))
    return () => { off = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, ready])

  const amt = parseFloat(amount) || 0
  const list = useMemo(() => {
    if (!rate) return []
    const rows = PROVIDERS.map((p) => {
      const r = rate * (1 - p.margin)
      return { ...p, rate: r, net: Math.max(amt - p.fee, 0) * r }
    }).sort((a, b) => b.rate - a.rate) // highest rate first
    const top = Math.max(...rows.map((r) => r.net))
    return rows.map((r) => ({ ...r, bestNet: r.net === top && amt > 0 }))
  }, [rate, amt])

  const data = range === 'Live' ? ticks : hist?.pts
  const change = data && data.length > 1 ? ((data[data.length - 1].rate / data[0].rate - 1) * 100) : null
  const applyApi = (u) => { localStorage.setItem('api', u); setApi(u); setDraft(u); setTicks([]); setRate(null); setHist(null) }

  return (
    <div className="min-h-screen bg-[#F4F7F4] text-[#0D1A14] transition-colors dark:bg-[#0C1410] dark:text-slate-100">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="display text-xl font-bold sm:text-2xl">AED to BDT</h1>
            <p className={`text-sm ${muted}`}>Send money from the UAE to Bangladesh at the best rate</p>
          </div>
          <button onClick={() => setDark(!dark)} aria-label="Toggle dark mode" className={`rounded-full border border-black/10 p-2.5 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10 ${focus}`}>
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        {error && (
          <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">Couldn’t load the live rate</p>
              <p>{error}. {rate ? 'Showing the last rate we received.' : 'Check your connection or the custom source below, then try again.'}</p>
            </div>
            <button onClick={load} className={`rounded-lg px-3 py-1 font-semibold underline ${focus}`}>Retry</button>
          </div>
        )}

        <section className={`${card} grid gap-6 p-5 sm:p-7 lg:grid-cols-2`}>
          <div>
            <label htmlFor="amt" className="text-sm font-semibold">You send</label>
            <div className="mt-2 flex items-center rounded-xl border border-black/15 bg-[#F4F7F4] px-4 py-3 focus-within:ring-2 focus-within:ring-emerald-600 dark:border-white/15 dark:bg-[#0C1410]">
              <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                className="display w-full bg-transparent text-3xl font-bold outline-none" placeholder="0" />
              <span className="ml-3 font-semibold text-emerald-700 dark:text-emerald-400">AED</span>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={load} disabled={loading} className={`inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60 ${focus}`}>
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Refreshing…' : 'Refresh rates'}
              </button>
              <span className={`inline-flex items-center gap-1.5 text-sm ${muted}`}>
                <Clock size={14} />{updated ? `Updated ${updated.toLocaleTimeString()}` : 'Waiting for first update'}
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-emerald-700 p-5 text-white dark:bg-emerald-900/60">
            <p className="text-sm text-emerald-100">They receive (mid-market, before fees)</p>
            {rate ? (
              <>
                <p className="display mt-1 break-all text-4xl font-bold sm:text-5xl">৳ {fmt(amt * rate)}</p>
                <p className="mt-2 text-sm text-emerald-100">1 AED = {fmt(rate, 4)} BDT</p>
              </>
            ) : (
              <div className="mt-3 h-14 animate-pulse rounded-lg bg-white/20" aria-label="Loading rate" />
            )}
          </div>
        </section>

        <section className={card}>
          <div className="p-5 pb-3 sm:px-7">
            <h2 className="display text-lg font-bold">Compare providers</h2>
            <p className={`text-sm ${muted}`}>Sorted by rate, highest first. Indicative estimates — confirm on the provider’s site.</p>
          </div>
          {!rate ? (
            <div className="space-y-2 p-5 sm:px-7">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />)}</div>
          ) : (
            <ul>
              {list.map((p, i) => (
                <li key={p.name} className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-black/10 px-5 py-4 text-sm dark:border-white/10 sm:px-7 md:grid-cols-[1.6fr_1fr_.8fr_1.2fr_1.2fr] md:items-center">
                  <div className="col-span-2 md:col-span-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 font-semibold hover:underline ${focus}`}>{p.name}<ArrowUpRight size={14} /></a>
                      ) : <span className="font-semibold">{p.name}</span>}
                      {i === 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"><Trophy size={12} />Best rate</span>}
                      {p.bestNet && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">Most received</span>}
                    </div>
                  </div>
                  <div><p className={`text-xs ${muted} md:hidden`}>Rate</p><p className="display text-base font-bold">{fmt(p.rate, 4)}</p></div>
                  <div><p className={`text-xs ${muted} md:hidden`}>Fee</p>{p.fee ? `${fmt(p.fee, 0)} AED` : 'Free'}</div>
                  <div><p className={`text-xs ${muted} md:hidden`}>Delivery</p>{p.eta}</div>
                  <div className="md:text-right"><p className={`text-xs ${muted} md:hidden`}>They receive</p><p className="display text-base font-bold">৳ {fmt(p.net)}</p></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} p-5 sm:p-7`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="display text-lg font-bold">Rate trend</h2>
              <p className={`text-sm ${muted}`}>
                {change !== null ? <>{change >= 0 ? '▲' : '▼'} {fmt(Math.abs(change), 2)}% over this period</> : 'AED → BDT'}
                {range !== 'Live' && hist?.simulated && ' · simulated history (live history unavailable)'}
              </p>
            </div>
            <div role="tablist" className="flex rounded-xl border border-black/10 p-1 dark:border-white/10">
              {['7D', '30D', 'Live'].map((r) => (
                <button key={r} role="tab" aria-selected={range === r} onClick={() => setRange(r)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${focus} ${range === r ? 'bg-emerald-700 text-white' : muted}`}>{r}</button>
              ))}
            </div>
          </div>
          <div className="mt-4 h-64 sm:h-80">
            {data && data.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0E8A5B" stopOpacity=".35" /><stop offset="100%" stopColor="#0E8A5B" stopOpacity="0" /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#8a948e' }} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12, fill: '#8a948e' }} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => v.toFixed(2)} />
                  <Tooltip formatter={(v) => [`${fmt(v, 4)} BDT`, '1 AED']} contentStyle={{ borderRadius: 12, border: '1px solid #8883', fontSize: 13 }} />
                  <Area type="monotone" dataKey="rate" stroke="#0E8A5B" strokeWidth={2.5} fill="url(#g)" isAnimationActive />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className={`flex h-full items-center justify-center rounded-xl bg-black/5 px-6 text-center text-sm dark:bg-white/5 ${muted}`}>
                {range === 'Live' ? 'Collecting live points — a new one is added every minute and on each refresh.' : 'Loading history…'}
              </div>
            )}
          </div>
        </section>

        <section className={`${card} p-5 sm:p-7`}>
          <h2 className="display flex items-center gap-2 text-lg font-bold"><Link2 size={18} />Use your own data source</h2>
          <p className={`mt-1 text-sm ${muted}`}>Paste a JSON endpoint that returns the AED→BDT rate (for example <code>rates.BDT</code>). The server must allow cross-origin requests.</p>
          <form onSubmit={(e) => { e.preventDefault(); draft.trim() && applyApi(draft.trim()) }} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} type="url" aria-label="Custom API endpoint" placeholder="https://api.example.com/latest?base=AED"
              className={`min-w-0 flex-1 rounded-xl border border-black/15 bg-[#F4F7F4] px-4 py-2.5 text-sm dark:border-white/15 dark:bg-[#0C1410] ${focus}`} />
            <button type="submit" className={`rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 ${focus}`}>Apply</button>
            <button type="button" onClick={() => applyApi(DEFAULT_API)} className={`rounded-xl border border-black/15 px-4 py-2.5 text-sm font-semibold hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10 ${focus}`}>Reset</button>
          </form>
          <p className={`mt-2 break-all text-xs ${muted}`}>Active source: {api === DEFAULT_API ? 'ExchangeRate-API (open.er-api.com)' : api}</p>
        </section>

        <footer className={`pb-4 text-xs ${muted}`}>
          Live mid-market rates come from the source above. Provider rates, fees and delivery times are modelled estimates, not quotes — exchange houses don’t publish public rate APIs. Always confirm the final rate with the provider before sending.
        </footer>
      </div>
    </div>
  )
}
