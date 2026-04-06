import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";

import type { WishResponse } from "@openwish/shared";
import { wishStateLabels } from "@openwish/shared";

import {
  createPublicComment,
  createPublicWish,
  fetchPublicProject,
  updatePublicUser,
  voteForWish,
} from "../lib/api";
import { formatDate } from "../lib/format";

export function PublicProjectPage() {
  const { slug = "" } = useParams();
  const [list, setList] = useState<WishResponse[]>([]);
  const [projectName, setProjectName] = useState("OpenWish");
  const [shouldShowWatermark, setShouldShowWatermark] = useState(false);
  const [selectedState, setSelectedState] = useState<"all" | WishResponse["state"]>("all");
  const [selectedWish, setSelectedWish] = useState<WishResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [commentDraft, setCommentDraft] = useState("");

  async function refresh() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchPublicProject(slug);
      setList(response.list);
      setProjectName(response.project.name);
      setShouldShowWatermark(response.project.shouldShowWatermark);
      setSelectedWish((current) =>
        current ? response.list.find((wish) => wish.id === current.id) ?? null : null,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not load project.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [slug]);

  const filteredList = useMemo(() => {
    return list
      .filter((wish) => (selectedState === "all" ? true : wish.state === selectedState))
      .sort((left, right) => right.votingUsers.length - left.votingUsers.length);
  }, [list, selectedState]);

  async function handleCreateWish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      if (email) {
        await updatePublicUser(slug, { email });
      }
      await createPublicWish(slug, { title, description, email: email || undefined, state: "pending" });
      setTitle("");
      setDescription("");
      setEmail("");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create wish.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVote(wishId: string) {
    try {
      await voteForWish(slug, wishId);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not vote.");
    }
  }

  async function handleComment() {
    if (!selectedWish || !commentDraft.trim()) {
      return;
    }

    try {
      await createPublicComment(slug, selectedWish.id, commentDraft.trim());
      setCommentDraft("");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not post comment.");
    }
  }

  return (
    <main className="page-shell">
      <section className="hero-card compact">
        <div className="space-between">
          <div>
            <p className="eyebrow">OpenWish board</p>
            <h1>{projectName}</h1>
            <p className="lede">
              Vote on roadmap ideas, leave context, and help prioritize what ships next.
            </p>
          </div>
          <Link className="button button-secondary" to={`/admin/${slug}`}>
            Admin
          </Link>
        </div>
      </section>

      {error ? <p className="error-banner">{error}</p> : null}

      <section className="grid project-layout">
        <article className="panel">
          <div className="section-header">
            <h2>Submit feedback</h2>
            <span>{title.length}/50</span>
          </div>
          <form className="stack" onSubmit={handleCreateWish}>
            <label className="field">
              <span>Title</span>
              <input value={title} maxLength={50} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                rows={5}
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <button className="button button-primary" disabled={isSubmitting || !title || !description}>
              {isSubmitting ? "Submitting..." : "Create wish"}
            </button>
          </form>
        </article>

        <article className="panel">
          <div className="section-header">
            <h2>Roadmap</h2>
            <select value={selectedState} onChange={(event) => setSelectedState(event.target.value as typeof selectedState)}>
              <option value="all">All states</option>
              {Object.entries(wishStateLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {isLoading ? <p>Loading feedback...</p> : null}
          {!isLoading && filteredList.length === 0 ? <p>No feedback yet.</p> : null}

          <div className="wish-list">
            {filteredList.map((wish) => (
              <button
                key={wish.id}
                className={`wish-card ${selectedWish?.id === wish.id ? "wish-card-active" : ""}`}
                onClick={() => setSelectedWish(wish)}
                type="button"
              >
                <div className="wish-vote">
                  <strong>{wish.votingUsers.length}</strong>
                  <span>votes</span>
                </div>
                <div className="wish-body">
                  <div className="space-between">
                    <h3>{wish.title}</h3>
                    <span className="badge">{wishStateLabels[wish.state]}</span>
                  </div>
                  <p>{wish.description}</p>
                </div>
              </button>
            ))}
          </div>
        </article>

        <article className="panel detail-panel">
          {!selectedWish ? (
            <div className="empty-state">
              <h2>Pick a request</h2>
              <p>Open a request to see comments and vote from the browser.</p>
            </div>
          ) : (
            <>
              <div className="section-header">
                <div>
                  <h2>{selectedWish.title}</h2>
                  <p className="muted">{wishStateLabels[selectedWish.state]}</p>
                </div>
                <button className="button button-primary" onClick={() => void handleVote(selectedWish.id)} type="button">
                  Vote ({selectedWish.votingUsers.length})
                </button>
              </div>
              <p>{selectedWish.description}</p>
              <div className="stack">
                <h3>Comments</h3>
                {selectedWish.commentList.length === 0 ? <p className="muted">No comments yet.</p> : null}
                {selectedWish.commentList.map((comment) => (
                  <div key={comment.id} className="comment">
                    <div className="space-between">
                      <strong>{comment.isAdmin ? "OpenWish admin" : "User"}</strong>
                      <span className="muted">{formatDate(comment.createdAt)}</span>
                    </div>
                    <p>{comment.description}</p>
                  </div>
                ))}
              </div>
              <div className="stack">
                <textarea
                  rows={4}
                  placeholder="Add context to this request"
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                />
                <button className="button button-secondary" onClick={() => void handleComment()} type="button">
                  Add comment
                </button>
              </div>
            </>
          )}
        </article>
      </section>

      {shouldShowWatermark ? <p className="watermark">Powered by OpenWish</p> : null}
    </main>
  );
}
