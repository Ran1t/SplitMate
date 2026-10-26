import mongoose from 'mongoose';

const settlementSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountCents: { type: Number, required: true, min: 1 },
  currency: { type: String, enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'], default: 'INR' },
  date: { type: Date, default: Date.now },
  note: { type: String, trim: true, maxlength: 160, default: '' },
  paymentProvider: { type: String, enum: ['manual', 'razorpay'], default: 'manual' },
  paymentId: { type: String, unique: true, sparse: true },
  orderId: { type: String, sparse: true }
}, { timestamps: true });

settlementSchema.index({ group: 1, date: -1 });
export default mongoose.model('Settlement', settlementSchema);
