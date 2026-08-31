import validate from '../../config/validate';
import paramValidation from '../../config/param-validation';
import userCtrl from '../controllers/user.controller';

export default async function userRoutes(router) {
  /** Load user when API with userId route parameter is hit */
  // this ran ahead of any route-level validation, which is why a userId the
  // schema would have rejected still reaches the database
  router.addHook('onRequest', async (request) => {
    if (request.params && request.params.userId !== undefined) {
      await userCtrl.load(request, request.params.userId);
    }
  });

  /** GET /api/users - Get list of users */
  router.get('/', userCtrl.list);

  /** POST /api/users - Create new user */
  router.post('/', { preValidation: validate(paramValidation.createUser) }, userCtrl.create);

  /** GET /api/users/:userId - Get user */
  router.get('/:userId', userCtrl.get);

  /** PUT /api/users/:userId - Update user */
  router.put('/:userId', { preValidation: validate(paramValidation.updateUser) }, userCtrl.update);

  /** DELETE /api/users/:userId - Delete user */
  router.delete('/:userId', userCtrl.remove);
}
