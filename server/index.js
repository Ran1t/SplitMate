import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Group from './models/Group.js';
import Expense from './models/Expense.js';
import Settlement from './models/Settlement.js';
import PaymentAttempt from './models/PaymentAttempt.js';
import { requireAuth } from './middleware/auth.js';
import asyncHandler from './utils/asyncHandler.js';
import { calculateAllocations, calculateBalances } from './utils/balances.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
const app = express();
const serverDirectory = path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], baseUri: ["'self'"], frameAncestors: ["'self'"], objectSrc: ["'none'"],
  scriptSrc: ["'self'", 'https://checkout.razorpay.com'], scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'], fontSrc: ["'self'", 'https:', 'data:'], imgSrc: ["'self'", 'https:', 'data:'],
  connectSrc: ["'self'", 'https://api.razorpay.com'], frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com', 'https://*.razorpay.com']
} } }));
const configuredOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(origin => origin.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin)) return callback(null, true);
    // Vite may print a LAN URL in development. Permit its IPv4 host on the dev port;
    // production remains restricted to CLIENT_ORIGIN.
    const isDevViteOrigin = process.env.NODE_ENV !== 'production' && /^http:\/\/(?:localhost|127\.0\.0\.1|(?:\d{1,3}\.){3}\d{1,3}):517[3-9]$/.test(origin);
    if (isDevViteOrigin) return callback(null, true);
    return callback(new Error('This browser origin is not allowed by CORS.'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
const wrap = fn => asyncHandler(fn);
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid ID.');
const profileShape = z.object({ name: z.string().trim().min(1).max(80) });
const groupShape = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(240).optional().default('') });
const expenseShape = z.object({ description: z.string().trim().min(1).max(120), amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), category: z.enum(['Food & drink', 'Groceries', 'Transport', 'Accommodation', 'Entertainment', 'Utilities', 'Other']), payer: objectId, date: z.coerce.date(), split: z.object({ type: z.enum(['equal', 'custom', 'percent']), memberIds: z.array(objectId).optional(), allocations: z.array(z.object({ memberId: objectId, amountCents: z.number().int().nonnegative().optional(), percent: z.number().nonnegative().optional() })).optional() }) });
const settlementShape = z.object({ to: objectId, amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), note: z.string().trim().max(160).optional().default(''), date: z.coerce.date().optional() });
function parse(schema, value) { const result = schema.safeParse(value); if (!result.success) { const error = new Error(result.error.issues[0].message); error.status = 400; throw error; } return result.data; }
function setAuthCookie(res, user) {
  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.cookie('splitmate', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000, path: '/' });
}
const publicUser = user => ({ _id: user._id, name: user.name, email: user.email, currency: user.currency });
function suggestTransfers(group, balances) {
  const names = new Map(group.members.map(member => [String(member._id || member), member.name || 'Member']));
  const debtors = balances.filter(row => row.balanceCents < 0).map(row => ({ id: row.userId, amount: -row.balanceCents }));
  const creditors = balances.filter(row => row.balanceCents > 0).map(row => ({ id: row.userId, amount: row.balanceCents }));
  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].amount, creditors[j].amount);
    if (cents) transfers.push({ from: debtors[i].id, fromName: names.get(debtors[i].id), to: creditors[j].id, toName: names.get(creditors[j].id), amountCents: cents });
    debtors[i].amount -= cents; creditors[j].amount -= cents;
    if (debtors[i].amount === 0) i++;
    if (creditors[j].amount === 0) j++;
  }
  return transfers;
}
function razorpayReady() {
  return Boolean(process.env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') && process.env.RAZORPAY_KEY_SECRET);
}
async function razorpayRequest(path, method = 'GET', body) {
  if (!razorpayReady()) { const error = new Error('Razorpay test keys are not configured on the server.'); error.status = 503; throw error; }
  const authorization = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${authorization}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error?.description || 'Razorpay could not process this request.'); error.status = response.status >= 500 ? 502 : 400; throw error; }
  return result;
}
function safeSignatureEqual(expected, supplied) {
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
async function confirmCapturedPayment(attempt, paymentId, verifiedPayment) {
  if (attempt.status === 'paid') return Settlement.findById(attempt.settlement).populate('from to', 'name email');
  let payment = verifiedPayment || await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}`);
  if (payment.order_id !== attempt.orderId || payment.amount !== attempt.amountCents || payment.currency !== attempt.currency) {
    const error = new Error('The payment details do not match this SplitMate payment.'); error.status = 400; throw error;
  }
  if (payment.status === 'authorized' && !payment.captured) {
    payment = await razorpayRequest(`/payments/${encodeURIComponent(paymentId)}/capture`, 'POST', { amount: attempt.amountCents, currency: attempt.currency });
  }
  if (payment.status !== 'captured' || !payment.captured) {
    const error = new Error('Razorpay has not captured this payment yet. The group balance was not changed.'); error.status = 409; throw error;
  }

  const session = await mongoose.startSession();
  let settlementId;
  try {
    await session.withTransaction(async () => {
      const current = await PaymentAttempt.findById(attempt._id).session(session);
      if (!current) { const error = new Error('Payment attempt not found.'); error.status = 404; throw error; }
      if (current.status === 'paid') { settlementId = current.settlement; return; }
      const group = await Group.findById(current.group).session(session);
      if (!group) { const error = new Error('Group not found.'); error.status = 404; throw error; }
      await Group.updateOne({ _id: group._id }, { $inc: { balanceRevision: 1 } }, { session });
      const [expenses, settlements, otherPending] = await Promise.all([
        Expense.find({ group: group._id }).populate('payer', 'name').session(session),
        Settlement.find({ group: group._id }).session(session),
        PaymentAttempt.aggregate([{ $match: { group: group._id, from: current.from, to: current.to, status: 'pending', _id: { $ne: current._id } } }, { $group: { _id: null, total: { $sum: '$amountCents' } } }]).session(session)
      ]);
      const balances = calculateBalances(group, expenses, settlements);
      const sender = balances.find(row => row.userId === String(current.from))?.balanceCents || 0;
      const recipient = balances.find(row => row.userId === String(current.to))?.balanceCents || 0;
      if (sender >= 0 || recipient <= 0 || current.amountCents + (otherPending[0]?.total || 0) > Math.min(-sender, recipient)) {
        const error = new Error('This payment was captured, but the balance changed before it could be matched. Contact the group creator to reconcile it.'); error.status = 409; throw error;
      }
      const settlement = new Settlement({ group: group._id, from: current.from, to: current.to, amountCents: current.amountCents, currency: current.currency, note: 'Paid with Razorpay test mode', paymentProvider: 'razorpay', paymentId, orderId: current.orderId, date: new Date() });
      await settlement.save({ session });
      current.status = 'paid'; current.paymentId = paymentId; current.settlement = settlement._id; current.paidAt = new Date();
      await current.save({ session });
      settlementId = settlement._id;
    });
  } finally { await session.endSession(); }
  return Settlement.findById(settlementId).populate('from to', 'name email');
}

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.post('/api/auth/register', authLimit, wrap(async (req, res) => {
  const data = parse(z.object({ name: z.string().trim().min(1).max(80), email: z.string().email().max(160), password: z.string().min(8).max(100) }), req.body);
  const email = data.email.toLowerCase();
  if (await User.exists({ email })) return res.status(409).json({ error: 'An account with this email already exists.' });
  const user = await User.create({ ...data, email, password: await bcrypt.hash(data.password, 12) });
  setAuthCookie(res, user); res.status(201).json({ user: publicUser(user) });
}));
app.post('/api/auth/login', authLimit, wrap(async (req, res) => {
  const data = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const user = await User.findOne({ email: data.email.toLowerCase() }).select('+password');
  if (!user || !await bcrypt.compare(data.password, user.password)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  setAuthCookie(res, user); res.json({ user: publicUser(user) });
}));
app.post('/api/auth/logout', (req, res) => { res.clearCookie('splitmate', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.patch('/api/profile', requireAuth, wrap(async (req, res) => { const data = parse(profileShape, req.body); const user = await User.findByIdAndUpdate(req.user.id, data, { new: true, runValidators: true }); res.json({ user: publicUser(user) }); }));
app.get('/api/invitations', requireAuth, wrap(async (req, res) => {
  const groups = await Group.find({ 'invitations.email': req.user.email, 'invitations.status': 'pending' }).populate('creator', 'name email').populate('invitations.invitedBy', 'name email');
  const invitations = groups.flatMap(group => group.invitations.filter(invite => invite.email === req.user.email && invite.status === 'pending').map(invite => ({
    _id: invite._id, email: invite.email, invitedAt: invite.invitedAt, invitedBy: invite.invitedBy,
    group: { _id: group._id, name: group.name, description: group.description, currency: group.currency, creator: group.creator }
  })));
  res.json(invitations);
}));
app.patch('/api/invitations/:invitationId', requireAuth, wrap(async (req, res) => {
  if (!objectId.safeParse(req.params.invitationId).success) return res.status(400).json({ error: 'Invalid invitation ID.' });
  const { action } = parse(z.object({ action: z.enum(['accept', 'decline']) }), req.body);
  const group = await Group.findOne({ 'invitations._id': req.params.invitationId });
  const invitation = group?.invitations.id(req.params.invitationId);
  if (!group || !invitation || invitation.email !== req.user.email) return res.status(404).json({ error: 'Invitation not found.' });
  if (invitation.status !== 'pending') return res.status(409).json({ error: 'This invitation has already been answered.' });
  invitation.status = action === 'accept' ? 'accepted' : 'declined'; invitation.respondedAt = new Date();
  if (action === 'accept') group.members.addToSet(req.user._id);
  await group.save();
  res.json({ ok: true, action, groupId: group._id });
}));

app.get('/api/groups', requireAuth, wrap(async (req, res) => {
  const groups = await Group.find({ members: req.user.id, archived: false }).populate('members', 'name email').sort({ updatedAt: -1 }); res.json(groups);
}));
app.post('/api/groups', requireAuth, wrap(async (req, res) => {
  const data = parse(groupShape, req.body); const group = await Group.create({ ...data, currency: 'INR', creator: req.user.id, members: [req.user.id] });
  res.status(201).json(await group.populate('members', 'name email'));
}));
const loadGroup = wrap(async (req, res, next) => {
  const id = objectId.safeParse(req.params.id); if (!id.success) return res.status(400).json({ error: 'Invalid group ID.' });
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found.' });
  if (!group.members.some(member => String(member) === String(req.user.id))) return res.status(403).json({ error: 'You are not a member of this group.' });
  req.group = group; next();
});
app.get('/api/groups/:id', requireAuth, loadGroup, wrap(async (req, res) => {
  const filter = { group: req.group.id };
  if (req.query.category) filter.category = req.query.category;
  if (req.query.payer) { if (!objectId.safeParse(req.query.payer).success) return res.status(400).json({ error: 'Invalid payer ID.' }); filter.payer = req.query.payer; }
  if (req.query.from || req.query.to) {
    filter.date = {};
    if (req.query.from) { const from = new Date(req.query.from); if (Number.isNaN(from.valueOf())) return res.status(400).json({ error: 'Invalid start date.' }); filter.date.$gte = from; }
    if (req.query.to) { const to = new Date(req.query.to); if (Number.isNaN(to.valueOf())) return res.status(400).json({ error: 'Invalid end date.' }); to.setHours(23, 59, 59, 999); filter.date.$lte = to; }
  }
  const [group, expenses, settlements] = await Promise.all([
    req.group.populate([{ path: 'members', select: 'name email' }, { path: 'creator', select: 'name email' }, { path: 'invitations.invitedBy', select: 'name email' }]),
    Expense.find(filter).populate('payer', 'name email').populate('creator', 'name').populate('allocations.member', 'name email').sort({ date: -1 }),
    Settlement.find({ group: req.group.id }).populate('from to', 'name email').sort({ date: -1 })
  ]);
  const allExpenses = await Expense.find({ group: req.group.id }).populate('payer', 'name');
  const balances = calculateBalances(group, allExpenses, settlements).map(row => ({ ...row, user: row.userId }));
  res.json({ group, expenses, settlements, balances, totalSpentCents: allExpenses.reduce((sum, expense) => sum + expense.amountCents, 0), suggestedTransfers: suggestTransfers(group, balances) });
}));
app.post('/api/groups/:id/members', requireAuth, loadGroup, wrap(async (req, res) => {
  if (String(req.group.creator) !== String(req.user.id)) return res.status(403).json({ error: 'Only the group creator can invite members.' });
  const data = parse(z.object({ email: z.string().email() }), req.body);
  const email = data.email.toLowerCase();
  if (email === req.user.email) return res.status(400).json({ error: 'You are already a member of this group.' });
  const invitedUser = await User.findOne({ email });
  if (invitedUser && req.group.members.some(id => String(id) === String(invitedUser.id))) return res.status(409).json({ error: 'That person is already a member.' });
  let invitation = req.group.invitations.find(item => item.email === email);
  if (invitation?.status === 'pending') return res.status(409).json({ error: 'An invitation to this email is already pending.' });
  if (invitation) {
    invitation.status = 'pending'; invitation.user = invitedUser?._id || null; invitation.invitedBy = req.user._id; invitation.invitedAt = new Date(); invitation.respondedAt = null;
  } else {
    req.group.invitations.push({ email, user: invitedUser?._id || null, invitedBy: req.user._id });
  }
  await req.group.save();
  res.status(201).json({ message: `Invitation created for ${email}. They can accept it from SplitMate after signing in${invitedUser ? '' : ' or registering with this email'}.`, invitation: req.group.invitations.find(item => item.email === email) });
}));
app.patch('/api/groups/:id', requireAuth, loadGroup, wrap(async (req, res) => {
  if (String(req.group.creator) !== String(req.user.id)) return res.status(403).json({ error: 'Only the group creator can archive this group.' });
  const { archived } = parse(z.object({ archived: z.boolean() }), req.body);
  req.group.archived = archived; await req.group.save(); res.json(req.group);
}));

app.post('/api/groups/:id/expenses', requireAuth, loadGroup, wrap(async (req, res) => {
  const data = parse(expenseShape, req.body);
  if (!req.group.members.some(id => String(id) === data.payer)) return res.status(400).json({ error: 'The payer must belong to this group.' });
  const allocations = calculateAllocations(data.amountCents, data.split, req.group.members);
  const expense = await Expense.create({ ...data, splitType: data.split.type, group: req.group.id, creator: req.user.id, allocations });
  res.status(201).json(await expense.populate('payer allocations.member', 'name email'));
}));
app.patch('/api/groups/:id/expenses/:expenseId', requireAuth, loadGroup, wrap(async (req, res) => {
  if (!objectId.safeParse(req.params.expenseId).success) return res.status(400).json({ error: 'Invalid expense ID.' });
  const data = parse(expenseShape, req.body);
  const expense = await Expense.findOne({ _id: req.params.expenseId, group: req.group.id });
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  if (String(expense.creator) !== String(req.user.id) && String(req.group.creator) !== String(req.user.id)) return res.status(403).json({ error: 'Only the expense creator or group creator can edit this expense.' });
  if (!req.group.members.some(id => String(id) === data.payer)) return res.status(400).json({ error: 'The payer must belong to this group.' });
  expense.set({ ...data, splitType: data.split.type, allocations: calculateAllocations(data.amountCents, data.split, req.group.members) }); await expense.save();
  res.json(await expense.populate('payer allocations.member', 'name email'));
}));
app.delete('/api/groups/:id/expenses/:expenseId', requireAuth, loadGroup, wrap(async (req, res) => {
  if (!objectId.safeParse(req.params.expenseId).success) return res.status(400).json({ error: 'Invalid expense ID.' });
  const expense = await Expense.findOne({ _id: req.params.expenseId, group: req.group.id });
  if (!expense) return res.status(404).json({ error: 'Expense not found.' });
  if (String(expense.creator) !== String(req.user.id) && String(req.group.creator) !== String(req.user.id)) return res.status(403).json({ error: 'Only the expense creator or group creator can delete this expense.' });
  await expense.deleteOne(); res.json({ ok: true });
}));
app.get('/api/payments/razorpay/config', requireAuth, (req, res) => res.json({ enabled: razorpayReady(), keyId: razorpayReady() ? process.env.RAZORPAY_KEY_ID : null, testMode: true }));
app.post('/api/groups/:id/payments/razorpay/order', requireAuth, loadGroup, wrap(async (req, res) => {
  if (!razorpayReady()) return res.status(503).json({ error: 'Add Razorpay test keys to server/.env to enable online payments.' });
  const { to, amountCents } = parse(z.object({ to: objectId, amountCents: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }), req.body);
  if (to === String(req.user.id) || !req.group.members.some(id => String(id) === to)) return res.status(400).json({ error: 'Choose another member of this group as the recipient.' });
  const [expenses, settlements, pending] = await Promise.all([
    Expense.find({ group: req.group.id }).populate('payer', 'name'),
    Settlement.find({ group: req.group.id }),
    PaymentAttempt.aggregate([{ $match: { group: req.group._id, from: req.user._id, to: new mongoose.Types.ObjectId(to), status: 'pending' } }, { $group: { _id: null, total: { $sum: '$amountCents' } } }])
  ]);
  const balances = calculateBalances(req.group, expenses, settlements);
  const sender = balances.find(row => row.userId === String(req.user.id))?.balanceCents || 0;
  const recipient = balances.find(row => row.userId === to)?.balanceCents || 0;
  if (sender >= 0 || recipient <= 0 || amountCents + (pending[0]?.total || 0) > Math.min(-sender, recipient)) return res.status(400).json({ error: 'The payment exceeds what you currently owe this member.' });
  const attempt = await PaymentAttempt.create({ group: req.group.id, from: req.user.id, to, amountCents, currency: 'INR', status: 'creating' });
  try {
    const order = await razorpayRequest('/orders', 'POST', { amount: amountCents, currency: 'INR', receipt: `sm-${attempt.id}`, notes: { splitmateGroupId: String(req.group.id), splitmatePaymentId: String(attempt.id) } });
    attempt.orderId = order.id; attempt.status = 'pending'; await attempt.save();
    res.status(201).json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, name: 'SplitMate', description: `Settle up in ${req.group.name}` });
  } catch (error) {
    await PaymentAttempt.findByIdAndDelete(attempt.id);
    throw error;
  }
}));
app.post('/api/groups/:id/payments/razorpay/verify', requireAuth, loadGroup, wrap(async (req, res) => {
  const data = parse(z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }), req.body);
  const attempt = await PaymentAttempt.findOne({ orderId: data.razorpay_order_id, group: req.group.id, from: req.user.id });
  if (!attempt) return res.status(404).json({ error: 'Payment order not found for this account.' });
  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${attempt.orderId}|${data.razorpay_payment_id}`).digest('hex');
  if (!safeSignatureEqual(expected, data.razorpay_signature)) return res.status(400).json({ error: 'Razorpay payment signature could not be verified.' });
  const payment = await razorpayRequest(`/payments/${encodeURIComponent(data.razorpay_payment_id)}`);
  const settlement = await confirmCapturedPayment(attempt, data.razorpay_payment_id, payment);
  res.json({ ok: true, settlement, message: 'Payment verified and group balance settled.' });
}));
app.post('/api/groups/:id/payments/razorpay/:orderId/failed', requireAuth, loadGroup, wrap(async (req, res) => {
  const attempt = await PaymentAttempt.findOne({ orderId: req.params.orderId, group: req.group.id, from: req.user.id, status: 'pending' });
  if (attempt) { attempt.status = 'failed'; attempt.failureReason = String(req.body.reason || 'Checkout was dismissed').slice(0, 240); await attempt.save(); }
  res.json({ ok: true });
}));
app.get('/api/dashboard', requireAuth, wrap(async (req, res) => {
  const groups = await Group.find({ members: req.user.id, archived: false }).populate('members', 'name email').sort({ updatedAt: -1 });
  const ids = groups.map(g => g.id);
  const [expenses, settlements] = await Promise.all([
    Expense.find({ group: { $in: ids } }).populate('payer', 'name email').populate('group', 'name currency').sort({ date: -1 }),
    Settlement.find({ group: { $in: ids } })
  ]);
  const spentCents = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  let netBalanceCents = 0;
  let owedToMeCents = 0;
  let iOweCents = 0;
  const spendingByCurrency = {};
  const owedByCurrency = {};
  const owingByCurrency = {};
  const groupSummaries = groups.map(group => {
    const groupExpenses = expenses.filter(e => String(e.group.id) === String(group.id));
    const groupSettlements = settlements.filter(s => String(s.group) === String(group.id));
    const myBalance = calculateBalances(group, groupExpenses, groupSettlements).find(x => x.userId === String(req.user.id))?.balanceCents || 0;
    const currency = group.currency || req.user.currency;
    netBalanceCents += myBalance;
    owedToMeCents += Math.max(myBalance, 0);
    iOweCents += Math.max(-myBalance, 0);
    spendingByCurrency[currency] = (spendingByCurrency[currency] || 0) + groupExpenses.reduce((sum, e) => sum + e.amountCents, 0);
    owedByCurrency[currency] = (owedByCurrency[currency] || 0) + Math.max(myBalance, 0);
    owingByCurrency[currency] = (owingByCurrency[currency] || 0) + Math.max(-myBalance, 0);
    return { group, currency, spentCents: groupExpenses.reduce((sum, e) => sum + e.amountCents, 0), balanceCents: myBalance };
  });
  res.json({ groups, groupSummaries, expenses: expenses.slice(0, 10), spentCents, spendingByCurrency, owedByCurrency, owingByCurrency, netBalanceCents, owedToMeCents, iOweCents, groupsCount: groups.length });
}));

const clientBuildDirectory = path.resolve(serverDirectory, '../client/dist');
app.use(express.static(clientBuildDirectory));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientBuildDirectory, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 11000) return res.status(409).json({ error: 'An account with this email already exists.' });
  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
  res.status(status).json({ error: status === 500 ? 'Something went wrong. Please try again.' : err.message });
});

const port = Number(process.env.PORT || 8000);
connectDB().then(async () => {
  // SplitMate is INR-only: retain the stored numeric amounts and standardize their currency label.
  await Promise.all([
    User.updateMany({ currency: { $ne: 'INR' } }, { $set: { currency: 'INR' } }),
    Group.updateMany({ currency: { $ne: 'INR' } }, { $set: { currency: 'INR' } }),
    Settlement.updateMany({ currency: { $ne: 'INR' } }, { $set: { currency: 'INR' } })
  ]);
  app.listen(port, () => console.log(`SplitMate API listening on http://localhost:${port}`));
}).catch(error => { console.error(error.message); process.exit(1); });
