/**
 * Request body parsing, previously supplied by body-parser.
 *
 * bodyParser.json() and bodyParser.urlencoded({ extended: true }) ran with
 * their defaults: a 100kb limit, strict JSON (only an object or an array at
 * the top level), utf-8 bodies only, and qs parsing of form bodies. Anything
 * neither parser recognised was left as an empty object instead of refused.
 */
import qs from 'qs';
import httpStatus from 'http-status';

// body-parser's '100kb', in bytes; Fastify applies it as its bodyLimit.
export const BODY_LIMIT = 100 * 1024;

const PARAMETER_LIMIT = 1000;
const FIRST_CHAR = /^[\x20\x09\x0a\x0d]*([^\x20\x09\x0a\x0d])/; // eslint-disable-line no-control-regex

/**
 * An error raised while reading the body, before any other middleware ran.
 * @param {string} message
 * @param {number} status
 * @returns {Error}
 */
function bodyError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.bodyParser = true;
  return err;
}

/**
 * Whether an error was raised while reading or parsing the request body.
 * @param {Error} err
 * @returns {boolean}
 */
export function isBodyError(err) {
  return Boolean(err && (err.bodyParser || (typeof err.code === 'string' && err.code.startsWith('FST_ERR_CTP_'))));
}

function charsetOf(request) {
  const match = /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(request.headers['content-type'] || '');
  return match ? match[1].toLowerCase() : undefined;
}

function parseJson(request, body, done) {
  const charset = charsetOf(request) || 'utf-8';

  if (charset.slice(0, 4) !== 'utf-') {
    done(bodyError(`unsupported charset "${charset.toUpperCase()}"`, httpStatus.UNSUPPORTED_MEDIA_TYPE));
    return;
  }

  if (body.length === 0) {
    done(null, {});
    return;
  }

  const first = FIRST_CHAR.exec(body);

  if (!first || (first[1] !== '{' && first[1] !== '[')) {
    done(bodyError('Unexpected token in JSON', httpStatus.BAD_REQUEST));
    return;
  }

  try {
    done(null, JSON.parse(body));
  } catch (err) {
    done(bodyError(err.message, httpStatus.BAD_REQUEST));
  }
}

function parseForm(request, body, done) {
  const charset = charsetOf(request) || 'utf-8';

  if (charset !== 'utf-8') {
    done(bodyError(`unsupported charset "${charset.toUpperCase()}"`, httpStatus.UNSUPPORTED_MEDIA_TYPE));
    return;
  }

  if (body.length === 0) {
    done(null, {});
    return;
  }

  const separators = body.split('&').length - 1;

  if (separators >= PARAMETER_LIMIT) {
    done(bodyError('too many parameters', httpStatus.REQUEST_ENTITY_TOO_LARGE));
    return;
  }

  done(null, qs.parse(body, {
    allowPrototypes: true,
    arrayLimit: Math.max(100, separators),
    depth: Infinity,
    parameterLimit: PARAMETER_LIMIT,
  }));
}

// Fastify parses no body on these methods; body-parser read one on any method.
const UNPARSED = ['GET', 'HEAD'];

/**
 * Whether the request announces a body, as type-is decided it.
 * @param {http.IncomingMessage} req
 * @returns {boolean}
 */
function hasBody(req) {
  return req.headers['transfer-encoding'] !== undefined || !Number.isNaN(Number(req.headers['content-length']));
}

/**
 * The parser body-parser would have run for the request's media type.
 * @param {http.IncomingMessage} req
 * @returns {?Function}
 */
function parserFor(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();

  if (type === 'application/json') {
    return parseJson;
  }

  return type === 'application/x-www-form-urlencoded' ? parseForm : null;
}

/**
 * onRequest hook reading the body of a GET or HEAD request.
 *
 * body-parser ran ahead of the router for every method, so a GET carrying a
 * JSON or form body was parsed - and refused when the body was bad - before
 * anything else looked at it. Fastify never reads a body on these methods.
 * @param {Object} request - the Fastify request.
 * @param {Object} reply - the Fastify reply.
 * @param {Function} done - hook callback.
 */
export function parseUnparsedBody(request, reply, done) {
  const req = request.raw;
  const parser = UNPARSED.indexOf(req.method) !== -1 && hasBody(req) ? parserFor(req) : null;

  if (!parser) {
    done();
    return;
  }

  const chunks = [];
  let size = 0;
  let settled = false;
  const settle = (err) => {
    if (!settled) {
      settled = true;
      done(err);
    }
  };

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      settle(bodyError('request entity too large', httpStatus.REQUEST_ENTITY_TOO_LARGE));
    } else {
      chunks.push(chunk);
    }
  });
  req.on('end', () => {
    if (settled) {
      return;
    }
    parser(request, Buffer.concat(chunks).toString('utf8'), (err, body) => {
      if (!err) {
        request.body = body; // eslint-disable-line no-param-reassign
      }
      settle(err || undefined);
    });
  });
  req.on('error', (err) => settle(bodyError(err.message, httpStatus.BAD_REQUEST)));
}

/**
 * Replace Fastify's parsers with the body-parser behaviour.
 * @param {Object} app - the root Fastify instance.
 */
export default function registerBodyParsers(app) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, parseJson);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, parseForm);
  app.addContentTypeParser('*', (request, payload, done) => {
    payload.resume();
    payload.on('end', () => done(null, {}));
    payload.on('error', done);
  });
}
