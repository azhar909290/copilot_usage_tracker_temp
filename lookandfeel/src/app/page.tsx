import Link from "next/link";

const components = [
  {
    accent: "teal",
    status: "Component",
    title: "Usage and activity",
    description: "Explore calls, tokens, estimated spend and activity over time.",
  },
  {
    accent: "blue",
    status: "Component",
    title: "Teams and agents",
    description: "See usage by team and person, and explore the agent catalog.",
  },
  {
    accent: "purple",
    status: "Component",
    title: "Models and insights",
    description: "Compare model usage and explore trends across the control plane.",
  },
];

type CardItem = (typeof components)[number];

function CardGrid({ items }: { items: CardItem[] }) {
  return (
    <div className="atlex-grid">
      {items.map((item) => (
        <article className={`atlex-card atlex-accent-${item.accent}`} key={item.title}>
          <div className="atlex-card-bar" aria-hidden="true" />
          <span className="atlex-pill">{item.status}</span>
          <h3>{item.title}</h3>
          <p>{item.description}</p>
        </article>
      ))}
    </div>
  );
}

export default function Home() {
  return (
    <div className="atlex-home">
      <header className="atlex-topbar">
        <div className="atlex-wrap atlex-header-inner">
          <div className="atlex-brand">
            <span className="atlex-mark" aria-hidden="true" />
            Atlex <span className="atlex-brand-badge">AI</span>
          </div>
          <nav className="atlex-nav" aria-label="Primary">
            <a href="#overview">Overview</a>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/github-metrics">GitHub metrics</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="atlex-hero" id="overview">
          <div className="atlex-wrap">
            <div className="atlex-eyebrow atlex-hero-eyebrow">AI Control Plane</div>
            <h1>Understand your AI activity <em>in one place</em></h1>
            <p className="atlex-lede">
              Explore usage, teams, agents and models alongside GitHub Copilot metrics in a clear,
              connected view.
            </p>
            <div className="atlex-actions">
              <Link className="atlex-button atlex-primary" href="/dashboard">Open dashboard</Link>
              <Link className="atlex-button atlex-ghost" href="/github-metrics">View GitHub metrics</Link>
            </div>
          </div>
        </section>

        <section className="atlex-block atlex-alt" id="capabilities">
          <div className="atlex-wrap">
            <div className="atlex-section-head">
              <div className="atlex-eyebrow atlex-section-eyebrow">Explore</div>
              <h2>A clearer view of AI usage</h2>
              <p>Use the dashboard to filter and investigate your AI Control Plane data.</p>
            </div>
            <CardGrid items={components} />
          </div>
        </section>

      </main>

      <footer>
        <div className="atlex-wrap">
          Atlex · AI Control Plane
        </div>
      </footer>
    </div>
  );
}
