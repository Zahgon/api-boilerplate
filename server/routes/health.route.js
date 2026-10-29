export default async function healthRoutes(router) {
  /** GET /health-check - Check service health */
  // res.send() on a string answered as HTML, so keep the content type explicit
  router.get('/', (request, reply) => reply.type('text/html; charset=utf-8').send('OK'));
}
