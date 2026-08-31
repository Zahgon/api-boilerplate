import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import httpStatus from 'http-status';
import config from './config';
import logger from './winston/get-default-logger';
import { ValidationError } from './validate';
import { serverFactory } from './method-override';
import { etagHook } from './etag';
import routes from '../server/routes/index.route';
import APIError from '../server/helpers/APIError';

// Define default HTTP logger instance (use default logger instance)
const winstonInstance = logger;

const app = Fastify({ serverFactory });

// parse body params and attach them to request.body
// anything body-parser did not recognise was left as an empty object rather
// than refused, so keep that behaviour.
app.removeContentTypeParser('text/plain');
app.addContentTypeParser('*', (request, payload, done) => {
  payload.resume();
  payload.on('end', () => done(null, {}));
  payload.on('error', done);
});

// body-parser.json() left an absent or empty body as an empty object too, so
// the route's own validation reported the missing field. Fastify's parser
// refuses it instead, and the refusal is raised before preValidation runs,
// which hid that message behind a bare 400. Parse it the way body-parser did.
app.removeContentTypeParser('application/json');
app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
  if (body === undefined || body === null || body.trim() === '') {
    done(null, {});
    return;
  }

  try {
    done(null, JSON.parse(body));
  } catch (err) {
    err.statusCode = 400;
    done(err);
  }
});

app.register(formbody);

// tag every body the way res.send did, and answer a matching If-None-Match
// with a 304. Registered on the root instance so it runs before the plugins'
// own hooks, as res.send ran before compression wrote its headers.
app.addHook('onSend', etagHook);

app.register(cookie);
app.register(compress);

// secure apps by setting various HTTP headers
app.register(helmet);

// enable CORS - Cross Origin Resource Sharing
// cors() answered any OPTIONS request as a preflight, whether or not it
// carried an Origin or an Access-Control-Request-Method; @fastify/cors demands
// both unless strict preflighting is turned off.
app.register(cors, { strictPreflight: false });

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
