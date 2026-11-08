import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { tokenBySymbol, usd } from "@/lib/market";

const FAQ = [
  ["What sits on this desk?", "Markets, spot, perps, swap, a Meta Pool vault, Rhea lending, portfolio, and a wallet tracker. One NEAR terminal."],
  ["Which wallets can sign in?", "Intear, HERE, Meteor, HOT, Nightly, and Sender on NEAR mainnet. HOT, Meteor, Nightly, and Sender open their browser extension."],
  ["Where does a swap settle?", "Swap and spot ask NEAR Intents for a live quote, then Ref Finance when that pool is the route. You confirm the deposit in the wallet you connected."],
  ["What do the vault and lend do?", "The vault stakes NEAR into stNEAR on Meta Pool and unstakes back to the same account. Supply, borrow, and withdraw settle on Rhea."],
  ["What does tracker activity show?", "Only transfers that succeeded. A call that panicked, or never moved tokens, stays off the activity list."],
];

export function Landing() {
  const stars = useRef<HTMLCanvasElement>(null);
  const mock = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

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
    setTilt({ x: -y * 10, y: x * 14 });
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
          <p className="landing-pill">NEAR mainnet</p>
          <h1>
            THE NEAR BOOK
            <br />
            <span>OPENS HERE</span>
          </h1>
          <p className="landing-lead">
            Markets, swap, a Meta Pool vault, and Rhea lending. You sign with the NEAR wallet you already use. Tracker activity keeps only the transfers that succeeded.
          </p>
          <div className="landing-cta">
            <Link to="/app" className="landing-enter landing-enter-lg">
              Enter the terminal
            </Link>
            <a href="#how" className="h-12 rounded-full border border-line px-6 text-sm font-semibold leading-[3rem]">
              How a fill settles
            </a>
          </div>

          <div id="desk" className="landing-stage" onPointerMove={lean} onPointerLeave={() => setTilt({ x: 0, y: 0 })}>
            <div className="landing-float">
              <div ref={mock} className="landing-mock" style={{ "--rx": `${tilt.x}deg`, "--ry": `${tilt.y}deg` } as React.CSSProperties}>
                <Mock />
              </div>
            </div>
          </div>
        </section>

        <section className="landing-stats">
          <Stat k="Tokens on the desk" v="500+" />
          <Stat k="NEAR wallets" v="6" />
          <Stat k="Vault" v="stNEAR" />
        </section>

        <section id="routes" className="landing-block">
          <p className="landing-kicker">What the terminal holds</p>
          <h2>One screen for the whole book</h2>
          <div className="landing-grid">
            <article>
              <RouteFace />
              <span>01</span>
              <h3>A live route</h3>
              <p>Swap and spot ask NEAR Intents first. Ref Finance fills the pool route. deBridge covers a cross-chain hop. You confirm the deposit in your wallet.</p>
            </article>
            <article>
              <ScanFace />
              <span>02</span>
              <h3>Scan before size</h3>
              <p>Verified marks stay on real assets. A memecoin opens its own GeckoTerminal chart. Listed spot and perp markets stay on TradingView.</p>
            </article>
            <article>
              <VaultFace />
              <span>03</span>
              <h3>Vault on Meta Pool</h3>
              <p>A deposit stakes into stNEAR. A withdraw unstakes on the contract and returns NEAR to the same account. The portfolio value follows that balance.</p>
            </article>
            <article>
              <LendFace />
              <span>04</span>
              <h3>Lending on Rhea</h3>
              <p>Supply, borrow, and withdraw use the Rhea market. Collateral stays inside the line you actually supplied. LiNEAR, stNEAR, and the rest use their own logos.</p>
            </article>
            <article>
              <TrackerFace />
              <span>05</span>
              <h3>Activity that landed</h3>
              <p>Follow a NEAR account and read its balances. The activity list shows transfers that succeeded. A failed call does not appear there.</p>
            </article>
            <article>
              <WalletFace />
              <span>06</span>
              <h3>A wallet you already have</h3>
              <p>Intear, HERE, Meteor, HOT, Nightly, and Sender. HOT uses the browser extension. The header shows the account and its on-chain NEAR.</p>
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
              <p>Confirm the deposit in your NEAR wallet. Swap, vault, and lend wait on that signature, then the balance updates on the account you signed with.</p>
            </li>
          </ol>
        </section>

        <section id="faq" className="landing-block landing-faq">
          <div className="faq-intro">
            <p className="landing-kicker">FAQ</p>
            <h2>Before you open it</h2>
            <p>Sign-in is a real NEAR wallet. Swap and spot settle through NEAR Intents and Ref. The vault is Meta Pool stNEAR. Lending is Rhea. Tracker activity is successful transfers only.</p>
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
          <p>NEAR terminal. Mainnet settlement.</p>
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
          <b>{shown(near.price, "$—")}</b>
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
          <strong>{Number.isFinite(near.price) && near.price > 0 ? (100 / near.price).toFixed(2) : "—"}</strong>
          <em>
            <img src={near.icon} alt="" />
            NEAR
          </em>
        </label>
        <div className="mock-go">Enter terminal</div>
      </div>
      <aside>
        <p className="mock-k">Activity</p>
        <p>Swap · succeeded</p>
        <p>stNEAR unstake · succeeded</p>
        <p>Failed calls stay off this list.</p>
      </aside>
    </div>
  );
}

function shown(n: number, fallback: string) {
  return Number.isFinite(n) && n > 0 ? usd(n) : fallback;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <strong>{v}</strong>
      <span>{k}</span>
    </div>
  );
}

function RouteFace() {
  const rows = [
    ["NEAR Intents", "1-Click", true],
    ["Ref Finance", "Pool", false],
    ["deBridge", "Bridge", false],
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

function VaultFace() {
  return (
    <div className="viz viz-vault">
      <p>
        <span>stNEAR</span>
        <b>Meta Pool</b>
        <i style={{ width: "72%" }} />
      </p>
      <p>
        <span>Unstake</span>
        <b>Same wallet</b>
        <i style={{ width: "48%" }} />
      </p>
    </div>
  );
}

function LendFace() {
  return (
    <div className="viz viz-vault">
      <p>
        <span>Supply</span>
        <b>Rhea</b>
        <i style={{ width: "80%" }} />
      </p>
      <p>
        <span>Borrow room</span>
        <b>Collateral</b>
        <i style={{ width: "46%" }} />
      </p>
    </div>
  );
}

function TrackerFace() {
  return (
    <div className="viz">
      <p className="is-best">
        <b>Swap</b>
        <span>Succeeded</span>
      </p>
      <p className="is-best">
        <b>Unstake</b>
        <span>Succeeded</span>
      </p>
      <p>
        <b>Failed call</b>
        <span>Hidden</span>
      </p>
    </div>
  );
}

function WalletFace() {
  return (
    <div className="viz viz-wallets">
      {["Intear", "HERE", "HOT", "Meteor"].map((name, index) => (
        <p key={name} className={index === 0 ? "is-best" : ""}>
          <b>{name}</b>
          <span>{index === 2 ? "Extension" : index === 0 ? "Connected" : "NEAR"}</span>
        </p>
      ))}
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
            <span>{shown(token.price, "—")}</span>
          </p>
        );
      })}
    </div>
  );
}
