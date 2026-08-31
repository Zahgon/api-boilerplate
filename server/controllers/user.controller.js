import httpStatus from 'http-status';
import db from '../../config/sequelize';

const { User } = db;

/**
 * Load user and append to request.
 */
async function load(request, id) {
  const user = await User.findOne({ where: { id } });
  if (!user) {
    const e = new Error('User does not exist');
    e.status = httpStatus.NOT_FOUND;
    throw e;
  }
  request.user = user; // eslint-disable-line no-param-reassign
}

/**
 * Get user
 * @returns {User}
 */
function get(request, reply) {
  return reply.json(request.user);
}

/**
 * Create new user
 * @property {string} request.body.username - The username of user.
 * @property {string} request.body.mobileNumber - The mobileNumber of user.
 * @returns {User}
 */
async function create(request, reply) {
  const user = User.build({
    username: request.body.username,
  });

  const savedUser = await user.save();
  return reply.json(savedUser);
}

/**
 * Update existing user
 * @property {string} request.body.username - The username of user.
 * @property {string} request.body.mobileNumber - The mobileNumber of user.
 * @returns {User}
 */
async function update(request, reply) {
  const { user } = request;
  user.username = request.body.username;
  user.mobileNumber = request.body.mobileNumber;

  const savedUser = await user.save();
  return reply.json(savedUser);
}

/**
 * Get user list.
 * @property {number} request.query.skip - Number of users to be skipped.
 * @property {number} request.query.limit - Limit number of users to be returned.
 * @returns {User[]}
 */
async function list(request, reply) {
  const { limit = 50 } = request.query;
  const users = await User.findAll({ limit });
  return reply.json(users);
}

/**
 * Delete user.
 * @returns {User}
 */
async function remove(request, reply) {
  const { user } = request;
  const { username } = request.user;
  await user.destroy();
  return reply.json(username);
}

export default {
  load, get, create, update, list, remove,
};
