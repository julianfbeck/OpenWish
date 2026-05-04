import type { RegistrationResponseJSON } from "@simplewebauthn/types";
import { passkeyRegisterVerifyRequestSchema } from "@openwish/shared";
import { createFileRoute } from "@tanstack/react-router";

import { requireDashboardSession } from "#/server/auth";
import { parseJson, publicError } from "#/server/http";
import { verifyAndStoreRegistration } from "#/server/passkeys";
import { requireRequestContext } from "#/server/route-context";

export const Route = createFileRoute("/api/auth/passkey/register/verify")({
  server: {
    handlers: {
      POST: async ({ context, request }) => {
        const requestContext = requireRequestContext(context);
        const session = await requireDashboardSession({
          env: requestContext.env,
          request,
        });
        if (!session.ok) {
          return session.response;
        }

        const bodyResult = await parseJson(request, passkeyRegisterVerifyRequestSchema);
        if (!bodyResult.success) {
          return bodyResult.response;
        }

        const result = await verifyAndStoreRegistration(
          requestContext.env,
          session.session.username,
          bodyResult.data.attestation as RegistrationResponseJSON,
          bodyResult.data.label ?? null,
        );

        if (!result.ok) {
          return publicError(400, result.reason);
        }

        return Response.json({ passkey: result.passkey }, { status: 201 });
      },
    },
  },
});
