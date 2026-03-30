import { useState, useEffect, useCallback } from 'react'

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSETS = [
  { id: 'spy', label: 'S&P 500', ticker: 'SPY',  hlSymbol: 'SPY'   },
  { id: 'uso', label: 'Oil',     ticker: 'USO',  hlSymbol: 'USOIL' },
  { id: 'gld', label: 'Gold',    ticker: 'GLD',  hlSymbol: 'GOLD'  },
]

function getLeverageLabel(lev) {
  if (lev <= 2) return 'Conservative — good for beginners'
  if (lev <= 5) return 'Moderate — some risk'
  return 'Aggressive — high risk'
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
  const idx = meta.universe.findIndex((a) => a.name === hlSymbol)
  if (idx === -1 || !assetCtxs[idx]) throw new Error('Asset not found')
  const rate = parseFloat(assetCtxs[idx].funding)
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

  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch (_) { /* fall through */ }

  const start = text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch (_) { /* fall through */ }
  }

  return {
    thesis:      "This asset has been moving on macro trends and investor sentiment. Your direction reflects a view on near-term price momentum.",
    risk:        "Markets can reverse quickly on unexpected news or data releases. Leveraged trades can close automatically if price moves against you.",
    perpExplain: "A perp is a bet on whether a price goes up or down — it never expires, so you can hold it as long as you want (while paying a small fee every 8 hours).",
    marketVibe:  "Conditions are mixed — watch for any major economic announcements before entering.",
  }
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

function SplashScreen({ visible }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.5s ease',
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div className="text-center px-8">
        <div className="text-4xl font-extrabold tracking-tight text-[#1a1a1a] mb-2">
          First Perp
        </div>
        <p className="text-[#737373] text-base font-medium mb-10">
          Your first trade, explained.
        </p>
        <div className="w-24 h-0.5 bg-[#e5e5e5] rounded-full mx-auto overflow-hidden">
          <div
            className="h-full bg-[#00C805] rounded-full"
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
    <div className="overflow-hidden border-b border-[#e5e5e5] bg-[#f5f5f5]" style={{ height: '28px' }}>
      <div
        className="flex items-center h-full whitespace-nowrap"
        style={{ animation: 'ticker-scroll 28s linear infinite' }}
      >
        <span className="text-[#737373] text-[11px] font-mono tracking-wide pr-4">{content}</span>
        <span className="text-[#737373] text-[11px] font-mono tracking-wide pr-4" aria-hidden>{content}</span>
      </div>
    </div>
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
            width: i === filled ? '20px' : '6px',
            height: '6px',
            background: i <= filled ? '#00C805' : '#e5e5e5',
          }}
        />
      ))}
    </div>
  )
}

// ─── Divider ──────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="h-px bg-[#e5e5e5] mx-5" />
}

// ─── Screen 1 — Asset Selection ───────────────────────────────────────────────

function Screen1({ prices, pricesStatus, onSelect }) {
  return (
    <div className="flex flex-col px-5 pt-6 pb-10">
      <p className="text-[#00C805] text-xs font-semibold uppercase tracking-widest mb-3">
        Step 1 of 3
      </p>
      <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight text-balance mb-1">
        What do you think will move?
      </h1>
      <p className="text-[#737373] text-sm mb-8">
        Pick an asset to start your first perp trade.
      </p>

      <div className="flex flex-col">
        {ASSETS.map((asset, i) => (
          <div key={asset.id}>
            {i > 0 && <Divider />}
            <button
              onClick={() => onSelect(asset)}
              className="flex items-center justify-between w-full px-0 py-4 transition-colors duration-150 active:bg-[#f5f5f5] group"
            >
              <div className="text-left">
                <div className="text-base font-semibold text-[#1a1a1a] group-hover:text-[#00C805] transition-colors">
                  {asset.label}
                </div>
                <div className="text-[#737373] text-xs mt-0.5">{asset.ticker}</div>
              </div>
              <div className="text-right">
                <div className="text-[#1a1a1a] font-mono font-bold text-base">
                  {prices[asset.id] ? formatPrice(prices[asset.id]) : <span className="text-[#737373]">--</span>}
                </div>
                <div className="text-[#737373] text-xs mt-0.5">
                  {pricesStatus === 'ok' ? 'live' : pricesStatus === 'delayed' ? 'delayed' : ''}
                </div>
              </div>
            </button>
          </div>
        ))}
      </div>

      <p className="text-center text-[#b3b3b3] text-xs mt-8">
        Simulation only — no real money involved.
      </p>
    </div>
  )
}

// ─── Screen 2 — Direction ─────────────────────────────────────────────────────

function Screen2({ asset, onSelect }) {
  return (
    <div className="flex flex-col px-5 pt-6 pb-10">
      <p className="text-[#00C805] text-xs font-semibold uppercase tracking-widest mb-3">
        Step 2 of 3
      </p>
      <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight text-balance mb-1">
        Which way are you betting?
      </h1>
      <p className="text-[#737373] text-sm mb-8">
        You picked <span className="text-[#1a1a1a] font-medium">{asset?.label}</span>. Now choose a direction.
      </p>

      <div className="flex flex-col gap-3">
        <button
          onClick={() => onSelect('long')}
          className="flex items-center justify-between border border-[#e5e5e5] rounded-xl px-5 py-5 transition-all duration-150 active:scale-[0.98] hover:border-[#00C805] hover:bg-[#f0fff0] group"
        >
          <div className="text-left">
            <div className="text-base font-bold text-[#1a1a1a] group-hover:text-[#00C805] transition-colors">
              Going Up
            </div>
            <div className="text-[#737373] text-sm mt-0.5">You profit if price rises</div>
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
            style={{ background: '#00C805' }}
          >
            ↑
          </div>
        </button>

        <button
          onClick={() => onSelect('short')}
          className="flex items-center justify-between border border-[#e5e5e5] rounded-xl px-5 py-5 transition-all duration-150 active:scale-[0.98] hover:border-[#ef4444] hover:bg-[#fff5f5] group"
        >
          <div className="text-left">
            <div className="text-base font-bold text-[#1a1a1a] group-hover:text-[#ef4444] transition-colors">
              Going Down
            </div>
            <div className="text-[#737373] text-sm mt-0.5">You profit if price falls</div>
          </div>
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
            style={{ background: '#ef4444' }}
          >
            ↓
          </div>
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
    <div className="flex flex-col px-5 pt-6 pb-10">
      <p className="text-[#00C805] text-xs font-semibold uppercase tracking-widest mb-3">
        Step 3 of 3
      </p>
      <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight text-balance mb-1">
        How bold are you feeling?
      </h1>
      <p className="text-[#737373] text-sm mb-8">
        Your multiplier amplifies both gains and losses.
      </p>

      {/* Slider */}
      <div className="mb-6">
        <div className="flex items-end justify-between mb-4">
          <span className="text-[#737373] text-sm font-medium">Multiplier</span>
          <span className="text-[#1a1a1a] font-extrabold text-3xl tracking-tight">
            {leverage}<span className="text-xl font-bold">x</span>
          </span>
        </div>

        <input
          type="range"
          min="1"
          max="10"
          step="1"
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full"
          style={{
            background: `linear-gradient(to right, #00C805 ${pct}%, #e5e5e5 ${pct}%)`,
          }}
        />

        <div className="flex justify-between mt-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => (
            <div
              key={v}
              className="flex flex-col items-center gap-1 cursor-pointer"
              onClick={() => setLeverage(v)}
            >
              <div
                className="w-0.5 h-1.5 rounded-full transition-all"
                style={{ background: v <= leverage ? '#00C805' : '#e5e5e5' }}
              />
              {(v === 1 || v === 5 || v === 10) && (
                <span
                  className="text-[10px] font-medium"
                  style={{ color: v <= leverage ? '#00C805' : '#b3b3b3' }}
                >
                  {v}x
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 text-center py-2.5 rounded-lg bg-[#f5f5f5] text-[#737373] text-sm font-medium">
          {getLeverageLabel(leverage)}
        </div>
      </div>

      <Divider />

      {/* Example */}
      <div className="py-5 mb-6">
        <p className="text-[#737373] text-xs uppercase tracking-widest font-medium mb-3">
          Example
        </p>
        <p className="text-sm text-[#1a1a1a] mb-3 leading-relaxed">
          With <span className="font-bold">$100</span> and{' '}
          <span className="font-bold text-[#1a1a1a]">{leverage}x</span> multiplier,
          a 5% move equals:
        </p>
        <div className="flex gap-3">
          <div className="flex-1 border border-[#e5e5e5] rounded-xl py-3.5 text-center">
            <div className="text-[#00C805] font-bold text-lg">+${pnl}</div>
            <div className="text-[#737373] text-xs mt-0.5">if right</div>
          </div>
          <div className="flex-1 border border-[#e5e5e5] rounded-xl py-3.5 text-center">
            <div className="text-[#ef4444] font-bold text-lg">-${pnl}</div>
            <div className="text-[#737373] text-xs mt-0.5">if wrong</div>
          </div>
        </div>
      </div>

      <button
        onClick={onContinue}
        className="w-full bg-[#00C805] text-white font-bold text-base rounded-xl py-4 transition-all duration-150 active:scale-[0.98] hover:bg-[#00a804]"
      >
        Build My Trade Summary
      </button>
    </div>
  )
}

// ─── Screen 4 — Loading ───────────────────────────────────────────────────────

function Screen4() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-5 gap-5">
      <div className="flex gap-2.5">
        <div className="w-2.5 h-2.5 rounded-full bg-[#00C805] pulse-dot-1" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#00C805] pulse-dot-2" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#00C805] pulse-dot-3" />
      </div>
      <div className="text-center">
        <p className="text-[#1a1a1a] font-semibold text-base">Building your trade summary...</p>
        <p className="text-[#737373] text-sm mt-1">Asking Claude for analysis</p>
      </div>
    </div>
  )
}

// ─── Screen 5 — Summary ───────────────────────────────────────────────────────

function AICard({ title, text }) {
  return (
    <div className="py-4">
      <p className="text-[#737373] text-xs uppercase tracking-widest font-medium mb-2">{title}</p>
      <p className="text-sm text-[#1a1a1a] leading-relaxed">{text}</p>
    </div>
  )
}

function TradeTicket({ asset, direction, leverage, price }) {
  const isLong = direction === 'long'
  const autoClosePrice = price
    ? isLong
      ? price - price / leverage
      : price + price / leverage
    : null

  const Row = ({ label, value, sub, valueStyle = {} }) => (
    <div className="flex items-center justify-between py-3 border-b border-[#e5e5e5] last:border-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[#737373] text-sm">{label}</span>
        {sub && <span className="text-[#b3b3b3] text-xs">({sub})</span>}
      </div>
      <span className="text-sm font-semibold text-[#1a1a1a]" style={valueStyle}>{value}</span>
    </div>
  )

  return (
    <div className="border border-[#e5e5e5] rounded-xl overflow-hidden mb-5">
      {/* Header */}
      <div className="px-4 py-3 bg-[#f5f5f5] border-b border-[#e5e5e5] flex items-center justify-between">
        <span className="font-semibold text-sm text-[#1a1a1a]">{asset?.label}</span>
        <div className="flex items-center gap-2">
          <span
            className="px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide"
            style={
              isLong
                ? { background: '#dcfce7', color: '#16a34a' }
                : { background: '#fee2e2', color: '#dc2626' }
            }
          >
            {isLong ? 'Long' : 'Short'}
          </span>
          <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-[#e5e5e5] text-[#1a1a1a]">
            {leverage}x
          </span>
        </div>
      </div>

      {/* Rows */}
      <div className="px-4">
        <Row label="Entry Price" value={price ? formatPrice(price) : '--'} valueStyle={{ fontFamily: 'monospace' }} />
        <Row
          label="Multiplier"
          sub="leverage"
          value={`${leverage}× — ${leverage <= 2 ? 'Conservative' : leverage <= 5 ? 'Moderate' : 'Aggressive'}`}
        />
        <Row
          label="Auto-close price"
          sub="est."
          value={autoClosePrice ? formatPrice(autoClosePrice) : '--'}
          valueStyle={{ color: isLong ? '#ef4444' : '#00C805', fontFamily: 'monospace' }}
        />
        <Row
          label="Position side"
          value={isLong ? 'Profit if price rises' : 'Profit if price falls'}
          valueStyle={{ color: isLong ? '#00C805' : '#ef4444' }}
        />
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 bg-[#f5f5f5] border-t border-[#e5e5e5] flex items-center justify-between">
        <span className="text-[#b3b3b3] text-[10px] uppercase tracking-widest font-medium">Order Preview</span>
        <span className="text-[#b3b3b3] text-[10px] font-mono">via TradeXYZ</span>
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
      } on ${asset?.label} at ${leverage}x Built with @AnthropicAI #FirstPerp #TradeXYZ`
    navigator.clipboard.writeText(tweet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col px-5 pt-6 pb-12">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[1.75rem] font-extrabold tracking-tight text-[#1a1a1a]">
          {asset?.label}
        </h1>
        <div className="flex items-center gap-2 mt-1">
          <span
            className="px-2.5 py-0.5 rounded-md text-xs font-bold uppercase"
            style={
              isLong
                ? { background: '#dcfce7', color: '#16a34a' }
                : { background: '#fee2e2', color: '#dc2626' }
            }
          >
            {isLong ? 'Long' : 'Short'}
          </span>
          <span className="text-[#737373] text-sm">{leverage}x multiplier</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 border border-[#e5e5e5] rounded-xl p-4">
          <p className="text-[#737373] text-xs font-medium mb-1.5">
            {pricesStatus === 'delayed' ? 'Price (delayed)' : 'Live Price'}
          </p>
          <p className="text-[#1a1a1a] font-mono font-bold text-xl">
            {price ? formatPrice(price) : '--'}
          </p>
        </div>

        {!fundingError && (
          <div className="flex-1 border border-[#e5e5e5] rounded-xl p-4">
            <div className="flex items-center gap-1 mb-1.5">
              <p className="text-[#737373] text-xs font-medium">Holding Cost</p>
              <button
                onClick={() => setTooltipOpen((v) => !v)}
                className="w-4 h-4 rounded-full border border-[#e5e5e5] text-[#737373] text-[10px] flex items-center justify-center hover:border-[#737373] transition-colors"
              >
                ?
              </button>
            </div>
            <p className="text-[#1a1a1a] font-mono font-bold text-xl">
              {fundingRate !== null ? `${fundingRate}%` : '--'}
            </p>
            <p className="text-[#b3b3b3] text-[11px]">per 8 hours</p>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {tooltipOpen && !fundingError && (
        <div className="mb-5 border border-[#e5e5e5] rounded-xl p-4 text-sm text-[#737373] leading-relaxed bg-[#f5f5f5]">
          <span className="text-[#1a1a1a] font-semibold">What&apos;s a holding cost?</span>{' '}
          When you hold a perp, a small fee is exchanged every 8 hours between people betting up
          and people betting down — this keeps the perp price in line with the real market price.
        </div>
      )}

      {/* AI Cards */}
      <Divider />
      {aiError ? (
        <div className="py-6 text-center">
          <p className="text-[#737373] text-sm">
            Could not load AI summary — your trade setup still looks good.
          </p>
        </div>
      ) : !aiData ? (
        <div className="py-4 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#00C805] pulse-dot-1" />
          <span className="text-[#737373] text-sm">Loading AI analysis...</span>
        </div>
      ) : (
        <div className="divide-y divide-[#e5e5e5]">
          <AICard title="What you are betting on" text={aiData.thesis} />
          <AICard title="What could go wrong" text={aiData.risk} />
          <AICard title="What is a perp?" text={aiData.perpExplain} />
          <AICard title="Current market conditions" text={aiData.marketVibe} />
        </div>
      )}
      <Divider />

      {/* Trade ticket */}
      <div className="mt-5">
        <TradeTicket asset={asset} direction={direction} leverage={leverage} price={price} />
      </div>

      {/* Share */}
      <button
        onClick={handleShare}
        className="w-full mb-3 rounded-xl py-3 font-medium text-sm border border-[#e5e5e5] text-[#737373] hover:border-[#1a1a1a] hover:text-[#1a1a1a] transition-all duration-150 active:scale-[0.98]"
      >
        {copied ? (
          <span className="text-[#00C805] font-semibold">Copied to clipboard</span>
        ) : (
          'Share Your Trade'
        )}
      </button>

      {/* CTAs */}
      <div className="flex flex-col gap-2.5 mb-8">
        <a
          href="https://app.trade.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full bg-[#00C805] text-white font-bold text-base rounded-xl py-4 flex items-center justify-center hover:bg-[#00a804] transition-colors active:scale-[0.98] text-center"
        >
          Open This Trade on TradeXYZ
        </a>
        <a
          href="https://app.hyperliquid.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full border border-[#e5e5e5] text-[#1a1a1a] font-semibold text-base rounded-xl py-4 flex items-center justify-center hover:border-[#1a1a1a] transition-colors active:scale-[0.98] text-center"
        >
          Practice First (No Real Money)
        </a>
      </div>

      <button
        onClick={onRestart}
        className="text-[#b3b3b3] text-sm text-center w-full hover:text-[#737373] transition-colors"
      >
        Start over
      </button>

      <p className="text-center text-[#b3b3b3] text-[11px] mt-6 leading-relaxed">
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

  useEffect(() => {
    const fadeTimer = setTimeout(() => setSplashVisible(false), 1200)
    const unmountTimer = setTimeout(() => setSplash(false), 1700)
    return () => { clearTimeout(fadeTimer); clearTimeout(unmountTimer) }
  }, [])

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
    }, 250)
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
      setFundingError(true)
    }

    if (aiResult.status === 'fulfilled') {
      setAiData(aiResult.value)
    } else {
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

  return (
    <div className="min-h-screen flex items-start md:items-center justify-center bg-white md:py-8">
      {splash && <SplashScreen visible={splashVisible} />}

      {/* Phone frame */}
      <div
        className="w-full min-h-screen md:min-h-0 md:max-h-[88vh] md:rounded-2xl md:border md:border-[#e5e5e5] md:overflow-y-auto flex flex-col"
        style={{
          maxWidth: '390px',
          boxShadow: '0 4px 32px rgba(0,0,0,0.06)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e5]">
          <span className="font-extrabold text-lg tracking-tight text-[#1a1a1a]">First Perp</span>
          <span className="text-[#00C805] text-xs font-semibold">Simulation</span>
        </div>

        <TickerTape prices={prices} tickerFunding={tickerFunding} />

        {showDots && <ProgressDots screen={screen} />}

        <div
          className="flex-1 flex flex-col"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? 'translateY(0)' : 'translateY(8px)',
            transition: 'opacity 0.25s ease, transform 0.25s ease',
          }}
        >
          {screen === 0 && <Screen1 prices={prices} pricesStatus={pricesStatus} onSelect={handleAssetSelect} />}
          {screen === 1 && <Screen2 asset={selectedAsset} onSelect={handleDirectionSelect} />}
          {screen === 2 && <Screen3 leverage={leverage} setLeverage={setLeverage} onContinue={handleSubmitTrade} />}
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
