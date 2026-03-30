# First Perp 🚀

> Your first perpetual futures trade, explained in plain English.

Built at the **Princeton AI × Finance Hackathon** (March 2026)  
Hosted by TradeXYZ · Anthropic · Hyperliquid

---

## What It Is

First Perp is a mobile-first onboarding experience for complete beginners 
to perpetual futures trading. Think Robinhood's simplicity applied to perps.

Most people have never traded a perpetual future — not because they can't 
afford to, but because it's intimidating. First Perp removes that barrier 
with a 3-question flow that ends with a real trade setup on TradeXYZ.

---

## The Flow

1. **Pick an asset** — S&P 500, Gold, or Oil (with live prices)
2. **Pick a direction** — Going UP (long) or DOWN (short)
3. **See your trade** — AI explains your thesis, risks, and market context
4. **Execute** — One click to TradeXYZ or practice on Hyperliquid

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Tailwind CSS |
| AI Summary | Anthropic Claude (claude-sonnet-4-20250514) |
| Live Prices | Finnhub API |
| Funding Rates | Hyperliquid Public API |
| Trading | TradeXYZ (app.trade.xyz) |
| Practice | Hyperliquid (app.hyperliquid.xyz) |

---

## Getting Started

### 1. Clone the repo
```bash
git clone https://github.com/yourusername/first-perp
cd first-perp
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
```bash
cp .env.example .env
```
Then open `.env` and fill in your keys:
```
VITE_ANTHROPIC_KEY=your_anthropic_key_here
VITE_FINNHUB_KEY=your_finnhub_key_here
```

### 4. Run the app

If using frontend only:
```bash
npm run dev
```

If Anthropic API has CORS issues, run the Express proxy too:
```bash
# Terminal 1
node server.js

# Terminal 2
npm run dev
```

### 5. Open in browser
```
http://localhost:5173
```

---

## API Keys

| Service | Where to get it | Free tier |
|---------|----------------|-----------|
| Anthropic | console.anthropic.com | Yes |
| Finnhub | finnhub.io | Yes — 60 req/min |
| Hyperliquid | No key needed | Public API |

---

## Assets Supported

| Asset | TradeXYZ Market | Hyperliquid |
|-------|----------------|-------------|
| S&P 500 | app.trade.xyz/?market=SP500 | xyz:SP500 |
| Gold | app.trade.xyz/?market=GOLD | xyz:GOLD |
| Oil | app.trade.xyz/?market=CL | xyz:CL |

---

## Project Structure
```
first-perp/
├── src/
│   └── App.jsx          # Main app — all screens
├── server.js            # Express proxy for Anthropic API (if needed)
├── .env                 # Your API keys (never commit this)
├── .env.example         # Safe template to commit
├── .gitignore
└── README.md
```

---

## Screens

| Screen | Description |
|--------|-------------|
| Splash | 1.5s branded intro |
| Screen 1 | Asset selection with live prices |
| Screen 2 | Direction — long or short |
| Screen 3 | Leverage info for selected asset |
| Screen 4 | Loading — AI generating summary |
| Screen 5 | Trade ticket + AI summary + CTA buttons |

---

## Built With

- [Anthropic Claude](https://anthropic.com) — AI reasoning layer
- [TradeXYZ](https://trade.xyz) — Perpetual futures on real-world assets
- [Hyperliquid](https://hyperliquid.xyz) — 24/7 on-chain trading
- [Finnhub](https://finnhub.io) — Live market data

---

## Disclaimer

This app is for educational purposes only. Nothing here is financial advice.
Always do your own research before trading.

---

*Built at the Princeton AI × Finance Hackathon · March 2026*
