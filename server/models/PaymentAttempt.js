import mongoose from 'mongoose';

const paymentAttemptSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amountCents: { type: Number, required: true, min: 1 },
  currency: { type: String, enum: ['INR'], default: 'INR' },
  orderId: { type: String, unique: true, sparse: true },
  paymentId: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['creating', 'pending', 'paid', 'failed'], default: 'creating', index: true },
  settlement: { type: mongoose.Schema.Types.ObjectId, ref: 'Settlement', default: null },
  failureReason: { type: String, maxlength: 240, default: '' },
  paidAt: { type: Date, default: null }
}, { timestamps: true });

paymentAttemptSchema.index({ group: 1, from: 1, to: 1, status: 1 });
export default mongoose.model('PaymentAttempt', paymentAttemptSchema);
