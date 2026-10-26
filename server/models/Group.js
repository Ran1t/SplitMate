import mongoose from 'mongoose';

const invitationSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
  invitedAt: { type: Date, default: Date.now },
  respondedAt: { type: Date, default: null }
}, { timestamps: false });

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 240, default: '' },
  currency: { type: String, enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'], default: 'INR' },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  invitations: { type: [invitationSchema], default: [] },
  balanceRevision: { type: Number, default: 0 },
  archived: { type: Boolean, default: false }
}, { timestamps: true });

groupSchema.index({ members: 1, archived: 1 });
export default mongoose.model('Group', groupSchema);
