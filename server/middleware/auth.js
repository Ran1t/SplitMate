import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.splitmate || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Please sign in to continue.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Account not found. Please sign in again.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Your session expired. Please sign in again.' });
  }
}
