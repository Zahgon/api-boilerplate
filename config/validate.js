/**
 * Request validation, previously supplied by express-validation.
 *
 * The segment order, the single-error reporting (Joi aborts early by default)
 * and the shape of the thrown error are all kept as they were, because the
 * error handler in ./fastify reads `err.details.body` directly.
 */
import Joi from 'joi'; // eslint-disable-line no-unused-vars
import httpStatus from 'http-status';

// Order in which request segments were validated.
const parameters = ['headers', 'params', 'query', 'cookies', 'signedCookies', 'body'];

/**
 * Carries the per-segment Joi details the error handler unpacks.
 */
export class ValidationError extends Error {
  constructor(errors, statusCode = httpStatus.BAD_REQUEST) {
    super('Validation Failed');
    this.name = 'ValidationError';
    this.statusCode = statusCode;
    this.error = httpStatus[statusCode];
    this.details = errors;
  }
}

/**
 * Build a preValidation hook enforcing the segments declared by `schema`.
 * @param {Object} schema - Joi schemas keyed by request segment.
 * @returns {Function}
 */
export default function validate(schema) {
  return async function validateRequest(request) {
    // body-parser always left an object behind - including for a body sent
    // with a content type it did not recognise - so an unparsed body has to
    // reach validation as an empty object rather than as undefined.
    const source = {
      headers: request.headers,
      params: request.params,
      query: request.query,
      cookies: request.cookies,
      signedCookies: request.signedCookies,
      body: request.body || {},
    };

    const errors = await parameters.reduce(async (acc, parameter) => {
      const collected = await acc;

      if (!source[parameter] || !schema[parameter]) {
        return collected;
      }

      try {
        await schema[parameter].validateAsync(source[parameter], { warnings: true });
        return collected;
      } catch (e) {
        return { ...collected, [parameter]: e.details };
      }
    }, Promise.resolve(null));

    if (errors) {
      throw new ValidationError(errors);
    }
  };
}
