/**
 * Weak entity tags and conditional GET, previously supplied by Express.
 *
 * `res.send` tagged every body it wrote - the `etag` setting defaults to
 * 'weak' - and then answered a matching `If-None-Match` with a bodiless 304.
 * Fastify does none of that, so the behaviour is restated here, including the
 * exact tag Express wrote: the `etag` package's weak entity tag,
 * `W/"<byte length in hex>-<the first 27 characters of the body's base64 sha1>"`.
 *
 * @fastify/etag is not used for this: its `algorithm` option only takes
 * 'fnv1a' or the name of a crypto digest, so it cannot spell that tag, and its
 * hook runs after the compression plugin's, which is too late to drop the
 * framing headers and the body from a 304.
 */
import { createHash } from 'crypto';

// `etag` short-circuits an empty entity rather than hashing it.
const EMPTY_TAG = 'W/"0-2jmj7l5rSw0yVb/vlWAYkK/YBwk"';

/**
 * The weak entity tag Express wrote for a body.
 * @param {string|Buffer} payload - the body about to be written.
 * @returns {string}
 */
export function weakEtag(payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');

  if (body.length === 0) {
    return EMPTY_TAG;
  }

  const digest = createHash('sha1').update(body).digest('base64').substring(0, 27);

  return `W/"${body.length.toString(16)}-${digest}"`;
}

/**
 * The freshness test `req.fresh` performed: weak validation of `If-None-Match`
 * against the tag just written, for a safe method on a cacheable status.
 * @param {Object} request - the Fastify request.
 * @param {Object} reply - the Fastify reply.
 * @param {string} etag - the tag written for this response.
 * @returns {boolean}
 */
function isFresh(request, reply, etag) {
  const { method } = request.raw;

  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const status = reply.statusCode;

  if (!((status >= 200 && status < 300) || status === 304)) {
    return false;
  }

  const noneMatch = request.headers['if-none-match'];

  if (!noneMatch) {
    return false;
  }

  if (noneMatch === '*') {
    return true;
  }

  return noneMatch.split(',').some((candidate) => {
    const tag = candidate.trim();

    return tag === etag || `W/${tag}` === etag || tag === `W/${etag}`;
  });
}

/**
 * onSend hook standing in for the tail of `res.send`.
 *
 * It has to run ahead of every plugin hook - a hook added on the root instance
 * does - so that the compression plugin sees the 304 the way compression saw
 * it: with no body and no content type left to compress.
 * @param {Object} request - the Fastify request.
 * @param {Object} reply - the Fastify reply.
 * @param {*} payload - the body about to be written.
 * @param {Function} done - hook callback.
 */
export function etagHook(request, reply, payload, done) {
  // only a body written through res.send was tagged; the CORS preflight ended
  // the response itself, so it carried no tag
  if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
    done(null, payload);
    return;
  }

  let etag = reply.getHeader('etag');

  if (!etag) {
    etag = weakEtag(payload);
    reply.header('etag', etag);
  }

  if (isFresh(request, reply, etag)) {
    reply.code(304);
  }

  const status = reply.statusCode;

  if (status === 204 || status === 304) {
    // res.send dropped the framing headers and the body on these
    reply.removeHeader('content-type');
    reply.removeHeader('content-length');
    reply.removeHeader('transfer-encoding');
    done(null, null);
    return;
  }

  done(null, payload);
}

export default { weakEtag, etagHook };
