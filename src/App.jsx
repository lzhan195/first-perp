import { useState, useEffect, useCallback } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSETS = [
  { id: 'spy', label: 'S&P 500', emoji: '📈', ticker: 'SPY',  hlSymbol: 'SPX'   },
  { id: 'uso', label: 'Oil',     emoji: '🛢️', ticker: 'USO',  hlSymbol: 'USOIL' },
  { id: 'gld', label: 'Gold',    emoji: '🥇', ticker: 'GLD',  hlSymbol: 'GOLD'  },
]

function getTradeLinks(asset) {
  const map = {
    'S&P 500': {
      tradexyz:    'https://app.trade.xyz/?market=SP500',
      hyperliquid: 'https://app.hyperliquid.xyz/trade/xyz:SP500',
    },
    'Gold': {
      tradexyz:    'https://app.trade.xyz/?market=GOLD',
      hyperliquid: 'https://app.hyperliquid.xyz/trade/xyz:GOLD',
    },
    'Oil': {
      tradexyz:    'https://app.trade.xyz/?market=CL',
      hyperliquid: 'https://app.hyperliquid.xyz/trade/xyz:CL',
    },
  }
  return map[asset?.label] ?? { tradexyz: 'https://app.trade.xyz', hyperliquid: 'https://app.hyperliquid.xyz' }
}

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
  if (!Array.isArray(payload) || payload.length < 2) throw new Error('Unexpected shape')
  const [meta, assetCtxs] = payload

  // meta is { universe: [...] }, assetCtxs is a flat array
  const universe = Array.isArray(meta) ? meta : meta.universe
  console.log('[HL] Available asset names:', universe.map((a) => a.name))

  const idx = universe.findIndex((a) => a.name === hlSymbol)
  if (idx === -1 || !assetCtxs[idx]) {
    console.warn(`[HL] "${hlSymbol}" not found — falling back to default rate`)
    return '0.0100'
  }

  const raw = parseFloat(assetCtxs[idx].funding)
  console.log(`[HL] ${hlSymbol} raw funding: ${assetCtxs[idx].funding}`)
  if (!isFinite(raw)) {
    console.warn(`[HL] "${hlSymbol}" funding is not a finite number — falling back`)
    return '0.0100'
  }
  // raw === 0 is a valid rate — don't skip it
  return (raw * 100).toFixed(4)
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

  console.log('[AI] Firing fetch to http://localhost:3001/api/chat ...')

  let res
  try {
    res = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (err) {
    console.error('[AI] Fetch threw (network/CORS error):', err)
    throw err
  }

  console.log('[AI] Response received — status:', res.status)

  if (!res.ok) throw new Error(`Proxy error: ${res.status}`)
  const data = await res.json()
  console.log('[AI] Full API response:', JSON.stringify(data, null, 2))

  const text = data?.content?.[0]?.text?.trim() ?? ''

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
  console.warn('[AI] Could not parse JSON from response — using placeholder')
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
        className="inline-block w-1.5 h-1.5 rounded-full bg-[#00c805] flex-shrink-0"
        style={{ boxShadow: '0 0 5px #00c805' }}
        title="Live price"
      />
    )
  }
  if (status === 'delayed') {
    return <span className="text-gray-400 text-[10px] font-medium">delayed</span>
  }
  return <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-300 flex-shrink-0" />
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

function SplashScreen({ visible }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: '#ffffff',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div className="relative text-center px-8">
        <div className="text-5xl font-extrabold tracking-tight text-[#1a1a1a] mb-3">
          First Perp
        </div>
        <p className="text-gray-400 text-lg font-medium mb-10">
          Your first trade, explained.
        </p>

        {/* Loading bar */}
        <div className="mt-4 w-32 h-0.5 bg-gray-200 rounded-full mx-auto overflow-hidden">
          <div
            className="h-full bg-[#00c805] rounded-full"
            style={{ animation: 'splash-bar 1.4s ease-out forwards' }}
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
  const content = text.repeat(4)

  return (
    <div
      className="overflow-hidden border-b border-gray-100"
      style={{ background: '#f5f5f5', height: '30px' }}
    >
      <div
        className="flex items-center h-full whitespace-nowrap"
        style={{ animation: 'ticker-scroll 28s linear infinite' }}
      >
        <span className="text-gray-400 text-[11px] font-mono tracking-wide pr-4">
          {content}
        </span>
        <span className="text-gray-400 text-[11px] font-mono tracking-wide pr-4" aria-hidden>
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
        background: active ? 'rgba(0,200,5,0.1)' : 'rgba(0,0,0,0.05)',
        border: `1px solid ${active ? 'rgba(0,200,5,0.4)' : 'rgba(0,0,0,0.1)'}`,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="9" rx="1.5"
          stroke={active ? '#00c805' : 'rgba(0,0,0,0.4)'} strokeWidth="1.5" />
        <line x1="8" y1="13" x2="8" y2="16"
          stroke={active ? '#00c805' : 'rgba(0,0,0,0.4)'} strokeWidth="1.5" />
        <line x1="5" y1="16" x2="11" y2="16"
          stroke={active ? '#00c805' : 'rgba(0,0,0,0.4)'} strokeWidth="1.5" />
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
            background: i <= filled ? '#00c805' : '#d1d5db',
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
        <p className="text-[#00c805] text-xs uppercase tracking-[0.2em] font-semibold mb-2">
          Step 1 of 3
        </p>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-[#1a1a1a]">
          Your first trade starts<br />with a hunch.
        </h1>
        <p className="text-gray-400 mt-2 text-sm">
          What do you think will move?
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {ASSETS.map((asset) => (
          <button
            key={asset.id}
            onClick={() => onSelect(asset)}
            className="flex items-center justify-between bg-white border border-gray-200 rounded-2xl px-5 py-5 min-h-[72px] transition-all duration-150 active:scale-[0.97] hover:border-[#00c805] hover:shadow-sm"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-[2rem] leading-none">{asset.emoji}</span>
              <div className="text-left">
                <div className="text-base font-bold text-[#1a1a1a]">{asset.label}</div>
                <div className="text-gray-400 text-xs">{asset.ticker}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[#00c805] font-mono font-bold text-xl tracking-tight">
                {prices[asset.id]
                  ? formatPrice(prices[asset.id])
                  : <span className="text-gray-300 text-base">--</span>}
              </div>
              <div className="flex items-center justify-end gap-1 mt-0.5">
                <PriceDot status={pricesStatus} />
                <span className="text-gray-400 text-xs">
                  {pricesStatus === 'delayed' ? '' : 'live'}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="text-center text-gray-300 text-xs mt-6">
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
        <p className="text-[#00c805] text-xs uppercase tracking-[0.2em] font-semibold mb-2">
          Step 2 of 3
        </p>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-[#1a1a1a]">
          Which way are you betting?
        </h1>
        <div className="flex items-center justify-center gap-2 mt-3">
          <span className="text-lg">{asset?.emoji}</span>
          <span className="text-gray-400 text-sm font-medium">
            You picked <span className="text-[#1a1a1a] font-semibold">{asset?.label}</span>
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <button
          onClick={() => onSelect('long')}
          className="flex flex-col items-center justify-center bg-white border-2 border-[#22c55e]/40 rounded-2xl px-5 py-8 min-h-[130px] transition-all duration-150 active:scale-[0.97] hover:border-[#22c55e] hover:bg-[#22c55e]/[0.04]"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        >
          <span className="text-4xl mb-2 leading-none">🟢</span>
          <span className="text-xl font-extrabold text-[#22c55e] tracking-tight">It's going UP</span>
          <span className="text-gray-400 text-sm mt-1.5">You profit if price rises</span>
        </button>

        <button
          onClick={() => onSelect('short')}
          className="flex flex-col items-center justify-center bg-white border-2 border-[#ef4444]/40 rounded-2xl px-5 py-8 min-h-[130px] transition-all duration-150 active:scale-[0.97] hover:border-[#ef4444] hover:bg-[#ef4444]/[0.04]"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        >
          <span className="text-4xl mb-2 leading-none">🔴</span>
          <span className="text-xl font-extrabold text-[#ef4444] tracking-tight">It's going DOWN</span>
          <span className="text-gray-400 text-sm mt-1.5">You profit if price falls</span>
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
        <p className="text-[#00c805] text-xs uppercase tracking-[0.2em] font-semibold mb-2">
          Step 3 of 3
        </p>
        <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-[#1a1a1a]">
          How bold are you feeling?
        </h1>
        <p className="text-gray-400 mt-2 text-sm">
          Your multiplier amplifies gains — and losses.
        </p>
      </div>

      {/* Slider card */}
      <div className="bg-[#f5f5f5] rounded-2xl p-5 mb-4" style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center justify-between mb-1">
          <div>
            <span className="text-gray-500 text-sm font-medium">Multiplier</span>
            <span className="text-gray-300 text-xs ml-2">(called "leverage" on exchanges)</span>
          </div>
          <span className="text-[#00c805] font-extrabold text-3xl tracking-tight">
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
            background: `linear-gradient(to right, #00c805 ${pct}%, #d1d5db ${pct}%)`,
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
                style={{ background: v <= leverage ? '#00c805' : '#d1d5db' }}
              />
              {(v === 1 || v === 5 || v === 10) && (
                <span
                  className="text-[10px] font-medium transition-colors"
                  style={{ color: v <= leverage ? '#00c805' : '#9ca3af' }}
                >
                  {v}x
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          className="mt-4 text-center py-3 rounded-xl text-sm font-semibold text-[#1a1a1a]"
          style={{ background: 'rgba(0,0,0,0.04)' }}
        >
          {getLeverageLabel(leverage)}
        </div>
      </div>

      {/* Example card */}
      <div className="bg-[#f5f5f5] rounded-2xl p-5 mb-5" style={{ boxShadow: '0 1px 6px rgba(0,0,0,0.06)' }}>
        <p className="text-gray-400 text-xs uppercase tracking-wider mb-2 font-medium">
          Live Example
        </p>
        <p className="text-sm text-gray-600 leading-relaxed">
          With <span className="text-[#1a1a1a] font-bold">$100</span> and a{' '}
          <span className="text-[#00c805] font-bold">{leverage}x</span> multiplier,
          a 5% move = <span className="font-bold text-[#1a1a1a]">${pnl}</span> profit or loss.
        </p>
        <div className="flex gap-4 mt-3">
          <div className="flex-1 bg-[#22c55e]/10 border border-[#22c55e]/25 rounded-xl py-3 text-center">
            <div className="text-[#22c55e] font-extrabold text-xl">+${pnl}</div>
            <div className="text-gray-400 text-xs mt-0.5">if right</div>
          </div>
          <div className="flex-1 bg-[#ef4444]/10 border border-[#ef4444]/25 rounded-xl py-3 text-center">
            <div className="text-[#ef4444] font-extrabold text-xl">-${pnl}</div>
            <div className="text-gray-400 text-xs mt-0.5">if wrong</div>
          </div>
        </div>
      </div>

      <button
        onClick={onContinue}
        className="w-full bg-[#00c805] text-white font-extrabold text-lg rounded-full py-4 min-h-[64px] transition-all duration-150 active:scale-[0.97] hover:bg-[#00b004] shadow-lg"
        style={{ boxShadow: '0 4px 20px rgba(0,200,5,0.25)' }}
      >
        Build My Trade Summary →
      </button>
    </div>
  )
}

// ─── Screen 4 — Loading ───────────────────────────────────────────────────────

function Screen4() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-5 gap-6 rounded-2xl mx-3 my-4 bg-[#f5f5f5]">
      <div className="flex gap-3">
        <div className="w-3 h-3 rounded-full bg-[#00c805] pulse-dot-1" />
        <div className="w-3 h-3 rounded-full bg-[#00c805] pulse-dot-2" />
        <div className="w-3 h-3 rounded-full bg-[#00c805] pulse-dot-3" />
      </div>
      <div className="text-center">
        <p className="text-[#1a1a1a] font-semibold text-lg">Building your trade summary...</p>
        <p className="text-gray-400 text-sm mt-1">Asking Claude for analysis</p>
      </div>
    </div>
  )
}

// ─── Screen 5 — Summary ───────────────────────────────────────────────────────

function AICard({ label, text, accentColor }) {
  return (
    <div
      className="bg-[#f5f5f5] rounded-xl px-4 py-3"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gray-400 mb-1.5 font-mono">
        {label}
      </div>
      <p className="text-[13px] text-[#1a1a1a] leading-snug">{text}</p>
    </div>
  )
}

function TradeTicket({ asset, direction, leverage, price, fundingRate, fundingError, pricesStatus }) {
  const isLong = direction === 'long'
  const accentColor = isLong ? '#00c805' : '#ef4444'
  const liquidationPrice = price
    ? isLong
      ? price - price / leverage
      : price + price / leverage
    : null

  return (
    <div className="rounded-2xl overflow-hidden mb-1" style={{ background: '#1a1a1a' }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <div className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-mono mb-2">
          Your Trade Setup
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{asset?.emoji}</span>
            <span className="text-white font-bold text-base tracking-tight">{asset?.label}</span>
          </div>
          <span
            className="px-2.5 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider"
            style={{ background: isLong ? 'rgba(0,200,5,0.15)' : 'rgba(239,68,68,0.15)', color: accentColor }}
          >
            {isLong ? '▲ LONG' : '▼ SHORT'}
          </span>
        </div>
      </div>

      {/* Two-column grid — top row */}
      <div className="grid grid-cols-2 divide-x divide-white/[0.07] border-b border-white/[0.07]">
        <div className="px-4 py-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-mono mb-1">
            Entry Price
          </div>
          <div className="flex items-center gap-1.5">
            <PriceDot status={pricesStatus} />
            <span className="text-white font-mono font-bold text-xl tracking-tight">
              {price ? formatPrice(price) : '--'}
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-mono mb-1">
            Leverage
          </div>
          <span className="font-mono font-bold text-xl tracking-tight" style={{ color: accentColor }}>
            {leverage}×
          </span>
        </div>
      </div>

      {/* Two-column grid — bottom row */}
      <div className="grid grid-cols-2 divide-x divide-white/[0.07]">
        <div className="px-4 py-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-mono mb-1">
            Est. Liquidation
          </div>
          <span className="text-white font-mono font-semibold text-base tracking-tight">
            {liquidationPrice ? formatPrice(liquidationPrice) : '--'}
          </span>
        </div>
        <div className="px-4 py-3">
          <div className="text-[10px] text-gray-500 uppercase tracking-[0.15em] font-mono mb-1">
            Holding Cost
          </div>
          <span className="text-white font-mono font-semibold text-base tracking-tight">
            {fundingRate !== null ? `${fundingRate}%` : '0.0100%'}
          </span>
          <span className="text-gray-500 text-[10px] ml-1">/ 8hr</span>
        </div>
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
  const isLong = direction === 'long'
  const accentColor = isLong ? '#00c805' : '#ef4444'

  return (
    <div className="flex flex-col px-4 pt-5 pb-10 gap-3">

      {/* Trade Ticket */}
      <TradeTicket
        asset={asset}
        direction={direction}
        leverage={leverage}
        price={price}
        pricesStatus={pricesStatus}
        fundingRate={fundingRate}
        fundingError={fundingError}
      />

      {/* Credibility line */}
      <p className="text-[10px] text-gray-400 font-mono px-0.5">
        Live data · Prices update every 30s
      </p>

      {/* AI Cards */}
      <div className="flex flex-col gap-2">
        {aiError ? (
          <div className="bg-[#f5f5f5] rounded-xl px-4 py-3 border-l-[3px] border-gray-300">
            <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gray-400 mb-1.5 font-mono">Analysis</div>
            <p className="text-[13px] text-gray-500 leading-snug">AI analysis unavailable — your trade parameters are set above.</p>
          </div>
        ) : !aiData ? (
          <div className="bg-[#f5f5f5] rounded-xl px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#00c805] pulse-dot-1" />
              <span className="text-[13px] text-gray-400 font-mono">Loading analysis...</span>
            </div>
          </div>
        ) : (
          <>
            <AICard label="Thesis" text={aiData.thesis} accentColor={accentColor} />
            <AICard label="Risk" text={aiData.risk} accentColor={accentColor} />
            <AICard label="Market" text={aiData.marketVibe} accentColor={accentColor} />
            <AICard label="What is a Perp" text={aiData.perpExplain} accentColor="#9ca3af" />
          </>
        )}
      </div>

      {/* CTA buttons */}
      <div className="flex flex-col gap-2 mt-1">
        {(() => {
          const links = getTradeLinks(asset)
          return (
            <>
              <a
                href={links.tradexyz}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-[#1a1a1a] text-white font-bold text-sm rounded-xl py-4 flex items-center justify-center transition-all duration-150 active:scale-[0.97] hover:bg-black"
              >
                Open on TradeXYZ →
              </a>
              <a
                href={links.hyperliquid}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-white text-gray-500 font-semibold text-sm rounded-xl py-4 flex items-center justify-center transition-all duration-150 active:scale-[0.97] hover:bg-gray-50 border border-gray-200"
              >
                Practice on Hyperliquid →
              </a>
            </>
          )
        })()}
      </div>

      {/* Start over */}
      <button
        onClick={onRestart}
        className="text-gray-300 text-xs text-center w-full hover:text-gray-500 transition-colors pt-1"
      >
        ← Start over
      </button>
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
      style={{ background: '#f0f0f0', fontFamily: "'Inter', system-ui, sans-serif", fontSize }}
    >
      {/* Splash overlay */}
      {splash && <SplashScreen visible={splashVisible} />}

      {/* Presentation toggle */}
      <PresentToggle active={presentMode} onToggle={() => setPresentMode((v) => !v)} />

      {/* Phone frame — full-screen on mobile, bordered card on desktop */}
      <div
        className="w-full min-h-screen md:min-h-0 md:max-h-[88vh] md:rounded-3xl md:border md:border-gray-100 md:overflow-y-auto flex flex-col relative bg-white"
        style={{
          maxWidth,
          transition: 'max-width 0.3s ease',
          boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
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
