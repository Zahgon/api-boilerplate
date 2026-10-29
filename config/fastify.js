import { randomUUID } from 'crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import httpStatus from 'http-status';
import qs from 'qs';
import config from './config';
import logger from './winston/get-default-logger';
import { ValidationError } from './validate';
import { serverFactory } from './method-override';
import { etagHook } from './etag';
import registerBodyParsers, { BODY_LIMIT, isBodyError, parseUnparsedBody } from './body-parsing';
import routes from '../server/routes/index.route';
import APIError from '../server/helpers/APIError';

// Define default HTTP logger instance (use default logger instance)
const winstonInstance = logger;

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * The client's X-Request-Id when it is a single plain token, else a fresh one.
 * Node joins a repeated header with ", ", which the pattern refuses.
 * @param {http.IncomingMessage} req
 * @returns {string}
 */
function requestId(req) {
  const supplied = req.headers['x-request-id'];
  return typeof supplied === 'string' && REQUEST_ID.test(supplied) ? supplied : randomUUID();
}

const app = Fastify({
  serverFactory,
  requestIdHeader: false,
  genReqId: requestId,
  // Express routing was case-insensitive and ignored a trailing slash, and
  // its path matching collapsed repeated slashes
  caseSensitive: false,
  ignoreTrailingSlash: true,
  ignoreDuplicateSlashes: true,
  bodyLimit: BODY_LIMIT,
  // the 'extended' query parser
  querystringParser: (str) => qs.parse(str, { allowPrototypes: true }),
});

// first hook on the root instance, so every answer carries the id
app.addHook('onRequest', (request, reply, done) => {
  reply.header('x-request-id', request.id);
  done();
});

// parse body params and attach them to request.body
registerBodyParsers(app);
app.addHook('onRequest', parseUnparsedBody);

// tag every body the way res.send did, and answer a matching If-None-Match
// with a 304. Registered on the root instance so it runs before the plugins'
// own hooks, as res.send ran before compression wrote its headers.
app.addHook('onSend', etagHook);

app.register(cookie);
// compression only ever offered gzip and deflate
app.register(compress, { encodings: ['gzip', 'deflate'] });

// secure apps by setting various HTTP headers
app.register(helmet);

// enable CORS - Cross Origin Resource Sharing
// cors() answered any OPTIONS request as a preflight, whether or not it
// carried an Origin or an Access-Control-Request-Method; @fastify/cors demands
// both unless strict preflighting is turned off.
app.register(cors, { strictPreflight: false, exposedHeaders: ['X-Request-Id', 'X-Total-Count'] });

// send JSON the way res.json did: no schema serialisation, so property order
// survives untouched
app.decorateReply('json', function json(payload) {
  return this.type('application/json; charset=utf-8').send(JSON.stringify(payload));
});

// This is really just a test output and should be the first thing you see
winstonInstance.info('The application is starting...');

// enable detailed API logging in dev env
if (config.env === 'development') {
  app.addHook('onResponse', async (request, reply) => {
    winstonInstance.info(`HTTP ${request.method} ${request.url} ${reply.statusCode} ${reply.elapsedTime}ms`, {
      req: { method: request.method, url: request.url, body: request.body },
      res: { statusCode: reply.statusCode },
      responseTime: reply.elapsedTime,
    });
  });
}

// Get API Version from .env (or else assume 1.0)
const baseUrl = `/api/v${config.apiVersion}`;

// mount all routes on /api path
app.register(routes, { prefix: `${baseUrl}` });

// catch 404 and forward to error handler
app.setNotFoundHandler(() => {
  throw new APIError('API not found', httpStatus.NOT_FOUND);
});

// error handler, send stacktrace only during development
app.setErrorHandler((err, request, reply) => {
  let error = err;

  if (isBodyError(err)) {
    // body-parser ran ahead of every other middleware, so a body it refused
    // was answered before helmet, CORS, compression or the override had
    // touched the response: only Express's own header was there
    reply.raw.getHeaderNames().forEach((name) => reply.raw.removeHeader(name));
    Object.keys(reply.getHeaders()).forEach((name) => reply.removeHeader(name));
    reply.header('x-powered-by', 'Express');
    reply.header('x-request-id', request.id);
    request.raw.bareHeaders = true; // eslint-disable-line no-param-reassign
  }

  // if error is not an instanceOf APIError, convert it.
  if (error instanceof ValidationError) {
    // validation error contains errors which is an array of error each containing message[]
    const unifiedErrorMessage = error.details.body.map((e) => e.message).join(' and ');
    error = new APIError(unifiedErrorMessage, error.statusCode, true);
  } else if (!(error instanceof APIError)) {
    // errors raised by the framework itself carry statusCode rather than status
    error = new APIError(error.message, error.status || error.statusCode, error.isPublic);
  }

  // log error in winston transports except when executing test suite
  if (config.env !== 'test') {
    winstonInstance.error(`${request.method} ${request.url} ${error.status}`, {
      err: error,
      stack: error.stack,
    });
  }

  return reply.code(error.status).type('application/json; charset=utf-8').send(JSON.stringify({
    message: error.isPublic ? error.message : httpStatus[error.status],
    stack: config.env === 'development' ? error.stack : {},
  }));
});

export default app;
