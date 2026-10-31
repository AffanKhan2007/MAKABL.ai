import { NotChargedError } from '../gate/budget-gate.ts';

// fetch for provider calls. When the request provably never reached the provider (the name
// did not resolve, the connection was refused, TLS failed before anything was sent), the call
// cannot have been billed, so it fails as NotChargedError and the Gate books nothing.
// Anything that may have happened after the request was sent (a reset mid-response, a
// timeout) stays an ordinary error and is booked at its worst case, as before.

const NEVER_SENT = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

/** The error code fetch reports for a failed connection, if any. */
export function connectCode(err: unknown): string | null {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  return typeof cause?.code === 'string' ? cause.code : null;
}

export async function providerFetch(label: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const code = connectCode(err);
    if (code && NEVER_SENT.has(code)) {
      throw new NotChargedError(`${label} could not be reached (${code}); nothing was sent or charged. Check the network and try again.`);
    }
    throw err;
  }
}
