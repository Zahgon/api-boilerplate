/* eslint-env jest */
import request from 'supertest';
import httpStatus from 'http-status';
import app from '../../index';
import config from '../../config/config';
import db from '../../config/sequelize';

const apiVersionPath = `/api/v${config.apiVersion}`;

/**
 * Every case below pins a seam where the HTTP framework was swapped out.
 * Each one is chosen so that a plausible wrong wiring still compiles and
 * still leaves the inherited suite green - only these assertions catch it.
 */
describe('## Migration seams', () => {
  let testApp;
  let scratchUser;

  beforeAll(async () => {
    await app.ready();
    testApp = request(app.server);
  });

  afterAll((done) => {
    db.sequelize.close()
      .then(() => done())
      .catch(done);
  });

  describe('# Routing seam', () => {
    test('should mount the router under the versioned base path only', () => testApp
      .get(`${apiVersionPath}/health-check`)
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.text).toEqual('OK');
      }));

    test('should not expose routes outside the versioned base path', () => testApp
      .get('/health-check')
      .expect(httpStatus.NOT_FOUND)
      .then((res) => {
        expect(res.body.message).toEqual('Not Found');
      }));

    test('should answer an unknown method on a known path with 404, not 405', () => testApp
      .delete(`${apiVersionPath}/health-check`)
      .expect(httpStatus.NOT_FOUND)
      .then((res) => {
        expect(res.body.message).toEqual('Not Found');
      }));

    test('should serve health-check as html rather than json or plain text', () => testApp
      .get(`${apiVersionPath}/health-check`)
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers['content-type']).toEqual('text/html; charset=utf-8');
      }));
  });

  describe('# Error envelope seam', () => {
    test('should mask a non public error behind its status text', () => testApp
      .get(`${apiVersionPath}/404`)
      .expect(httpStatus.NOT_FOUND)
      .then((res) => {
        expect(res.body).toEqual({ message: 'Not Found', stack: {} });
        expect(res.headers['content-type']).toEqual('application/json; charset=utf-8');
      }));

    test('should let a public error through with its own message', () => testApp
      .post(`${apiVersionPath}/auth/login`)
      .send({ username: 'react', password: 'wrong' })
      .expect(httpStatus.UNAUTHORIZED)
      .then((res) => {
        expect(res.body).toEqual({ message: 'Authentication error', stack: {} });
      }));

    test('should answer an unparseable json body with the framework neutral envelope', () => testApp
      .post(`${apiVersionPath}/auth/login`)
      .set('Content-Type', 'application/json')
      .send('{"username":')
      .expect(httpStatus.BAD_REQUEST)
      .then((res) => {
        expect(res.body).toEqual({ message: 'Bad Request', stack: {} });
      }));
  });

  describe('# Body parsing seam', () => {
    test('should accept a urlencoded login body', () => testApp
      .post(`${apiVersionPath}/auth/login`)
      .type('form')
      .send({ username: 'react', password: 'express' })
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.body.username).toEqual('react');
        expect(res.body).toHaveProperty('token');
      }));

    test('should treat a body of an unsupported content type as an empty body', () => testApp
      .post(`${apiVersionPath}/auth/login`)
      .set('Content-Type', 'text/plain')
      .send('username=react')
      .expect(httpStatus.BAD_REQUEST)
      .then((res) => {
        expect(res.body.message).toEqual('"username" is required');
      }));
  });

  describe('# Validation seam', () => {
    test('should reject an unknown key in the body', () => testApp
      .post(`${apiVersionPath}/users`)
      .send({ username: 'seam-unknown-key', bogus: 1 })
      .expect(httpStatus.BAD_REQUEST)
      .then((res) => {
        expect(res.body.message).toEqual('"bogus" is not allowed');
      }));

    test('should report only the first validation failure', () => testApp
      .post(`${apiVersionPath}/auth/login`)
      .send({})
      .expect(httpStatus.BAD_REQUEST)
      .then((res) => {
        expect(res.body.message).toEqual('"username" is required');
      }));

    test('should load the route parameter before validating the request', () => testApp
      .put(`${apiVersionPath}/users/zzz`)
      .send({ username: 'seam-bad-param' })
      .expect(httpStatus.INTERNAL_SERVER_ERROR)
      .then((res) => {
        expect(res.body.message).toEqual('Internal Server Error');
      }));
  });

  describe('# Authentication seam', () => {
    let token;

    test('should issue a token that carries the username', () => testApp
      .post(`${apiVersionPath}/auth/login`)
      .send({ username: 'react', password: 'express' })
      .expect(httpStatus.OK)
      .then((res) => {
        token = res.body.token;
        expect(typeof token).toEqual('string');
      }));

    test('should reject an authorization scheme that is not bearer', () => testApp
      .get(`${apiVersionPath}/auth/random-number`)
      .set('Authorization', 'NotBearer somevalue')
      .expect(httpStatus.UNAUTHORIZED)
      .then((res) => {
        expect(res.body).toEqual({ message: 'Unauthorized', stack: {} });
      }));

    test('should not expose the decoded token on the property the controller reads', () => testApp
      .get(`${apiVersionPath}/auth/random-number`)
      .set('Authorization', `Bearer ${token}`)
      .expect(httpStatus.OK)
      .then((res) => {
        expect(Object.keys(res.body)).toEqual(['num']);
      }));
  });

  describe('# Method override seam', () => {
    test('should route an overridden post to the get handler', () => testApp
      .post(`${apiVersionPath}/users`)
      .set('X-HTTP-Method-Override', 'GET')
      .expect(httpStatus.OK)
      .then((res) => {
        expect(Array.isArray(res.body)).toEqual(true);
      }));

    test('should vary on the override header for post requests', () => testApp
      .post(`${apiVersionPath}/users`)
      .send({ username: `seam-vary-${Date.now()}` })
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers.vary).toEqual(expect.stringContaining('X-HTTP-Method-Override'));
      }));

    test('should not vary on the override header for get requests', () => testApp
      .get(`${apiVersionPath}/users`)
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers.vary || '').toEqual(expect.not.stringContaining('X-HTTP-Method-Override'));
      }));
  });

  describe('# Response header seam', () => {
    test('should keep the security headers the previous stack sent', () => testApp
      .get(`${apiVersionPath}/users`)
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers['x-content-type-options']).toEqual('nosniff');
        expect(res.headers['x-frame-options']).toEqual('SAMEORIGIN');
        expect(res.headers['x-dns-prefetch-control']).toEqual('off');
        expect(res.headers['referrer-policy']).toEqual('no-referrer');
        expect(res.headers['strict-transport-security'])
          .toEqual('max-age=15552000; includeSubDomains');
        expect(res.headers).toHaveProperty('content-security-policy');
        expect(res.headers['x-powered-by']).toBeUndefined();
      }));

    test('should keep cross origin requests open', () => testApp
      .get(`${apiVersionPath}/users`)
      .set('Origin', 'http://example.com')
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers['access-control-allow-origin']).toEqual('*');
      }));

    test('should still compress when the client asks for it', () => testApp
      .get(`${apiVersionPath}/users`)
      .set('Accept-Encoding', 'gzip')
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers.vary).toEqual(expect.stringContaining('Accept-Encoding'));
      }));

    test('should accept a request carrying cookies', () => testApp
      .get(`${apiVersionPath}/health-check`)
      .set('Cookie', 'seam=1; other=2')
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.text).toEqual('OK');
      }));
  });

  describe('# Serialisation seam', () => {
    test('should create a user and echo the stored record', () => testApp
      .post(`${apiVersionPath}/users`)
      .send({ username: `seam-${Date.now()}` })
      .expect(httpStatus.OK)
      .then((res) => {
        scratchUser = res.body;
        expect(Object.keys(res.body)).toEqual(['id', 'username', 'updatedAt', 'createdAt']);
      }));

    test('should round trip a non ascii username byte for byte', () => testApp
      .post(`${apiVersionPath}/users`)
      .send({ username: `héllo-日本語-${Date.now()}` })
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.headers['content-type']).toEqual('application/json; charset=utf-8');
        expect(res.body.username).toEqual(expect.stringContaining('héllo-日本語-'));
        return testApp.delete(`${apiVersionPath}/users/${res.body.id}`).expect(httpStatus.OK);
      }));

    test('should skip users in id order and report the total on the list route', () => testApp
      .get(`${apiVersionPath}/users`)
      .query({ limit: 50, skip: 1 })
      .expect(httpStatus.OK)
      .then((withSkip) => testApp
        .get(`${apiVersionPath}/users`)
        .query({ limit: 50 })
        .expect(httpStatus.OK)
        .then((withoutSkip) => {
          expect(withSkip.body).toEqual(withoutSkip.body.slice(1));
          expect(withoutSkip.body.map((u) => u.id)).toEqual([...withoutSkip.body.map((u) => u.id)].sort((a, b) => a - b));
          expect(withSkip.headers['x-total-count']).toEqual(String(withoutSkip.body.length));
        })));

    test('should answer a non numeric list limit with an internal error', () => testApp
      .get(`${apiVersionPath}/users`)
      .query({ limit: 'abc' })
      .expect(httpStatus.INTERNAL_SERVER_ERROR)
      .then((res) => {
        expect(res.body.message).toEqual('Internal Server Error');
      }));

    test('should drop an attribute the model does not declare', () => testApp
      .put(`${apiVersionPath}/users/${scratchUser.id}`)
      .send({ id: scratchUser.id, username: `${scratchUser.username}-renamed` })
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.body).not.toHaveProperty('mobileNumber');
        expect(res.body.username).toEqual(`${scratchUser.username}-renamed`);
      }));

    test('should answer a delete with the bare username string', () => testApp
      .delete(`${apiVersionPath}/users/${scratchUser.id}`)
      .expect(httpStatus.OK)
      .then((res) => {
        expect(res.body).toEqual(`${scratchUser.username}-renamed`);
      }));
  });

  describe('# Behaviour added with the migration', () => {
    test('should echo a plain client request id and replace any other', () => testApp
      .get(`${apiVersionPath}/health-check`)
      .set('X-Request-Id', 'trace-1.a_b')
      .expect('X-Request-Id', 'trace-1.a_b')
      .then(() => testApp
        .get(`${apiVersionPath}/health-check`)
        .set('X-Request-Id', 'not plain')
        .then((res) => {
          expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        })));

    test('should answer a duplicate username with a public 409', () => {
      const username = `dup-${Date.now()}`;
      return testApp.post(`${apiVersionPath}/users`).send({ username }).expect(httpStatus.OK)
        .then((created) => testApp.post(`${apiVersionPath}/users`).send({ username })
          .expect(httpStatus.CONFLICT)
          .then((res) => {
            expect(res.body).toEqual({ message: 'Username already exists', stack: {} });
            return testApp.delete(`${apiVersionPath}/users/${created.body.id}`).expect(httpStatus.OK);
          }));
    });

    test('should refuse a stale If-Match and accept the current tag', () => testApp
      .post(`${apiVersionPath}/users`).send({ username: `etag-${Date.now()}` })
      .expect(httpStatus.OK)
      .then((created) => testApp.get(`${apiVersionPath}/users/${created.body.id}`)
        .then((current) => testApp.delete(`${apiVersionPath}/users/${created.body.id}`)
          .set('If-Match', 'W/"0-stale"')
          .expect(httpStatus.PRECONDITION_FAILED)
          .then(() => testApp.delete(`${apiVersionPath}/users/${created.body.id}`)
            .set('If-Match', current.headers.etag)
            .expect(httpStatus.OK)))));
  });
});
