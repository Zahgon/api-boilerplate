import userRoutes from './user.route';
import authRoutes from './auth.route';

export default async function routes(router) {
  /** GET /health-check - Check service health */
  // res.send() on a string answered as HTML, so keep the content type explicit
  router.get('/health-check', (request, reply) => reply.type('text/html; charset=utf-8').send('OK'));

  // mount user routes at /users
  router.register(userRoutes, { prefix: '/users' });

  // mount auth routes at /auth
  router.register(authRoutes, { prefix: '/auth' });
}
