import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { AdminProjectResponse, WishState } from "@openwish/shared";
import { wishStateLabels } from "@openwish/shared";

import {
  bootstrapProject,
  createAdminComment,
  fetchAdminProject,
  updateProjectSettings,
  updateWishState,
} from "../lib/api";
import { formatDate } from "../lib/format";

function adminStorageKey(slug: string) {
  return `openwish:admin:${slug}`;
}

export function AdminPage() {
  const { slug = "" } = useParams();
  const [adminToken, setAdminToken] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [bootstrapName, setBootstrapName] = useState("OpenWish Project");
  const [bootstrapSlug, setBootstrapSlug] = useState(slug || "demo");
  const [bootstrapResult, setBootstrapResult] = useState<string | null>(null);
  const [data, setData] = useState<AdminProjectResponse | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function refresh(nextToken = adminToken) {
    if (!nextToken || !slug) {
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchAdminProject(slug, nextToken);
      setData(response);
      window.localStorage.setItem(adminStorageKey(slug), nextToken);
    } catch (nextError) {
      setData(null);
      setError(nextError instanceof Error ? nextError.message : "Could not load admin project.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const stored = slug ? window.localStorage.getItem(adminStorageKey(slug)) : null;
    if (stored) {
      setAdminToken(stored);
      void refresh(stored);
    }
  }, [slug]);

  async function handleBootstrap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const response = await bootstrapProject(
        { name: bootstrapName, slug: bootstrapSlug, watermarkEnabled: false },
        bootstrapToken,
      );
      setBootstrapResult(
        `Project created. API key: ${response.apiKey} | Admin token: ${response.adminToken}`,
      );
      setAdminToken(response.adminToken);
      if (slug === response.slug) {
        await refresh(response.adminToken);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not bootstrap project.");
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await refresh(adminToken);
  }

  async function handleStateUpdate(wishId: string, state: WishState) {
    if (!adminToken) {
      return;
    }

    try {
      const response = await updateWishState(slug, wishId, state, adminToken);
      setData(response);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not update state.");
    }
  }

  async function handleWatermarkChange(nextValue: boolean) {
    if (!adminToken) {
      return;
    }

    try {
      const response = await updateProjectSettings(slug, nextValue, adminToken);
      setData(response);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not update settings.");
    }
  }

  async function handleAdminComment(wishId: string) {
    const draft = commentDrafts[wishId]?.trim();
    if (!adminToken || !draft) {
      return;
    }

    try {
      const response = await createAdminComment(slug, wishId, draft, adminToken);
      setCommentDrafts((current) => ({ ...current, [wishId]: "" }));
      setData(response);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not post admin comment.");
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card compact">
        <div className="space-between">
          <div>
            <p className="eyebrow">OpenWish admin</p>
            <h1>{slug || "project"}</h1>
            <p className="lede">Bootstrap projects, review feedback, and move items through the roadmap.</p>
          </div>
          <Link className="button button-secondary" to={`/projects/${slug}`}>
            Public board
          </Link>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}
      {bootstrapResult ? <p className="success-banner">{bootstrapResult}</p> : null}

      <section className="grid two-column">
        <article className="panel">
          <h2>Bootstrap a project</h2>
          <form className="stack" onSubmit={handleBootstrap}>
            <label className="field">
              <span>Bootstrap token</span>
              <input value={bootstrapToken} onChange={(event) => setBootstrapToken(event.target.value)} />
            </label>
            <label className="field">
              <span>Name</span>
              <input value={bootstrapName} onChange={(event) => setBootstrapName(event.target.value)} />
            </label>
            <label className="field">
              <span>Slug</span>
              <input value={bootstrapSlug} onChange={(event) => setBootstrapSlug(event.target.value)} />
            </label>
            <button className="button button-primary">Create project</button>
          </form>
        </article>

        <article className="panel">
          <h2>Admin login</h2>
          <form className="stack" onSubmit={handleLogin}>
            <label className="field">
              <span>Admin token</span>
              <input value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
            </label>
            <button className="button button-primary">Load dashboard</button>
          </form>
        </article>
      </section>

      {isLoading ? <p>Loading admin dashboard...</p> : null}

      {data ? (
        <section className="grid admin-layout">
          <article className="panel">
            <div className="section-header">
              <h2>Project metrics</h2>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={data.project.watermarkEnabled}
                  onChange={(event) => void handleWatermarkChange(event.target.checked)}
                />
                <span>Watermark</span>
              </label>
            </div>
            <div className="stat-grid">
              <div className="stat-card">
                <span>Wishes</span>
                <strong>{data.project.totalWishes}</strong>
              </div>
              <div className="stat-card">
                <span>Votes</span>
                <strong>{data.project.totalVotes}</strong>
              </div>
              <div className="stat-card">
                <span>Users</span>
                <strong>{data.project.totalUsers}</strong>
              </div>
            </div>
            <p className="muted">Created {formatDate(data.project.createdAt)}</p>
          </article>

          <article className="panel admin-board">
            <h2>Wishlist triage</h2>
            <div className="stack">
              {data.list.map((wish) => (
                <div key={wish.id} className="wish-admin-card">
                  <div className="space-between">
                    <div>
                      <h3>{wish.title}</h3>
                      <p className="muted">{wish.votingUsers.length} votes</p>
                    </div>
                    <select
                      value={wish.state}
                      onChange={(event) => void handleStateUpdate(wish.id, event.target.value as WishState)}
                    >
                      {Object.entries(wishStateLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p>{wish.description}</p>
                  <div className="stack compact-stack">
                    {wish.commentList.map((comment) => (
                      <div className="comment" key={comment.id}>
                        <div className="space-between">
                          <strong>{comment.isAdmin ? "Admin" : "User"}</strong>
                          <span className="muted">{formatDate(comment.createdAt)}</span>
                        </div>
                        <p>{comment.description}</p>
                      </div>
                    ))}
                    <textarea
                      rows={3}
                      placeholder="Reply as admin"
                      value={commentDrafts[wish.id] ?? ""}
                      onChange={(event) =>
                        setCommentDrafts((current) => ({
                          ...current,
                          [wish.id]: event.target.value,
                        }))
                      }
                    />
                    <button className="button button-secondary" onClick={() => void handleAdminComment(wish.id)} type="button">
                      Add admin comment
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      ) : null}
    </main>
  );
}
