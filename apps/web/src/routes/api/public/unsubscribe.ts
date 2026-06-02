import { createFileRoute } from "@tanstack/react-router";

import { setUserUnsubscribed } from "#/server/db";
import { requireRequestContext } from "#/server/route-context";
import { verifyUnsubscribeToken } from "#/server/unsubscribe";

function htmlPage(title: string, message: string, status: number) {
  const body = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0b0c; color: #f4f4f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
      main { max-width: 28rem; padding: 2rem; text-align: center; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #a1a1aa; line-height: 1.5; margin: 0; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;

  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/public/unsubscribe")({
  server: {
    handlers: {
      GET: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const token = new URL(request.url).searchParams.get("token") ?? "";

        const claim = token ? await verifyUnsubscribeToken(requestContext.env, token) : null;
        if (!claim) {
          return htmlPage(
            "Invalid unsubscribe link",
            "This link is invalid or has expired. No changes were made.",
            400,
          );
        }

        await setUserUnsubscribed(requestContext.env.DB, claim.projectId, claim.userUuid);

        return htmlPage(
          "You're unsubscribed",
          "You won't receive any more feedback notification emails for this app.",
          200,
        );
      },
    },
  },
});
