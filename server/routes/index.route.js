import healthRoutes from './health.route';
import userRoutes from './user.route';
import authRoutes from './auth.route';

export default async function routes(router) {
  // mount the health check at /health-check
  router.register(healthRoutes, { prefix: '/health-check' });

  // mount user routes at /users
  router.register(userRoutes, { prefix: '/users' });

  // mount auth routes at /auth
  router.register(authRoutes, { prefix: '/auth' });
}
