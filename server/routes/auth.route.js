import jwt from '@fastify/jwt';
import httpStatus from 'http-status';
import validate from '../../config/validate';
import paramValidation from '../../config/param-validation';
import authCtrl from '../controllers/auth.controller';
import config from '../../config/config';

export default async function authRoutes(router) {
  // the decoded payload was published as request.auth, not request.user
  router.register(jwt, {
    secret: config.jwtSecret,
    decoratorName: 'auth',
    verify: {
      algorithms: ['HS256'],
    },
  });

  /**
   * POST /api/auth/login - Returns token if correct username and password is provided
   */
  router.post('/login', { preValidation: validate(paramValidation.login) }, authCtrl.login);

  /** GET /api/auth/random-number - Protected route,
   * needs token returned by the above as header.
   * Authorization: Bearer {token}
   */
  router.get('/random-number', {
    onRequest: async (request) => {
      try {
        await request.jwtVerify();
      } catch (e) {
        // every credential problem answered 401, including a malformed header
        e.status = httpStatus.UNAUTHORIZED; // eslint-disable-line no-param-reassign
        throw e;
      }
    },
  }, authCtrl.getRandomNumber);
}
