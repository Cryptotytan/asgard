import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { TOKENS, tokenBySymbol, usd } from "@/lib/market";

const FAQ = [
  ["What sits on this desk?", "Markets, spot, NEAR and ETH perps, swap, a vault, lending, and a wallet tracker. One terminal."],
  ["Which wallets can sign in?", "Meteor, HOT, HERE, MyNearWallet, Nightly, Sender, and Intear on NEAR mainnet."],
  ["Do trades leave my wallet?", "Swap, spot, vault, and lend do. You confirm a deposit, and NEAR Intents settles it back to the same account. Perp margin stays in the wallet."],
  ["How does a route get picked?", "The terminal asks NEAR Intents 1-Click for a live quote. Other venues stay on the book as estimates. Only Intents is signed."],
];

export function Landing() {
  const stars = useRef<HTMLCanvasElement>(null);
  const mock = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(0);
  const [tilt, setTilt] = useState({ x: 8, y: -16 });

  useEffect(() => {
    const canvas = stars.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dots = Array.from({ length: 160 }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      z: Math.random(),
      green: Math.random() > 0.82,
    }));
    let frame = 0;
    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
      for (const dot of dots) {
        if (!reduce) dot.z -= 0.0014;
        if (dot.z <= 0.04) {
          dot.z = 1;
          dot.x = Math.random() * 2 - 1;
          dot.y = Math.random() * 2 - 1;
        }
        const depth = 0.15 + dot.z;
        const x = width / 2 + (dot.x / depth) * width * 0.46;
        const y = height / 2 + (dot.y / depth) * height * 0.46;
        if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
        const radius = (1.15 - dot.z) * 1.7;
        ctx.fillStyle = dot.green ? `rgba(0,236,151,${0.25 + (1 - dot.z) * 0.55})` : `rgba(242,241,233,${0.18 + (1 - dot.z) * 0.55})`;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      const node = mock.current;
      if (node) {
        const box = node.getBoundingClientRect();
        const view = window.innerHeight || 1;
        const progress = Math.min(1, Math.max(0, (view * 0.92 - box.top) / (view * 0.42)));
        node.style.setProperty("--lift", progress.toFixed(3));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  function lean(event: React.PointerEvent<HTMLDivElement>) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    setTilt({ x: 8 - y * 10, y: -16 + x * 14 });
  }

  return (
    <div className="landing">
      <canvas ref={stars} className="landing-stars" aria-hidden />
      <header className="landing-nav">
        <a href="#top" className="flex items-center gap-2">
          <span className="mark" aria-hidden />
          <span className="text-lg font-semibold tracking-tight">Asgard</span>
        </a>
        <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
          <a href="#desk">Terminal</a>
          <a href="#routes">Intents</a>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Link to="/app" className="landing-enter">
          Enter terminal
        </Link>
      </header>

      <main id="top">
        <section className="landing-hero">
          <p className="landing-pill">NEAR Intents · 1-Click</p>
          <h1>
            THE NEAR BOOK
            <br />
            <span>OPENS HERE</span>
          </h1>
          <p className="landing-lead">
            Scan a market, take a live Intents quote, and settle swap, spot, the vault, and lending from the NEAR wallet you already use.
          </p>
          <div className="landing-cta">
            <Link to="/app" className="landing-enter landing-enter-lg">
              Enter the terminal
            </Link>
            <a href="#how" className="h-12 rounded-full border border-line px-6 text-sm font-semibold leading-[3rem]">
              How a fill settles
            </a>
          </div>

          <div id="desk" className="landing-stage" onPointerMove={lean} onPointerLeave={() => setTilt({ x: 8, y: -16 })}>
            <div className="landing-float">
              <div ref={mock} className="landing-mock" style={{ "--rx": `${tilt.x}deg`, "--ry": `${tilt.y}deg` } as React.CSSProperties}>
                <Mock />
              </div>
            </div>
          </div>
        </section>

        <section className="landing-stats">
          <Stat k="Tokens on the desk" v={String(TOKENS.length)} />
          <Stat k="NEAR wallets" v="7" />
          <Stat k="Settlement" v="1-Click" />
        </section>

        <section id="routes" className="landing-block">
          <p className="landing-kicker">What the terminal holds</p>
          <h2>One screen for the whole book</h2>
          <div className="landing-grid">
            <article>
              <RouteFace />
              <span>01</span>
              <h3>A live Intents quote</h3>
              <p>Swap and spot ask NEAR Intents 1-Click for the price. Your wallet sends the deposit. The other venues stay on the book as estimates.</p>
            </article>
            <article>
              <ScanFace />
              <span>02</span>
              <h3>Scan before size</h3>
              <p>Verified marks, holder notes, and a honeypot gate sit on the ticket. A bad sell does not get a quiet fill.</p>
            </article>
            <article>
              <PerpFace />
              <span>03</span>
              <h3>Perps that are listed</h3>
              <p>NEAR and ETH only. Take profit, stop, and liquidation are on the position. Everything else stays spot.</p>
            </article>
            <article>
              <VaultFace />
              <span>04</span>
              <h3>Vault and lending</h3>
              <p>A deposit swaps into stNEAR through Intents, and a withdraw swaps it back. Borrowing stays inside the collateral line and does not mint tokens.</p>
            </article>
            <article>
              <WalletFace />
              <span>05</span>
              <h3>A wallet you already have</h3>
              <p>Meteor, HOT, HERE, MyNearWallet, Nightly, Sender, Intear. The header shows the account and its on-chain NEAR.</p>
            </article>
            <article>
              <PhoneFace />
              <span>06</span>
              <h3>The same desk on a phone</h3>
              <p>Markets, swap, vault, and lend fit the screen. The chart and the order ticket stay in one scroll on trade.</p>
            </article>
          </div>
        </section>

        <section id="how" className="landing-block">
          <p className="landing-kicker">How it works</p>
          <h2>Open, read, settle</h2>
          <ol className="landing-steps">
            <li>
              <MarketFace />
              <span>01</span>
              <h3>Pick a market</h3>
              <p>Trending, newest, and recents. A token opens the terminal on that pair.</p>
            </li>
            <li>
              <ScanFace />
              <span>02</span>
              <h3>Read the scan</h3>
              <p>Score, notes, and the honeypot check show before the ticket will trade.</p>
            </li>
            <li>
              <RouteFace />
              <span>03</span>
              <h3>Sign the quote</h3>
              <p>NEAR Intents 1-Click prices the fill. Confirm the deposit in your wallet and the tokens come back to the same account.</p>
            </li>
          </ol>
        </section>

        <section id="faq" className="landing-block landing-faq">
          <div className="faq-intro">
            <p className="landing-kicker">FAQ</p>
            <h2>Before you open it</h2>
            <p>Sign-in is a real NEAR wallet. Swap, spot, vault, and lend settle through NEAR Intents.</p>
          </div>
          <div className="faq-list">
            {FAQ.map(([question, answer], index) => (
              <button key={question} type="button" className={open === index ? "landing-q is-open" : "landing-q"} onClick={() => setOpen(index)} aria-expanded={open === index}>
                <span className="faq-n">0{index + 1}</span>
                <span className="faq-ask">{question}</span>
                <small>{open === index ? "–" : "+"}</small>
                {open === index && <p>{answer}</p>}
              </button>
            ))}
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <div>
          <span className="mark" aria-hidden />
          <strong>Asgard</strong>
          <p>NEAR Intents terminal.</p>
        </div>
        <Link to="/app" className="landing-enter">
          Enter the terminal
        </Link>
      </footer>
    </div>
  );
}

function Mock() {
  const near = tokenBySymbol("NEAR");
  const usdc = tokenBySymbol("USDC");
  return (
    <div className="mock">
      <aside>
        <p className="mock-k">Scan</p>
        <p className="mock-line">
          <img src={near.icon} alt="" />
          {near.symbol}
          <b>{usd(near.price)}</b>
        </p>
        <p>Verified pool. Honeypot clear.</p>
        <p>Quote comes from NEAR Intents.</p>
        <span>Open NEAR</span>
      </aside>
      <div>
        <p className="mock-k">Swap your assets</p>
        <label>
          <span>Selling</span>
          <strong>100</strong>
          <em>
            <img src={usdc.icon} alt="" />
            USDC
          </em>
        </label>
        <label>
          <span>Buying</span>
          <strong>{(100 / near.price).toFixed(2)}</strong>
          <em>
            <img src={near.icon} alt="" />
            NEAR
          </em>
        </label>
        <div className="mock-go">Enter terminal</div>
      </div>
      <aside>
        <p className="mock-k">Best route</p>
        <p>NEAR Intents</p>
        <p>1-Click · live quote</p>
        <p>Deposit from this wallet.</p>
      </aside>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <strong>{v}</strong>
      <span>{k}</span>
    </div>
  );
}

function FaceToken({ symbol }: { symbol: string }) {
  const token = tokenBySymbol(symbol);
  return <img src={token.icon} alt="" />;
}

function RouteFace() {
  const rows = [
    ["NEAR Intents", "1-Click", true],
    ["Rhea", "Estimate", false],
    ["HEX", "Estimate", false],
  ] as const;
  return (
    <div className="viz">
      {rows.map(([name, fee, best]) => (
        <p key={name} className={best ? "is-best" : ""}>
          <b>{name}</b>
          <span>{fee}</span>
          {best && <em>Best</em>}
        </p>
      ))}
    </div>
  );
}

function ScanFace() {
  const near = tokenBySymbol("NEAR");
  return (
    <div className="viz viz-scan">
      <img src={near.icon} alt="" />
      <div>
        <b>NEAR</b>
        <span>Verified pool · honeypot clear</span>
      </div>
      <strong>92</strong>
    </div>
  );
}

function PerpFace() {
  return (
    <div className="viz viz-perp">
      <p>
        <FaceToken symbol="NEAR" />
        <b>NEAR-PERP</b>
        <em>+4.8%</em>
      </p>
      <div>
        <span>TP 5.40</span>
        <span>SL 4.80</span>
        <span>Liq 3.10</span>
      </div>
    </div>
  );
}

function VaultFace() {
  return (
    <div className="viz viz-vault">
      <p>
        <span>Vault</span>
        <b>8.4%</b>
        <i style={{ width: "68%" }} />
      </p>
      <p>
        <span>Supply</span>
        <b>12%</b>
        <i style={{ width: "82%" }} />
      </p>
    </div>
  );
}

function WalletFace() {
  return (
    <div className="viz viz-wallets">
      {["Meteor", "HOT", "HERE", "Nightly"].map((name, index) => (
        <p key={name} className={index === 0 ? "is-best" : ""}>
          <b>{name}</b>
          <span>{index === 0 ? "Connected" : "NEAR"}</span>
        </p>
      ))}
    </div>
  );
}

function PhoneFace() {
  return (
    <div className="viz viz-phone">
      {["NEAR", "ETH", "AURORA"].map((symbol) => {
        const token = tokenBySymbol(symbol);
        return (
          <p key={symbol}>
            <img src={token.icon} alt="" />
            <b>{symbol}</b>
            <span>{usd(token.price)}</span>
          </p>
        );
      })}
    </div>
  );
}

function MarketFace() {
  return (
    <div className="viz viz-phone">
      {["NEAR", "USDC", "wBTC"].map((symbol) => {
        const token = tokenBySymbol(symbol);
        return (
          <p key={symbol}>
            <img src={token.icon} alt="" />
            <b>{token.symbol}</b>
            <span>{usd(token.price)}</span>
          </p>
        );
      })}
    </div>
  );
}
