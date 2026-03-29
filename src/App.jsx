import { useState, useEffect, useCallback, useRef } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSETS = [
  { id: 'spy', label: 'S&P 500', emoji: '📈', ticker: 'SPY',  hlSymbol: 'SPY'   },
  { id: 'uso', label: 'Oil',     emoji: '🛢️', ticker: 'USO',  hlSymbol: 'USOIL' },
  { id: 'gld', label: 'Gold',    emoji: '🥇', ticker: 'GLD',  hlSymbol: 'GOLD'  },
]

function getLeverageLabel(lev) {
  if (lev <= 2) return '😌 Chill — good for beginners'
  if (lev <= 5) return '😤 Spicy — moderate risk'
  return '🔥 Degen — high risk'
}

function formatPrice(val) {
  if (!val && val !== 0) return '--'
  return '$' + Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

async function fetchPrices() {
  const results = {}
  await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        const res = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${asset.ticker}&token=${import.meta.env.VITE_FINNHUB_KEY}`
        )
        const data = await res.json()
        results[asset.id] = data.c || null
      } catch {
        results[asset.id] = null
      }
    })
  )
  return results
}

async function fetchFundingRate(hlSymbol) {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  })
  if (!res.ok) throw new Error(`Hyperliquid ${res.status}`)
  const payload = await res.json()
  // API returns [meta, assetCtxs] array
  if (!Array.isArray(payload) || payload.length < 2) throw new Error('Unexpected shape')
  const [meta, assetCtxs] = payload
  const idx = meta.universe.findIndex((a) => a.name === hlSymbol)
  if (idx === -1 || !assetCtxs[idx]) throw new Error('Asset not found')
  const rate = parseFloat(assetCtxs[idx].funding)
  // Treat missing, NaN, or exactly-zero as unavailable
  if (!isFinite(rate) || rate === 0) throw new Error('No valid rate')
  return (rate * 100).toFixed(4)
}

async function fetchAISummary(assetLabel, direction, leverage) {
  const prompt = `The user wants to go ${direction.toUpperCase()} on ${assetLabel} with ${leverage}x leverage.
Return ONLY a valid JSON object with exactly these fields:
{
  "thesis": "2 sentences, plain English thesis, no jargon",
  "risk": "2 sentences, what could go wrong",
  "perpExplain": "1 sentence explaining what a perp (short for perpetual futures contract) is — no technical jargon, explain it like the user has never traded before",
  "marketVibe": "1 sentence on current conditions for this asset"
}`

  const res = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error(`Proxy error: ${res.status}`)
  const data = await res.json()
  const text = data.content[0].text.trim()

  // 1) Strip markdown fences and try a clean parse
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (_) { /* fall through to brace extraction */ }

  // 2) Find outermost { … } and parse that substring
  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch (_) { /* fall through to placeholder */ }
  }

  // 3) Hardcoded placeholder so the UI never breaks
  return {
    thesis:      "This asset has been moving on macro trends and investor sentiment. Your direction reflects a view on near-term price momentum.",
    risk:        "Markets can reverse quickly on unexpected news or data releases. Always be aware that leveraged trades can close automatically if price moves against you.",
    perpExplain: "A perp is a bet on whether a price goes up or down — it never expires, so you can hold it as long as you want (while paying a small fee every 8 hours).",
    marketVibe:  "Conditions are mixed — watch for any major economic announcements before entering.",
  }
}

// ─── Price Status Dot ─────────────────────────────────────────────────────────

function PriceDot({ status }) {
  if (status === 'ok') {
    return (
      <span
        className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e] flex-shrink-0"
        style={{ boxShadow: '0 0 5px #22c55e' }}
        title="Live price"
      />
    )
  }
  if (status === 'delayed') {
    return <span className="text-white/30 text-[10px] font-medium">delayed</span>
  }
  // loading — dim placeholder
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/20 flex-shrink-0" />
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

function SplashScreen({ visible }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: '#0f0f0f',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      {/* Glow orb behind logo */}
      <div
        className="absolute"
        style={{
          width: 280,
          height: 280,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -55%)',
        }}
      />

      <div className="relative text-center px-8">
        <div className="text-5xl font-extrabold tracking-tight text-white mb-3">
          First Perp
        </div>
        <p className="text-white/55 text-lg font-medium mb-10">
          Your first trade, explained.
        </p>

        {/* Powered-by row */}
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {['Anthropic', 'TradeXYZ', 'Hyperliquid'].map((name, i) => (
            <div key={name} className="flex items-center gap-2">
              {i > 0 && <span className="text-white/20 text-xs">·</span>}
              <span className="text-white/35 text-xs font-medium tracking-wide">{name}</span>
            </div>
          ))}
        </div>

        {/* Loading bar */}
        <div className="mt-10 w-32 h-0.5 bg-white/10 rounded-full mx-auto overflow-hidden">
          <div
            className="h-full bg-[#f59e0b] rounded-full"
            style={{
              animation: 'splash-bar 1.4s ease-out forwards',
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Ticker Tape ──────────────────────────────────────────────────────────────

function TickerTape({ prices, tickerFunding }) {
  const spy  = prices.spy  ? formatPrice(prices.spy)  : '--'
  const gld  = prices.gld  ? formatPrice(prices.gld)  : '--'
  const uso  = prices.uso  ? formatPrice(prices.uso)  : '--'
  const rate = tickerFunding ? `${tickerFunding}%` : '--'

  const text = `SPY ${spy}  ·  GOLD ${gld}  ·  OIL ${uso}  ·  Holding cost (8hr): ${rate}  ·  `
  // Duplicate for seamless loop
  const content = text.repeat(4)

  return (
    <div
      className="overflow-hidden border-b border-white/[0.06]"
      style={{ background: 'rgba(255,255,255,0.025)', height: '30px' }}
    >
      <div
        className="flex items-center h-full whitespace-nowrap"
        style={{ animation: 'ticker-scroll 28s linear infinite' }}
      >
        <span className="text-white/40 text-[11px] font-mono tracking-wide pr-4">
          {content}
        </span>
        {/* Second copy ensures seamless loop */}
        <span className="text-white/40 text-[11px] font-mono tracking-wide pr-4" aria-hidden>
          {content}
        </span>
      </div>
    </div>
  )
}

// ─── Presentation Mode Toggle ─────────────────────────────────────────────────

function PresentToggle({ active, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={active ? 'Exit presentation mode' : 'Presentation mode (bigger text)'}
      className="fixed top-3 right-3 z-40 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 active:scale-90"
      style={{
        background: active ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${active ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`,
      }}
    >
      {/* Simple projector/expand icon */}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="9" rx="1.5"
          stroke={active ? '#f59e0b' : 'rgba(255,255,255,0.5)'} strokeWidth="1.5" />
        <line x1="8" y1="13" x2="8" y2="16"
          stroke={active ? '#f59e0b' : 'rgba(255,255,255,0.5)'} strokeWidth="1.5" />
        <line x1="5" y1="16" x2="11" y2="16"
          stroke={active ? '#f59e0b' : 'rgba(255,255,255,0.5)'} strokeWidth="1.5" />
      </svg>
    </button>
  )
}

// ─── Progress Dots ────────────────────────────────────────────────────────────

function ProgressDots({ screen }) {
  const filled = screen === 0 ? 1 : screen === 1 ? 2 : 3
  return (
    <div className="flex justify-center items-center gap-2 pt-5 pb-1">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-500"
          style={{
            width: i === filled ? '24px' : '8px',
            height: '8px',
            background: i <= filled ? '#f59e0b' : 'rgba(255,255,255,0.15)',
          }}
        />
      ))}
    </div>
  )
}

// ─── Screen 1 — Asset Selection ───────────────────────────────────────────────

function Screen1({ prices, pricesStatus, onSelect }) {
  return (
    <div className="flex flex-col px-5 pt-6 pb-8">
      <div className="text-center mb-6">
        <p className="text-[#f59e0b] text-xs uppercase tracking-[0.2em] font-semibold mb-2">
          Step 1 of 3
        </p>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight">
          Your first trade starts<br />with a hunch.
        </h1>
        <p className="text-white/50 mt-2 text-sm">
          What do you think will move?
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {ASSETS.map((asset) => (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className="flex items-center justify-between bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-5 min-h-[72px] transition-all duration-150 active:scale-[0.97] hover:bg-white/[0.08] hover:border-[#f59e0b]/40"
          >
            <div className="flex items-center gap-3">
              <span className="text-[2rem] leading-none">{asset.emoji}</span>
              <div className="text-left">
                <div className="text-base font-bold">{asset.label}</div>
                <div className="text-white/35 text-xs">{asset.ticker}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[#f59e0b] font-mono font-bold text-xl tracking-tight">
                {prices[asset.id]
                  ? formatPrice(prices[asset.id])
                  : <span className="text-white/30 text-base">--</span>}
              </div>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <PriceDot status={pricesStatus} />
                <span className="text-white/30 text-xs">
                  {pricesStatus === 'delayed' ? '' : 'live'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="text-center text-white/25 text-xs mt-6">
        This is a simulation — no real money involved.
      </p>
    </div>
  )
}

// ─── Screen 2 — Direction ─────────────────────────────────────────────────────

function Screen2({ asset, onSelect }) {
  return (
    <div className="flex flex-col px-5 pt-6 pb-8">
      <div className="text-center mb-6">
        <p className="text-[#f59e0b] text-xs uppercase tracking-[0.2em] font-semibold mb-2">
          Step 2 of 3
        </p>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight">
          Which way are you betting?
        </h1>
        <div className="flex items-center justify-center gap-2 mt-3">
          <span className="text-lg">{asset?.emoji}</span>
          <span className="text-white/60 text-sm font-medium">
            You picked <span className="text-white font-semibold">{asset?.label}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <button
          onClick={() => onSelect('long')}
          className="flex flex-col items-center justify-center bg-[#22c55e]/[0.07] border-2 border-[#22c55e]/30 rounded-2xl px-5 py-8 min-h-[130px] transition-all duration-150 active:scale-[0.97] hover:bg-[#22c55e]/[0.12] hover:border-[#22c55e]/60"
        >
          <span className="text-4xl mb-2 leading-none">🟢</span>
          <span className="text-xl font-extrabold text-[#22c55e] tracking-tight">It's going UP</span>
          <span className="text-white/45 text-sm mt-1.5">You profit if price rises</span>
        </button>

        <button
          onClick={() => onSelect('short')}
          className="flex flex-col items-center justify-center bg-[#ef4444]/[0.07] border-2 border-[#ef4444]/30 rounded-2xl px-5 py-8 min-h-[130px] transition-all duration-150 active:scale-[0.97] hover:bg-[#ef4444]/[0.12] hover:border-[#ef4444]/60"
        >
          <span className="text-4xl mb-2 leading-none">🔴</span>
          <span className="text-xl font-extrabold text-[#ef4444] tracking-tight">It's going DOWN</span>
          <span className="text-white/45 text-sm mt-1.5">You profit if price falls</span>
        </button>
      </div>
    </div>
  )
}

// ─── Screen 3 — Leverage ──────────────────────────────────────────────────────

function Screen3({ leverage, setLeverage, onContinue }) {
  const pnl = (100 * leverage * 0.05).toFixed(2)
  const pct = ((leverage - 1) / 9) * 100

  return (
    <div className="flex flex-col px-5 pt-6 pb-8">
      <div className="text-center mb-6">
        <p className="text-[#f59e0b] text-xs uppercase tracking-[0.2em] font-semibold mb-2">
          Step 3 of 3
        </p>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight">
          How bold are you feeling?
        </h1>
        <p className="text-white/50 mt-2 text-sm">
          Your multiplier amplifies gains — and losses.
        </p>
      </div>

      {/* Slider card */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div>
            <span className="text-white/50 text-sm font-medium">Multiplier</span>
            <span className="text-white/25 text-xs ml-2">(called "leverage" on exchanges)</span>
          </div>
          <span className="text-[#f59e0b] font-extrabold text-3xl tracking-tight">
            {leverage}<span className="text-xl">x</span>
          </span>
        </div>

        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full mt-4"
          style={{
            background: `linear-gradient(to right, #f59e0b ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
          }}
        />

        <div className="flex justify-between mt-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
            <div
              key={v}
              className="flex flex-col items-center gap-1 cursor-pointer"
              onClick={() => setLeverage(v)}
            >
              <div
                className="w-0.5 h-2 rounded-full transition-all"
                style={{ background: v <= leverage ? '#f59e0b' : 'rgba(255,255,255,0.15)' }}
              />
              {(v === 1 || v === 5 || v === 10) && (
                <span
                  className="text-[10px] font-medium transition-colors"
                  style={{ color: v <= leverage ? '#f59e0b' : 'rgba(255,255,255,0.3)' }}
                >
                  {v}x
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          className="mt-4 text-center py-3 rounded-xl text-sm font-semibold"
          style={{ background: 'rgba(255,255,255,0.05)' }}
        >
          {getLeverageLabel(leverage)}
        </div>
      </div>

      {/* Example card */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 mb-5">
        <p className="text-white/40 text-xs uppercase tracking-wider mb-2 font-medium">
          Live Example
        </p>
        <p className="text-sm text-white/80 leading-relaxed">
          With <span className="text-white font-bold">$100</span> and a{' '}
          <span className="text-[#f59e0b] font-bold">{leverage}x</span> multiplier,
          a 5% move =
        </p>
        <div className="flex gap-4 mt-3">
          <div className="flex-1 bg-[#22c55e]/10 border border-[#22c55e]/25 rounded-xl py-3 text-center">
            <div className="text-[#22c55e] font-extrabold text-xl">+${pnl}</div>
            <div className="text-white/40 text-xs mt-0.5">if right</div>
          </div>
          <div className="flex-1 bg-[#ef4444]/10 border border-[#ef4444]/25 rounded-xl py-3 text-center">
            <div className="text-[#ef4444] font-extrabold text-xl">-${pnl}</div>
            <div className="text-white/40 text-xs mt-0.5">if wrong</div>
          </div>
        </div>
      </div>

      <button
        onClick={onContinue}
        className="w-full bg-[#f59e0b] text-black font-extrabold text-lg rounded-2xl py-4 min-h-[64px] transition-all duration-150 active:scale-[0.97] hover:bg-[#fbbf24] shadow-lg shadow-[#f59e0b]/20"
      >
        Build My Trade Summary →
      </button>
    </div>
  )
}

// ─── Screen 4 — Loading ───────────────────────────────────────────────────────

function Screen4() {
  return (
    <div className="loading-bg flex flex-col items-center justify-center min-h-[70vh] px-5 gap-6 rounded-2xl mx-3 my-4">
      <div className="flex gap-3">
        <div className="w-3 h-3 rounded-full bg-[#f59e0b] pulse-dot-1" />
        <div className="w-3 h-3 rounded-full bg-[#f59e0b] pulse-dot-2" />
        <div className="w-3 h-3 rounded-full bg-[#f59e0b] pulse-dot-3" />
      </div>
      <div className="text-center">
        <p className="text-white font-semibold text-lg">Building your trade summary...</p>
        <p className="text-white/40 text-sm mt-1">Asking Claude for analysis</p>
      </div>
    </div>
  )
}

// ─── Screen 5 — Summary ───────────────────────────────────────────────────────

function AICard({ icon, title, text }) {
  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-base leading-none">{icon}</span>
        <span className="text-white/45 text-[11px] uppercase tracking-[0.15em] font-semibold">
          {title}
        </span>
      </div>
      <p className="text-sm text-white/85 leading-relaxed">{text}</p>
    </div>
  )
}

function TradeTicket({ asset, direction, leverage, price }) {
  const isLong = direction === 'long'
  // Auto-close price: the level where your position closes automatically
  const autoClosePrice = price
    ? isLong
      ? price - price / leverage
      : price + price / leverage
    : null

  const Row = ({ label, value, sub, valueClass = 'text-white font-semibold' }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.06] last:border-0">
      <div>
        <span className="text-white/45 text-sm">{label}</span>
        {sub && <span className="text-white/25 text-[11px] ml-1.5">{sub}</span>}
      </div>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  )

  return (
    <div
      className="rounded-2xl p-4 mb-4"
      style={{
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
        border: '1px solid rgba(255,255,255,0.1)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="text-xl leading-none">{asset?.emoji}</span>
          <span className="font-bold text-base tracking-tight">{asset?.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wider"
            style={
              isLong
                ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e' }
                : { background: 'rgba(239,68,68,0.15)', color: '#ef4444' }
            }
          >
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
          <span className="px-2.5 py-1 rounded-lg text-xs font-extrabold bg-[#f59e0b]/15 text-[#f59e0b]">
            {leverage}×
          </span>
        </div>
      </div>

      <Row
        label="Entry Price"
        value={price ? formatPrice(price) : '--'}
        valueClass="text-[#f59e0b] font-mono font-bold"
      />
      <Row
        label="Multiplier"
        sub="(leverage)"
        value={`${leverage}× — ${leverage <= 2 ? 'Conservative' : leverage <= 5 ? 'Moderate' : 'Aggressive'}`}
      />
      <Row
        label="Auto-close price"
        sub="(est.)"
        value={autoClosePrice ? formatPrice(autoClosePrice) : '--'}
        valueClass={isLong ? 'text-[#ef4444] font-mono font-semibold' : 'text-[#22c55e] font-mono font-semibold'}
      />
      <Row
        label="Position side"
        value={isLong ? 'Profit if price rises' : 'Profit if price falls'}
        valueClass={isLong ? 'text-[#22c55e] text-xs' : 'text-[#ef4444] text-xs'}
      />

      <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between">
        <span className="text-white/20 text-[10px] font-mono uppercase tracking-widest">
          Order Preview
        </span>
        <span className="text-white/20 text-[10px] font-mono">via TradeXYZ</span>
      </div>
    </div>
  )
}

function Screen5({
  asset, direction, leverage, price,
  pricesStatus,
  fundingRate, fundingError,
  aiData, aiError,
  onRestart,
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const isLong = direction === 'long'

  const handleShare = () => {
    const tweet =
      `Just set up my first perp trade with @tradexyz — going ${
        isLong ? 'LONG' : 'SHORT'
      } on ${asset?.label} at ${leverage}x 🚀 Built with @AnthropicAI #FirstPerp #TradeXYZ`
    navigator.clipboard.writeText(tweet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col px-5 pt-6 pb-12">
      {/* Trade header */}
      <div className="text-center mb-5">
        <div className="flex items-center justify-center gap-2.5 mb-2">
          <span className="text-3xl leading-none">{asset?.emoji}</span>
          <h1 className="text-2xl font-extrabold tracking-tight">{asset?.label}</h1>
          <span
            className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider border"
            style={
              isLong
                ? { background: 'rgba(34,197,94,0.12)', color: '#22c55e', borderColor: 'rgba(34,197,94,0.35)' }
                : { background: 'rgba(239,68,68,0.12)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.35)' }
            }
          >
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
        </div>
        <p className="text-white/40 text-sm font-medium">
          {leverage}x multiplier · Your summary is ready
        </p>
      </div>

      {/* Price + Holding Cost row */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1.5">
            <PriceDot status={pricesStatus} />
            <span className="text-white/45 text-[11px] uppercase tracking-[0.15em] font-semibold">
              {pricesStatus === 'delayed' ? 'Price (delayed)' : 'Live Price'}
            </span>
          </div>
          <div className="text-[#f59e0b] font-mono font-extrabold text-xl tracking-tight">
            {price ? formatPrice(price) : '--'}
          </div>
        </div>

        {!fundingError && (
          <div className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 text-center">
            <div className="flex items-center justify-center gap-1 mb-1.5">
              <span className="text-white/45 text-[11px] uppercase tracking-[0.15em] font-semibold">
                Holding Cost
              </span>
              <button
                onClick={() => setTooltipOpen((v) => !v)}
                className="w-4 h-4 rounded-full border border-white/25 text-white/35 text-[10px] flex items-center justify-center hover:text-white/60 hover:border-white/50 transition-colors"
              >
                ?
              </button>
            </div>
            <div className="text-white font-mono font-extrabold text-xl tracking-tight">
              {fundingRate !== null ? `${fundingRate}%` : '--'}
            </div>
            <div className="text-white/30 text-[11px]">per 8 hours</div>
          </div>
        )}
      </div>

      {/* Holding cost tooltip */}
      {tooltipOpen && !fundingError && (
        <div className="mb-4 bg-white/[0.07] border border-white/15 rounded-xl p-3.5 text-sm text-white/75 leading-relaxed">
          <span className="text-white font-semibold">What's a holding cost?</span>{' '}
          When you hold a perp (a trade with no expiry date), a small fee is exchanged every 8 hours
          between people betting up and people betting down — this keeps the perp price in line
          with the real market price.
        </div>
      )}

      {/* AI Cards */}
      <div className="flex flex-col gap-3 mb-6">
        {aiError ? (
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5 text-center">
            <p className="text-2xl mb-2">🤔</p>
            <p className="text-white/60 text-sm leading-relaxed">
              Couldn't load AI summary — but your trade setup looks good!
            </p>
          </div>
        ) : !aiData ? (
          <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#f59e0b] pulse-dot-1" />
              <span className="text-white/40 text-sm">Loading AI analysis...</span>
            </div>
          </div>
        ) : (
          <>
            <AICard icon="🧠" title="What you're betting on" text={aiData.thesis} />
            <AICard icon="⚠️" title="What could go wrong" text={aiData.risk} />
            <AICard icon="💡" title="What's a perp?" text={aiData.perpExplain} />
            <AICard icon="📊" title="Current market vibe" text={aiData.marketVibe} />
          </>
        )}
      </div>

      {/* Trade ticket */}
      <TradeTicket asset={asset} direction={direction} leverage={leverage} price={price} />

      {/* Share button */}
      <button
        onClick={handleShare}
        className="w-full mb-4 rounded-2xl py-3.5 min-h-[56px] font-semibold text-sm border border-white/[0.12] bg-white/[0.04] hover:bg-white/[0.08] transition-all duration-150 active:scale-[0.97]"
      >
        {copied ? (
          <span className="text-[#22c55e] font-bold flex items-center justify-center gap-2">
            <span>✓</span> Copied to clipboard!
          </span>
        ) : (
          <span className="text-white/80 flex items-center justify-center gap-2">
            Share Your Trade 📤
          </span>
        )}
      </button>

      {/* CTAs */}
      <div className="flex flex-col gap-3 mb-6">
        <a
          href="https://app.trade.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full bg-[#22c55e] text-black font-extrabold text-lg rounded-2xl py-4 min-h-[64px] flex items-center justify-center active:scale-[0.97] hover:bg-[#4ade80] text-center glow-green"
        >
          Open This Trade on TradeXYZ →
        </a>
        <a
          href="https://app.hyperliquid.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full bg-white/[0.06] text-white font-semibold text-base rounded-2xl py-4 min-h-[64px] flex items-center justify-center transition-all duration-150 active:scale-[0.97] hover:bg-white/[0.1] border border-white/[0.12] text-center"
        >
          Practice First (No Real Money) →
        </a>
      </div>

      {/* Start over */}
      <button
        onClick={onRestart}
        className="text-white/25 text-sm text-center w-full hover:text-white/45 transition-colors"
      >
        ← Start over
      </button>

      <p className="text-center text-white/20 text-[11px] mt-6 leading-relaxed">
        Powered by Anthropic Claude · Data by Finnhub · Built for TradeXYZ
      </p>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [splash, setSplash] = useState(true)
  const [splashVisible, setSplashVisible] = useState(true)
  const [screen, setScreen] = useState(0)
  const [visible, setVisible] = useState(true)
  const [presentMode, setPresentMode] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [direction, setDirection] = useState(null)
  const [leverage, setLeverage] = useState(3)
  const [prices, setPrices] = useState({})
  const [pricesStatus, setPricesStatus] = useState('loading')
  const [tickerFunding, setTickerFunding] = useState(null)
  const [fundingRate, setFundingRate] = useState(null)
  const [fundingError, setFundingError] = useState(false)
  const [aiData, setAiData] = useState(null)
  const [aiError, setAiError] = useState(false)

  // Splash: fade out at 1.2s, unmount at 1.7s
  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashVisible(false), 1200)
    const unmountTimer = setTimeout(() => setSplash(false), 1700)
    return () => { clearTimeout(fadeTimer); clearTimeout(unmountTimer) }
  }, [])

  // Prices + ticker funding rate on mount
  useEffect(() => {
    fetchPrices().then((p) => {
      setPrices(p)
      setPricesStatus(Object.values(p).some((v) => v !== null) ? 'ok' : 'delayed')
    })
    fetchFundingRate('SPY').then(setTickerFunding).catch(() => {})
  }, [])

  const goToScreen = useCallback((next) => {
    setVisible(false)
    setTimeout(() => {
      setScreen(next)
      setVisible(true)
    }, 280)
  }, [])

  const handleAssetSelect = (asset) => {
    setSelectedAsset(asset)
    goToScreen(1)
  }

  const handleDirectionSelect = (dir) => {
    setDirection(dir)
    goToScreen(2)
  }

  const handleSubmitTrade = useCallback(async () => {
    setFundingRate(null)
    setFundingError(false)
    setAiData(null)
    setAiError(false)
    goToScreen(3)

    const minDelay = new Promise((r) => setTimeout(r, 1600))

    const [fundingResult, aiResult] = await Promise.allSettled([
      fetchFundingRate(selectedAsset.hlSymbol),
      fetchAISummary(selectedAsset.label, direction, leverage),
    ])

    if (fundingResult.status === 'fulfilled') {
      setFundingRate(fundingResult.value)
    } else {
      console.warn('Hyperliquid error:', fundingResult.reason)
      setFundingError(true)
    }

    if (aiResult.status === 'fulfilled') {
      setAiData(aiResult.value)
    } else {
      console.warn('Anthropic error:', aiResult.reason)
      setAiError(true)
    }

    await minDelay
    goToScreen(4)
  }, [selectedAsset, direction, leverage, goToScreen])

  const handleRestart = () => {
    setSelectedAsset(null)
    setDirection(null)
    setLeverage(3)
    setFundingRate(null)
    setFundingError(false)
    setAiData(null)
    setAiError(false)
    goToScreen(0)
  }

  const showDots = screen <= 2
  const maxWidth = presentMode ? '480px' : '390px'
  const fontSize = presentMode ? '120%' : '100%'

  return (
    <div
      className="min-h-screen flex items-start md:items-center justify-center md:py-8"
      style={{ background: '#0f0f0f', fontFamily: "'Inter', system-ui, sans-serif", fontSize }}
    >
      {/* Splash overlay */}
      {splash && <SplashScreen visible={splashVisible} />}

      {/* Presentation toggle */}
      <PresentToggle active={presentMode} onToggle={() => setPresentMode((v) => !v)} />

      {/* Phone frame — full-screen on mobile, bordered card on desktop */}
      <div
        className="w-full min-h-screen md:min-h-0 md:max-h-[88vh] md:rounded-3xl md:border md:border-zinc-800 md:overflow-y-auto flex flex-col relative"
        style={{
          maxWidth,
          transition: 'max-width 0.3s ease',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.03), 0 32px 80px rgba(0,0,0,0.7)',
        }}
      >
        {/* Ticker tape — always visible */}
        <TickerTape prices={prices} tickerFunding={tickerFunding} />

        {/* Progress dots */}
        {showDots && <ProgressDots screen={screen} />}

        {/* Screen container */}
        <div
          className="flex-1 flex flex-col"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.28s ease, transform 0.28s ease',
          }}
        >
          {screen === 0 && <Screen1 prices={prices} pricesStatus={pricesStatus} onSelect={handleAssetSelect} />}
          {screen === 1 && <Screen2 asset={selectedAsset} onSelect={handleDirectionSelect} />}
          {screen === 2 && (
            <Screen3 leverage={leverage} setLeverage={setLeverage} onContinue={handleSubmitTrade} />
          )}
          {screen === 3 && <Screen4 />}
          {screen === 4 && (
            <Screen5
              asset={selectedAsset}
              direction={direction}
              leverage={leverage}
              price={prices[selectedAsset?.id]}
              pricesStatus={pricesStatus}
              fundingRate={fundingRate}
              fundingError={fundingError}
              aiData={aiData}
              aiError={aiError}
              onRestart={handleRestart}
            />
          )}
        </div>
      </div>
    </div>
  )
}
