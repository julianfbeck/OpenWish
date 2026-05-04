import { applyCorsHeaders, isApiRequest, preflightResponse } from "../../src/server/api";
import { ensureDatabaseInitialized } from "../../src/server/db";
import type { Bindings, ServerRequestContext } from "../../src/server/types";
import { Route as AuthLoginRoute } from "../../src/routes/api/auth/login";
import { Route as AuthLogoutRoute } from "../../src/routes/api/auth/logout";
import { Route as AuthSessionRoute } from "../../src/routes/api/auth/session";
import { Route as PasskeySummaryRoute } from "../../src/routes/api/auth/passkey/summary";
import { Route as PasskeyListRoute } from "../../src/routes/api/auth/passkey/index";
import { Route as PasskeyDeleteRoute } from "../../src/routes/api/auth/passkey/$credentialId";
import { Route as PasskeyRegisterOptionsRoute } from "../../src/routes/api/auth/passkey/register/options";
import { Route as PasskeyRegisterVerifyRoute } from "../../src/routes/api/auth/passkey/register/verify";
import { Route as PasskeyLoginOptionsRoute } from "../../src/routes/api/auth/passkey/login/options";
import { Route as PasskeyLoginVerifyRoute } from "../../src/routes/api/auth/passkey/login/verify";
import { Route as AdminProjectAnalyticsRoute } from "../../src/routes/api/admin/projects/$slug/analytics";
import { Route as AdminProjectSettingsRoute } from "../../src/routes/api/admin/projects/$slug/settings";
import { Route as AdminProjectTestEmailRoute } from "../../src/routes/api/admin/projects/$slug/test-email";
import { Route as AdminWishCommentsRoute } from "../../src/routes/api/admin/projects/$slug/wishes/$wishId/comments";
import { Route as AdminWishMergeRoute } from "../../src/routes/api/admin/projects/$slug/wishes/$wishId/merge";
import { Route as AdminWishRoute } from "../../src/routes/api/admin/projects/$slug/wishes/$wishId";
import { Route as AdminProjectRoute } from "../../src/routes/api/admin/projects/$slug";
import { Route as AdminProjectsBootstrapRoute } from "../../src/routes/api/admin/projects/bootstrap";
import { Route as AdminProjectsRoute } from "../../src/routes/api/admin/projects";
import { Route as CommentCreateRoute } from "../../src/routes/api/comment/create";
import { Route as UserUpdateRoute } from "../../src/routes/api/user/update";
import { Route as WishCreateRoute } from "../../src/routes/api/wish/create";
import { Route as WishListRoute } from "../../src/routes/api/wish/list";
import { Route as WishVoteRoute } from "../../src/routes/api/wish/vote";
import { Route as BugCreateRoute } from "../../src/routes/api/bug/create";
import { Route as BugListRoute } from "../../src/routes/api/bug/list";
import { Route as BugScreenshotRoute } from "../../src/routes/api/bug/screenshot";
import { Route as AdminBugsRoute } from "../../src/routes/api/admin/projects/$slug/bugs";
import { Route as AdminBugRoute } from "../../src/routes/api/admin/projects/$slug/bugs/$bugId";
import { Route as AdminBugCommentsRoute } from "../../src/routes/api/admin/projects/$slug/bugs/$bugId/comments";
import { Route as AdminBugScreenshotRoute } from "../../src/routes/api/admin/projects/$slug/bugs/$bugId/screenshots/$key";
import { Route as HealthRoute } from "../../src/routes/health";
import { Route as PublicProjectRoute } from "../../src/routes/api/public/projects/$slug";
import { Route as PublicFeedbackRoute } from "../../src/routes/api/public/feedback/$slug";

type ServerHandler = (input: {
  context: ServerRequestContext;
  next: () => Promise<never>;
  params: Record<string, string>;
  pathname: string;
  request: Request;
}) => Promise<Response> | Response;

type HandlerRecord = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", ServerHandler>>;

type RouteDefinition = {
  handlers: HandlerRecord;
  method: keyof HandlerRecord;
  pattern: RegExp;
  paramNames: string[];
};

function createRequest(path: string, init?: RequestInit) {
  const url =
    path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `http://localhost${path}`;

  return new Request(url, init);
}

function routeHandlers(route: any): HandlerRecord {
  return (route?.options?.server?.handlers ?? {}) as HandlerRecord;
}

function route(
  method: keyof HandlerRecord,
  pattern: RegExp,
  paramNames: string[],
  handlers: HandlerRecord,
): RouteDefinition {
  return {
    handlers,
    method,
    pattern,
    paramNames,
  };
}

const routes: RouteDefinition[] = [
  route("GET", /^\/health$/, [], routeHandlers(HealthRoute)),
  route("POST", /^\/api\/auth\/login$/, [], routeHandlers(AuthLoginRoute)),
  route("POST", /^\/api\/auth\/logout$/, [], routeHandlers(AuthLogoutRoute)),
  route("GET", /^\/api\/auth\/session$/, [], routeHandlers(AuthSessionRoute)),
  route("GET", /^\/api\/auth\/passkey\/summary$/, [], routeHandlers(PasskeySummaryRoute)),
  route("GET", /^\/api\/auth\/passkey\/?$/, [], routeHandlers(PasskeyListRoute)),
  route(
    "DELETE",
    /^\/api\/auth\/passkey\/([^/]+)$/,
    ["credentialId"],
    routeHandlers(PasskeyDeleteRoute),
  ),
  route("POST", /^\/api\/auth\/passkey\/register\/options$/, [], routeHandlers(PasskeyRegisterOptionsRoute)),
  route("POST", /^\/api\/auth\/passkey\/register\/verify$/, [], routeHandlers(PasskeyRegisterVerifyRoute)),
  route("POST", /^\/api\/auth\/passkey\/login\/options$/, [], routeHandlers(PasskeyLoginOptionsRoute)),
  route("POST", /^\/api\/auth\/passkey\/login\/verify$/, [], routeHandlers(PasskeyLoginVerifyRoute)),
  route("GET", /^\/api\/admin\/projects$/, [], routeHandlers(AdminProjectsRoute)),
  route("POST", /^\/api\/admin\/projects$/, [], routeHandlers(AdminProjectsRoute)),
  route("POST", /^\/api\/admin\/projects\/bootstrap$/, [], routeHandlers(AdminProjectsBootstrapRoute)),
  route("GET", /^\/api\/admin\/projects\/([^/]+)$/, ["slug"], routeHandlers(AdminProjectRoute)),
  route("DELETE", /^\/api\/admin\/projects\/([^/]+)$/, ["slug"], routeHandlers(AdminProjectRoute)),
  route(
    "GET",
    /^\/api\/admin\/projects\/([^/]+)\/analytics$/,
    ["slug"],
    routeHandlers(AdminProjectAnalyticsRoute),
  ),
  route(
    "PATCH",
    /^\/api\/admin\/projects\/([^/]+)\/settings$/,
    ["slug"],
    routeHandlers(AdminProjectSettingsRoute),
  ),
  route(
    "POST",
    /^\/api\/admin\/projects\/([^/]+)\/test-email$/,
    ["slug"],
    routeHandlers(AdminProjectTestEmailRoute),
  ),
  route(
    "PATCH",
    /^\/api\/admin\/projects\/([^/]+)\/wishes\/([^/]+)$/,
    ["slug", "wishId"],
    routeHandlers(AdminWishRoute),
  ),
  route(
    "DELETE",
    /^\/api\/admin\/projects\/([^/]+)\/wishes\/([^/]+)$/,
    ["slug", "wishId"],
    routeHandlers(AdminWishRoute),
  ),
  route(
    "POST",
    /^\/api\/admin\/projects\/([^/]+)\/wishes\/([^/]+)\/comments$/,
    ["slug", "wishId"],
    routeHandlers(AdminWishCommentsRoute),
  ),
  route(
    "POST",
    /^\/api\/admin\/projects\/([^/]+)\/wishes\/([^/]+)\/merge$/,
    ["slug", "wishId"],
    routeHandlers(AdminWishMergeRoute),
  ),
  route("GET", /^\/api\/wish\/list$/, [], routeHandlers(WishListRoute)),
  route("POST", /^\/api\/wish\/create$/, [], routeHandlers(WishCreateRoute)),
  route("POST", /^\/api\/wish\/vote$/, [], routeHandlers(WishVoteRoute)),
  route("POST", /^\/api\/comment\/create$/, [], routeHandlers(CommentCreateRoute)),
  route("POST", /^\/api\/user\/update$/, [], routeHandlers(UserUpdateRoute)),
  route("POST", /^\/api\/bug\/create$/, [], routeHandlers(BugCreateRoute)),
  route("GET", /^\/api\/bug\/list$/, [], routeHandlers(BugListRoute)),
  route("POST", /^\/api\/bug\/screenshot$/, [], routeHandlers(BugScreenshotRoute)),
  route("GET", /^\/api\/admin\/projects\/([^/]+)\/bugs$/, ["slug"], routeHandlers(AdminBugsRoute)),
  route(
    "PATCH",
    /^\/api\/admin\/projects\/([^/]+)\/bugs\/([^/]+)$/,
    ["slug", "bugId"],
    routeHandlers(AdminBugRoute),
  ),
  route(
    "DELETE",
    /^\/api\/admin\/projects\/([^/]+)\/bugs\/([^/]+)$/,
    ["slug", "bugId"],
    routeHandlers(AdminBugRoute),
  ),
  route(
    "POST",
    /^\/api\/admin\/projects\/([^/]+)\/bugs\/([^/]+)\/comments$/,
    ["slug", "bugId"],
    routeHandlers(AdminBugCommentsRoute),
  ),
  route(
    "GET",
    /^\/api\/admin\/projects\/([^/]+)\/bugs\/([^/]+)\/screenshots\/([^/]+)$/,
    ["slug", "bugId", "key"],
    routeHandlers(AdminBugScreenshotRoute),
  ),
  route(
    "GET",
    /^\/api\/public\/projects\/([^/]+)$/,
    ["slug"],
    routeHandlers(PublicProjectRoute),
  ),
  route(
    "POST",
    /^\/api\/public\/feedback\/([^/]+)$/,
    ["slug"],
    routeHandlers(PublicFeedbackRoute),
  ),
];

export async function requestApp(path: string, init: RequestInit | undefined, env: Bindings) {
  const request = createRequest(path, init);
  const pathname = new URL(request.url).pathname;
  const context: ServerRequestContext = { env };

  await ensureDatabaseInitialized(env.DB);

  if (request.method === "OPTIONS" && isApiRequest(pathname)) {
    return preflightResponse(env);
  }

  const definition = routes.find((candidate) => {
    if (candidate.method !== request.method) {
      return false;
    }

    return candidate.pattern.test(pathname);
  });

  if (!definition) {
    return new Response("Not found", { status: 404 });
  }

  const match = pathname.match(definition.pattern);
  const params = Object.fromEntries(
    definition.paramNames.map((name, index) => [name, match?.[index + 1] ?? ""]),
  );

  const handler = definition.handlers[definition.method];
  if (!handler) {
    return new Response("Method not allowed", { status: 405 });
  }

  const response = await handler({
    context,
    next: async () => {
      throw new Error("next() is not implemented in the test dispatcher.");
    },
    params,
    pathname,
    request,
  });

  if (isApiRequest(pathname)) {
    applyCorsHeaders(response, env);
  }

  return response;
}

export function readSetCookie(response: Response) {
  return response.headers.get("set-cookie");
}
