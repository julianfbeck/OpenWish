import { useEffect, useRef, useState } from "react";

import type {
  PublicFeedbackKind,
  PublicFeedbackProject,
} from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";
import { Bug, CheckCircle2, Lightbulb } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import {
  ApiRequestError,
  fetchPublicFeedbackProject,
  submitPublicFeedback,
} from "#/lib/api";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
          appearance?: "always" | "execute" | "interaction-only";
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const Route = createFileRoute("/feedback/$slug")({
  component: FeedbackPage,
});

function FeedbackPage() {
  const { slug } = Route.useParams();
  const [project, setProject] = useState<PublicFeedbackProject | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "missing">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    fetchPublicFeedbackProject(slug)
      .then((response) => {
        if (cancelled) return;
        setProject(response);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const previousTitle = document.title;
    if (project?.appName) {
      document.title = `Send feedback — ${project.appName}`;
    } else if (project?.name) {
      document.title = `Send feedback — ${project.name}`;
    }

    let restoredHrefs: Array<{ link: HTMLLinkElement; href: string }> = [];
    if (project?.appIconUrl) {
      const links = document.head.querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="apple-touch-icon"], link[rel="shortcut icon"]',
      );
      links.forEach((link) => {
        restoredHrefs.push({ link, href: link.href });
        link.href = project.appIconUrl!;
      });
      // If the host page had no icon link at all, add one for this view.
      if (links.length === 0) {
        const link = document.createElement("link");
        link.rel = "icon";
        link.href = project.appIconUrl;
        link.dataset.openwishInjected = "true";
        document.head.appendChild(link);
        restoredHrefs.push({ link, href: "" });
      }
    }

    return () => {
      document.title = previousTitle;
      restoredHrefs.forEach(({ link, href }) => {
        if (link.dataset.openwishInjected === "true") {
          link.remove();
        } else {
          link.href = href;
        }
      });
    };
  }, [project?.appIconUrl, project?.appName, project?.name]);

  return (
    <main className="grid min-h-screen place-items-center bg-black px-5 py-10 text-neutral-100">
      <Card className="w-full max-w-md border-white/10 bg-neutral-950">
        {loadState === "loading" ? (
          <CardContent className="py-16 text-center text-sm text-neutral-500">
            Loading…
          </CardContent>
        ) : loadState === "missing" || !project ? (
          <UnavailableState />
        ) : (
          <FeedbackForm slug={slug} project={project} />
        )}
      </Card>
    </main>
  );
}

function UnavailableState() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-xl font-medium tracking-tight text-white">
          Feedback page not found
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-neutral-400">
        This feedback page does not exist, or it isn't accepting submissions
        right now. If you reached this page from an app's support link, please
        contact support directly.
      </CardContent>
    </>
  );
}

function FeedbackForm({
  slug,
  project,
}: {
  slug: string;
  project: PublicFeedbackProject;
}) {
  const [kind, setKind] = useState<PublicFeedbackKind>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [didSubmit, setDidSubmit] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!project.turnstileSiteKey) return;

    let scriptElement: HTMLScriptElement | null = null;

    const ensureScript = (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (window.turnstile) {
          resolve();
          return;
        }
        const existing = document.querySelector<HTMLScriptElement>(
          `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
        );
        if (existing) {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("turnstile script failed")), { once: true });
          return;
        }

        scriptElement = document.createElement("script");
        scriptElement.src = TURNSTILE_SCRIPT_SRC;
        scriptElement.async = true;
        scriptElement.defer = true;
        scriptElement.addEventListener("load", () => resolve(), { once: true });
        scriptElement.addEventListener("error", () => reject(new Error("turnstile script failed")), { once: true });
        document.head.appendChild(scriptElement);
      });

    let cancelled = false;
    ensureScript()
      .then(() => {
        if (cancelled || !widgetContainerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(widgetContainerRef.current, {
          sitekey: project.turnstileSiteKey!,
          theme: "dark",
          callback: (next: string) => setToken(next),
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError(
            "Could not load the captcha widget. Please refresh and try again.",
          );
        }
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // already gone — nothing to do
        }
        widgetIdRef.current = null;
      }
    };
  }, [project.turnstileSiteKey]);

  function resetWidget() {
    setToken(null);
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch {
        // ignore
      }
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!project.turnstileSiteKey) {
      setError(
        "This feedback page is missing a captcha configuration. Please contact support directly.",
      );
      return;
    }

    if (!token) {
      setError("Please complete the captcha before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      await submitPublicFeedback(slug, {
        kind,
        title: title.trim(),
        description: description.trim(),
        email: email.trim() === "" ? null : email.trim(),
        turnstileToken: token,
      });
      setDidSubmit(true);
    } catch (nextError) {
      const message =
        nextError instanceof ApiRequestError
          ? nextError.message
          : "Something went wrong. Please try again.";
      setError(message);
      resetWidget();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (didSubmit) {
    return (
      <>
        <CardHeader>
          <div className="flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            <CardTitle className="text-xl font-medium tracking-tight text-white">
              Thanks — we got it.
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-neutral-400">
          <p>
            Your {kind === "bug" ? "bug report" : "feature request"} was sent
            to the {project.name} team. They'll follow up via email if you
            shared one.
          </p>
          <Button
            type="button"
            variant="outline"
            className="border-white/10 bg-neutral-900 text-neutral-100 hover:bg-neutral-800 hover:text-white"
            onClick={() => {
              setTitle("");
              setDescription("");
              setEmail("");
              setDidSubmit(false);
              resetWidget();
            }}
          >
            Send another
          </Button>
        </CardContent>
      </>
    );
  }

  return (
    <>
      <CardHeader className="space-y-1">
        <div className="flex items-center gap-2">
          {project.appIconUrl ? (
            <img
              src={project.appIconUrl}
              alt={`${project.appName ?? project.name} icon`}
              className="size-7 rounded-md border border-white/10"
            />
          ) : (
            <img src="/openwish-icon-dark-192.png" alt="" className="size-7 rounded-md" />
          )}
          <span className="text-sm font-medium tracking-tight text-white">
            {project.appName ?? project.name}
          </span>
        </div>
        <CardTitle className="pt-4 text-xl font-medium tracking-tight text-white">
          Send feedback
        </CardTitle>
        <p className="text-sm text-neutral-500">
          Report a bug or suggest a feature for {project.appName ?? project.name}.
        </p>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Tabs
            value={kind}
            onValueChange={(value) =>
              setKind(value as PublicFeedbackKind)
            }
          >
            <TabsList className="grid w-full grid-cols-2 bg-neutral-900">
              <TabsTrigger
                value="bug"
                className="data-[state=active]:bg-white data-[state=active]:text-black"
              >
                <Bug className="mr-1.5 h-3.5 w-3.5" />
                Bug
              </TabsTrigger>
              <TabsTrigger
                value="wish"
                className="data-[state=active]:bg-white data-[state=active]:text-black"
              >
                <Lightbulb className="mr-1.5 h-3.5 w-3.5" />
                Feature request
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-1.5">
            <label htmlFor="public-feedback-title" className="text-xs uppercase tracking-wider text-neutral-500">
              Title
            </label>
            <Input
              id="public-feedback-title"
              value={title}
              maxLength={80}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={kind === "bug" ? "Crash on launch" : "Add dark mode"}
              required
              className="border-white/10 bg-neutral-900 text-neutral-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="public-feedback-description" className="text-xs uppercase tracking-wider text-neutral-500">
              Description
            </label>
            <Textarea
              id="public-feedback-description"
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              rows={5}
              placeholder={
                kind === "bug"
                  ? "What did you do? What did you expect to happen?"
                  : "What would you like to see? Why is it useful?"
              }
              required
              className="border-white/10 bg-neutral-900 text-neutral-100"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="public-feedback-email" className="text-xs uppercase tracking-wider text-neutral-500">
              Email <span className="text-neutral-600">(optional)</span>
            </label>
            <Input
              id="public-feedback-email"
              type="email"
              value={email}
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="border-white/10 bg-neutral-900 text-neutral-100"
            />
            <p className="text-[11px] text-neutral-600">
              Only used so the team can follow up about this submission.
            </p>
          </div>

          {project.turnstileSiteKey ? (
            <div ref={widgetContainerRef} className="flex justify-center" />
          ) : (
            <p className="rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
              This feedback page is missing a captcha configuration. The
              dashboard admin needs to set <code>OPENWISH_TURNSTILE_SITE_KEY</code>.
            </p>
          )}

          {error ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-9 w-full bg-white text-black hover:bg-neutral-200"
            disabled={
              isSubmitting ||
              !title.trim() ||
              !description.trim() ||
              !project.turnstileSiteKey ||
              !token
            }
          >
            {isSubmitting
              ? "Sending…"
              : kind === "bug"
                ? "Send bug report"
                : "Send feature request"}
          </Button>
        </form>
      </CardContent>
    </>
  );
}
