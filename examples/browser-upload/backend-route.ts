/**
 * The backend half of a browser upload.
 *
 * Your Ark API token stays here. The browser receives only a short-lived,
 * narrowly-scoped session token, so a leaked page bundle cannot be used to
 * read or delete a customer's files.
 */

import { Ark } from "@ark/server";

const ark = new Ark({ token: process.env.ARK_API_TOKEN! });

// Example: Next.js route handler. Authenticate YOUR user first -- this
// endpoint mints upload authorization, so leaving it open would let anyone
// upload into your Ark account.
export async function POST(request: Request) {
  const user = await authenticate(request);
  if (!user) return new Response("Unauthorized", { status: 401 });

  const session = await ark.createClientSession({
    ttlSeconds: 900,
    folderId: user.uploadFolderId,
  });

  return Response.json({
    token: session.token,
    expiresAt: session.expiresAt,
  });
}

declare function authenticate(
  request: Request,
): Promise<{ uploadFolderId: string } | null>;
