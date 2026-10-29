/**
 * X-HTTP-Method-Override support, previously supplied by the method-override
 * middleware.
 *
 * The router now runs before any request hook, so the method has to be
 * rewritten underneath it - in the server factory - or the override would be
 * routed on the original method.
 */
import http from 'http';

const HEADER = 'X-HTTP-Method-Override';
const headerKey = HEADER.toLowerCase();

// Only POST was overridable, and the value had to name a real HTTP method.
const OVERRIDABLE = ['POST'];

function supports(method) {
  return http.METHODS.indexOf(method.toUpperCase()) !== -1;
}

/**
 * Rewrite the request method from the override header.
 * @param {http.IncomingMessage} req
 */
function override(req) {
  req.originalMethod = req.originalMethod || req.method; // eslint-disable-line no-param-reassign

  if (OVERRIDABLE.indexOf(req.originalMethod) === -1) {
    return;
  }

  const value = req.headers[headerKey];

  if (!value) {
    return;
  }

  const method = String(value).split(',', 1)[0].trim();

  if (supports(method)) {
    req.method = method.toUpperCase(); // eslint-disable-line no-param-reassign
  }
}

/**
 * Whether the response carries a content type.
 *
 * Compression only varied on the encoding when it had a body it could
 * compress, and it decided that from the content type; a response written
 * without one - a 304, say - was filtered out before it varied.
 * @param {http.ServerResponse} res
 * @param {Object} [headers] - headers passed to writeHead, which win over setHeader
 * @returns {boolean}
 */
function hasContentType(res, headers) {
  if (headers && Object.keys(headers).some((field) => field.toLowerCase() === 'content-type')) {
    return true;
  }

  return Boolean(res.getHeader('Content-Type'));
}

/**
 * The Vary the middleware chain used to produce.
 *
 * A preflight was answered by the CORS middleware itself - it took every
 * OPTIONS request, whether or not one carried an Origin or an
 * Access-Control-Request-Method, including a POST the override had turned
 * into one - before compression could contribute, and it varied on the
 * requested headers, after the override's own field on a POST. Every other
 * response with a body varied on the encoding, and a POST varied on the
 * override header too - the override read that header whether or not the
 * client sent one, and it ran first, so its field came first.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Object} [headers] - headers passed to writeHead
 * @returns {?string} null when nothing in the chain varied
 */
function varyFor(req, res, headers) {
  if (req.bareHeaders) {
    return null;
  }

  if (req.method === 'OPTIONS') {
    // a POST overridden to OPTIONS was varied by the override first
    return OVERRIDABLE.indexOf(req.originalMethod) !== -1
      ? `${HEADER}, Access-Control-Request-Headers`
      : 'Access-Control-Request-Headers';
  }

  const fields = [];

  if (OVERRIDABLE.indexOf(req.originalMethod) !== -1) {
    fields.push(HEADER);
  }

  if (hasContentType(res, headers)) {
    fields.push('Accept-Encoding');
  }

  return fields.length ? fields.join(', ') : null;
}

// helmet's headers, in the order helmet() wrote them
const HELMET = [
  'content-security-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'x-dns-prefetch-control',
  'x-frame-options',
  'strict-transport-security',
  'x-download-options',
  'x-content-type-options',
  'origin-agent-cluster',
  'x-permitted-cross-domain-policies',
  'referrer-policy',
  'x-xss-protection',
];

/**
 * Where a header was written in the middleware chain.
 *
 * Express itself wrote X-Powered-By first; the override varied a POST before
 * helmet ran; helmet, then CORS, wrote their headers; res.send wrote the
 * framing headers and the tag; compression varied every other response as
 * the head was flushed. The CORS preflight varied between its own fields.
 * @param {http.IncomingMessage} req
 * @param {string} name - lower-case header name
 * @returns {number}
 */
function rank(req, name) {
  if (name === 'x-powered-by') return 0;
  if (name === 'x-request-id') return 1;
  if (name === 'vary') {
    if (OVERRIDABLE.indexOf(req.originalMethod) !== -1) return 2;
    if (req.originalMethod === 'OPTIONS') return 43;
    return 70;
  }
  if (HELMET.indexOf(name) !== -1) return 10 + HELMET.indexOf(name);
  const cors = ['access-control-allow-origin', 'access-control-allow-credentials', 'access-control-expose-headers',
    'access-control-allow-methods'];
  if (cors.indexOf(name) !== -1) return 30 + cors.indexOf(name);
  if (name === 'access-control-allow-headers') return 44;
  if (name === 'access-control-max-age') return 45;
  const framing = ['x-total-count', 'content-type', 'content-length', 'etag'];
  if (framing.indexOf(name) !== -1) return 50 + framing.indexOf(name);
  if (name === 'content-encoding') return 71;
  return 80;
}

/**
 * Settle Vary and the header order as the response head is flushed.
 *
 * The plugins that replaced compression and CORS spell their fields
 * differently, add one of their own, and write them - like helmet's
 * replacement - in an order of their own, from hooks that always run after
 * anything the application registers, so both can only be settled below the
 * framework.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function shapeHeaders(req, res) {
  const writeHead = res.writeHead.bind(res);

  res.writeHead = (statusCode, ...rest) => { // eslint-disable-line no-param-reassign
    const last = rest[rest.length - 1];

    // writeHead may carry the headers itself, and those win over setHeader
    const headers = last && typeof last === 'object' && !Array.isArray(last) ? last : null;
    const message = typeof rest[0] === 'string' ? rest[0] : undefined;
    const value = varyFor(req, res, headers);
    const fields = new Map();

    res.getHeaderNames().forEach((name) => fields.set(name, res.getHeader(name)));
    if (headers) {
      Object.keys(headers).forEach((name) => fields.set(name.toLowerCase(), headers[name]));
    }

    if (statusCode === 204 || statusCode === 304) {
      // res.send dropped the framing headers on these; Fastify's own HEAD
      // handling would otherwise put a Content-Length back
      ['content-type', 'content-length', 'transfer-encoding'].forEach((field) => fields.delete(field));
    }

    fields.delete('vary');
    if (value !== null) {
      fields.set('vary', value);
    }

    res.getHeaderNames().forEach((name) => res.removeHeader(name));
    Array.from(fields.keys())
      .map((name, index) => ({ name, index }))
      .sort((a, b) => rank(req, a.name) - rank(req, b.name) || a.index - b.index)
      .forEach(({ name }) => res.setHeader(name, fields.get(name)));

    return message === undefined ? writeHead(statusCode) : writeHead(statusCode, message);
  };
}

/**
 * Server factory handing every request through the override before Fastify
 * routes it.
 * @param {Function} handler - Fastify's request handler.
 * @param {Object} opts - Server options supplied by Fastify.
 * @returns {http.Server}
 */
export function serverFactory(handler, opts) {
  return http.createServer(opts.serverFactoryOptions || {}, (req, res) => {
    override(req);
    shapeHeaders(req, res);
    handler(req, res);
  });
}

export { HEADER };

export default { serverFactory, HEADER };
