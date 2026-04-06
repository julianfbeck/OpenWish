import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">OpenWish</p>
        <h1>Cloudflare-native feature requests for apps that still speak WishKit.</h1>
        <p className="lede">
          This workspace now includes a Hono API, D1 schema, a public feedback board, and an
          admin panel. The Swift SDK stays untouched; the backend mirrors the same request and
          response contracts it already expects.
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" to="/projects/demo">
            Open demo route
          </Link>
          <a className="button button-secondary" href="https://developers.cloudflare.com/d1/" target="_blank" rel="noreferrer">
            Cloudflare D1 docs
          </a>
        </div>
      </section>

      <section className="grid two-column">
        <article className="panel">
          <h2>Public board</h2>
          <p>Route pattern: <code>/projects/:slug</code></p>
          <p>Create wishes, vote, and comment with a browser-stored UUID, matching the mobile SDK model.</p>
        </article>
        <article className="panel">
          <h2>Admin</h2>
          <p>Route pattern: <code>/admin/:slug</code></p>
          <p>Use a per-project admin token to triage requests, reply as admin, and move items through states.</p>
        </article>
      </section>
    </main>
  );
}
