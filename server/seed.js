import 'dotenv/config';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from './config/db.js';
import User from './models/User.js';
import Group from './models/Group.js';
import Expense from './models/Expense.js';
import Settlement from './models/Settlement.js';

await connectDB();
const demoEmails = ['alex@splitmate.demo', 'jamie@splitmate.demo', 'taylor@splitmate.demo'];
const oldUsers = await User.find({ email: { $in: demoEmails } }).select('_id');
const oldGroups = await Group.find({ creator: { $in: oldUsers.map(user => user._id) }, name: { $in: ['Copenhagen weekend', 'Apartment 4B'] } }).select('_id');
const oldGroupIds = oldGroups.map(group => group._id);
await Promise.all([
  Expense.deleteMany({ group: { $in: oldGroupIds } }),
  Settlement.deleteMany({ group: { $in: oldGroupIds } }),
  Group.deleteMany({ _id: { $in: oldGroupIds } }),
  User.deleteMany({ _id: { $in: oldUsers.map(user => user._id) } })
]);

const password = await bcrypt.hash('splitmate123', 12);
const [alex, jamie, taylor] = await Promise.all([
  User.create({ name: 'Alex Morgan', email: 'alex@splitmate.demo', password, currency: 'INR' }),
  User.create({ name: 'Jamie Chen', email: 'jamie@splitmate.demo', password, currency: 'INR' }),
  User.create({ name: 'Taylor Reed', email: 'taylor@splitmate.demo', password, currency: 'INR' })
]);
const trip = await Group.create({ name: 'Copenhagen weekend', description: 'A little city escape, shared.', currency: 'INR', creator: alex.id, members: [alex.id, jamie.id, taylor.id] });
const home = await Group.create({ name: 'Apartment 4B', description: 'Home, shared.', currency: 'INR', creator: alex.id, members: [alex.id, jamie.id] });
const now = new Date();
await Expense.create([
  { group: trip.id, description: 'Dinner in Copenhagen', amountCents: 12840, category: 'Food & drink', payer: jamie.id, creator: jamie.id, date: now, splitType: 'equal', allocations: [{ member: alex.id, amountCents: 4280 }, { member: jamie.id, amountCents: 4280 }, { member: taylor.id, amountCents: 4280 }] },
  { group: trip.id, description: 'Metro cards', amountCents: 4260, category: 'Transport', payer: alex.id, creator: alex.id, date: new Date(now.getTime() - 86400000), splitType: 'equal', allocations: [{ member: alex.id, amountCents: 1420 }, { member: jamie.id, amountCents: 1420 }, { member: taylor.id, amountCents: 1420 }] },
  { group: home.id, description: 'Weekly groceries', amountCents: 9675, category: 'Groceries', payer: jamie.id, creator: jamie.id, date: new Date(now.getTime() - 172800000), splitType: 'equal', allocations: [{ member: alex.id, amountCents: 4838 }, { member: jamie.id, amountCents: 4837 }] }
]);
console.log('Demo data ready. Sign in with alex@splitmate.demo / splitmate123');
await mongoose.disconnect();
