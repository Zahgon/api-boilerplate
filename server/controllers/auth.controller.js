import jwt from 'jsonwebtoken';
import httpStatus from 'http-status';
import APIError from '../helpers/APIError';
import config from '../../config/config';

// sample user, used for authentication
const user = {
  username: 'react',
  // deepcode ignore NoHardcodedPasswords: for demostration purposes
  password: 'express',
};

/**
 * Returns jwt token if valid username and password is provided
 * @param request
 * @param reply
 * @returns {*}
 */
function login(request, reply) {
  // Ideally you'll fetch this from the db
  // Idea here was to show how jwt works with simplicity
  if (request.body.username === user.username && request.body.password === user.password) {
    const token = jwt.sign({
      username: user.username,
      expiresIn: 3600,
    }, config.jwtSecret);
    return reply.json({
      token,
      username: user.username,
    });
  }

  const err = new APIError('Authentication error', httpStatus.UNAUTHORIZED, true);
  throw err;
}

/**
 * This is a protected route. Will return random number only if jwt token is provided in header.
 * @param request
 * @param reply
 * @returns {*}
 */
function getRandomNumber(request, reply) {
  // request.user is assigned by jwt middleware if valid token is provided
  return reply.json({
    user: request.user,
    num: Math.random() * 100,
  });
}

export default { login, getRandomNumber };
