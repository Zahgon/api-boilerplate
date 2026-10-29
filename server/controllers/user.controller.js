import httpStatus from 'http-status';
import db from '../../config/sequelize';
import { weakEtag } from '../../config/etag';
import APIError from '../helpers/APIError';

const { User } = db;
const { Op } = db.Sequelize;

/**
 * Run a write inside a transaction that holds the Users table lock. The lock
 * mode conflicts with itself, so creates, renames and deletes take their turn
 * while reads go on; a write therefore decides on the state it changes.
 * @param {Function} write - receives the transaction.
 */
function underWriteLock(write) {
  return db.sequelize.transaction(async (transaction) => {
    await db.sequelize.query('LOCK TABLE "Users" IN SHARE ROW EXCLUSIVE MODE', { transaction });
    return write(transaction);
  });
}

/**
 * Refuse a username another user holds in any letter case.
 * @param {string} username - the username about to be stored.
 * @param {number} [ownId] - the user being renamed, which may keep its own name.
 */
async function assertFreeUsername(username, ownId, transaction) {
  const sameName = db.sequelize.where(db.sequelize.fn('lower', db.sequelize.col('username')),
    db.sequelize.fn('lower', username));
  const where = ownId === undefined ? sameName : { [Op.and]: [sameName, { id: { [Op.ne]: ownId } }] };
  if (await User.findOne({ where, transaction })) {
    throw new APIError('Username already exists', httpStatus.CONFLICT, true);
  }
}

function userNotFound() {
  const e = new Error('User does not exist');
  e.status = httpStatus.NOT_FOUND;
  return e;
}

/**
 * Whether If-Match names none of the tags of the user's current representation
 * (the ETag GET /users/:userId answers), compared with or without W/.
 * @returns {boolean} false when the request carries no If-Match
 */
function preconditionFailed(condition, user) {
  if (condition === undefined || condition.trim() === '*') {
    return false;
  }
  const current = weakEtag(JSON.stringify(user)).replace(/^W\//, '');
  return !condition.split(',').some((tag) => tag.trim().replace(/^W\//, '') === current);
}

/**
 * Read the loaded user's row again under the write lock, so a concurrent
 * delete answers 404 and a concurrent change fails If-Match.
 */
async function currentUser(request, transaction) {
  const user = await User.findOne({ where: { id: request.user.id }, transaction });
  if (!user) {
    throw userNotFound();
  }
  if (preconditionFailed(request.headers['if-match'], user)) {
    throw new APIError('Precondition failed', httpStatus.PRECONDITION_FAILED);
  }
  return user;
}

/**
 * Load user and append to request.
 */
async function load(request, id) {
  const user = await User.findOne({ where: { id } });
  if (!user) {
    throw userNotFound();
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

  const savedUser = await underWriteLock(async (transaction) => {
    await assertFreeUsername(user.username, undefined, transaction);
    return user.save({ transaction });
  });
  return reply.json(savedUser);
}

/**
 * Update existing user
 * @property {string} request.body.username - The username of user.
 * @property {string} request.body.mobileNumber - The mobileNumber of user.
 * @returns {User}
 */
async function update(request, reply) {
  const savedUser = await underWriteLock(async (transaction) => {
    const user = await currentUser(request, transaction);
    user.username = request.body.username;
    user.mobileNumber = request.body.mobileNumber;
    await assertFreeUsername(user.username, user.id, transaction);
    return user.save({ transaction });
  });
  return reply.json(savedUser);
}

/**
 * Get user list.
 * @property {number} request.query.skip - Number of users to be skipped.
 * @property {number} request.query.limit - Limit number of users to be returned.
 * @returns {User[]}
 */
async function list(request, reply) {
  const { limit = 50, skip = 0 } = request.query;
  const { count, rows } = await User.findAndCountAll({ limit, offset: skip, order: [['id', 'ASC']] });
  reply.header('X-Total-Count', String(count));
  return reply.json(rows);
}

/**
 * Delete user.
 * @returns {User}
 */
async function remove(request, reply) {
  const username = await underWriteLock(async (transaction) => {
    const user = await currentUser(request, transaction);
    await user.destroy({ transaction });
    return user.username;
  });
  return reply.json(username);
}

export default {
  load, get, create, update, list, remove,
};
