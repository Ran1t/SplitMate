import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, select: false },
  currency: { type: String, default: 'INR', enum: ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD'] }
}, { timestamps: true });

export default mongoose.model('User', userSchema);
