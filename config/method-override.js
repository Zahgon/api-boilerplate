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
 * Access-Control-Request-Method - before compression or the override could
 * contribute, and it varied only on the requested headers. Every other
 * response with a body varied on the encoding, and a POST varied on the
 * override header too - the override read that header whether or not the
 * client sent one, and it ran first, so its field came first.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {Object} [headers] - headers passed to writeHead
 * @returns {?string} null when nothing in the chain varied
 */
function varyFor(req, res, headers) {
  if (req.originalMethod === 'OPTIONS') {
    return 'Access-Control-Request-Headers';
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

/**
 * Restate Vary as the response headers are flushed.
 *
 * The plugins that replaced compression and CORS spell their fields differently
 * and add one of their own, and they write them from hooks that always run
 * after anything the application registers, so the header can only be settled
 * below the framework.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function shapeVary(req, res) {
  const writeHead = res.writeHead.bind(res);

  res.writeHead = (statusCode, ...rest) => { // eslint-disable-line no-param-reassign
    const last = rest[rest.length - 1];

    // writeHead may carry the headers itself, and those win over setHeader
    const headers = last && typeof last === 'object' && !Array.isArray(last) ? last : null;
    const value = varyFor(req, res, headers);

    if (headers) {
      Object.keys(headers)
        .filter((field) => field.toLowerCase() === 'vary')
        .forEach((field) => { delete headers[field]; });

      if (value !== null) {
        headers.Vary = value;
      }
    } else if (value !== null) {
      res.setHeader('Vary', value);
    } else {
      res.removeHeader('Vary');
    }

    return writeHead(statusCode, ...rest);
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
    shapeVary(req, res);
    handler(req, res);
  });
}

export { HEADER };

export default { serverFactory, HEADER };
