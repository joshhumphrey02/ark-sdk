/**
 * PKCE for an app's Google or Apple sign-in (`oauthStartUrl`, then
 * `auth.exchangeOAuthCode`). Keep the verifier in memory (or the phone's
 * secure storage while the browser is open) and send only the challenge.
 */
export interface Pkce {
  /** Secret: only the app that started the sign-in holds it. */
  verifier: string
  /** `base64url(SHA-256(verifier))`, sent as `codeChallenge`. */
  challenge: string
}

export interface PkceCrypto {
  /** Fills the array with cryptographically secure random bytes. */
  getRandomValues(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>
  /** SHA-256 of the UTF-8 text. */
  sha256(text: string): Promise<ArrayBuffer | Uint8Array>
}

function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Web Crypto (browsers, Node, Bun). React Native: pass expo-crypto's equivalents. */
function webCrypto(): PkceCrypto {
  const crypto = globalThis.crypto as Crypto | undefined
  if (!crypto?.getRandomValues || !crypto.subtle)
    throw new Error(
      "No Web Crypto here: pass createPkce({ getRandomValues, sha256 }) (e.g. from expo-crypto)."
    )
  return {
    getRandomValues: (bytes) => crypto.getRandomValues(bytes),
    sha256: (text) =>
      crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  }
}

export async function createPkce(impl: PkceCrypto = webCrypto()): Promise<Pkce> {
  // 32 random bytes → a 43-character verifier (RFC 7636 allows 43–128).
  const verifier = base64url(impl.getRandomValues(new Uint8Array(32)))
  const digest = await impl.sha256(verifier)
  return {
    verifier,
    challenge: base64url(
      digest instanceof Uint8Array ? digest : new Uint8Array(digest)
    ),
  }
}
