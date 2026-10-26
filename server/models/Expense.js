import mongoose from 'mongoose';

const allocationSchema = new mongoose.Schema({
  member: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountCents: { type: Number, required: true, min: 0 }
}, { _id: false });

const expenseSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  description: { type: String, required: true, trim: true, maxlength: 120 },
  amountCents: { type: Number, required: true, min: 1 },
  category: { type: String, required: true, enum: ['Food & drink', 'Groceries', 'Transport', 'Accommodation', 'Entertainment', 'Utilities', 'Other'], default: 'Other' },
  splitType: { type: String, enum: ['equal', 'custom', 'percent'], default: 'equal' },
  payer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true, default: Date.now },
  allocations: { type: [allocationSchema], validate: { validator: a => a.length > 0, message: 'Add at least one split member.' } }
}, { timestamps: true });

expenseSchema.index({ group: 1, date: -1 });
export default mongoose.model('Expense', expenseSchema);
