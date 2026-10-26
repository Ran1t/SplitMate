# SplitMate

> **🎬 Project demo video:** [Watch SplitMate on Google Drive](https://drive.google.com/file/d/1QtNs2jjDT8WW0dIlHeEcv87K_d_aBWBt/view?usp=drive_link)

**🌐 Live app:** [https://splitmate-1e2q.onrender.com](https://splitmate-1e2q.onrender.com)

SplitMate is a MERN application for tracking shared expenses with friends, roommates, and travel groups. Create a group, invite people, record expenses, choose how to split each cost, and see who owes whom. Members can accept or decline invitations, and balances can be settled through Razorpay Test Mode.

## Features

- Register and sign in with a secure session cookie.
- Create groups and invite members by email. Invitees accept or decline in the app.
- Add expenses paid by a group member and split them equally, by custom amounts, or by percentage.
- View balances, suggested settle-ups, and group activity.
- Filter group expenses by category, payer, and date.
- Settle balances using Razorpay checkout in INR. Test payments are simulated and do not transfer real money.
- Responsive React interface styled with Tailwind CSS.

## Tech stack

- **MongoDB** and **Mongoose** for data storage
- **Express** and **Node.js** for the REST API
- **React** and **Vite** for the client
- **Tailwind CSS** for styling
- **Razorpay Test Mode** for simulated payment checkout

## Run locally

### Requirements

- Node.js 18.18 or later (Node 20 LTS recommended)
- npm
- MongoDB locally or a MongoDB Atlas database

### Setup

1. Install dependencies from the project root:

   ```bash
   npm install
   npm install --prefix client
   npm install --prefix server
   ```

2. Create the server environment file:

   ```powershell
   Copy-Item server/.env.example server/.env
   ```

3. Edit `server/.env` and set:

   - `MONGODB_URI` to your MongoDB connection string.
   - `JWT_SECRET` to a private random string of at least 32 characters.
   - `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to your Razorpay **Test Mode** credentials if you want to try checkout.

   The example file sets `CLIENT_ORIGIN=http://localhost:5173` and `PORT=8000`, which are suitable for the default local setup. Keep the Razorpay secret in the server environment only, and never commit `server/.env`.

4. (Optional) Load sample groups, expenses, and demo accounts into the configured database:

   ```bash
   npm run seed
   ```

   Demo login: `alex@splitmate.demo` / `splitmate123`. The seed script also creates `jamie@splitmate.demo` and `taylor@splitmate.demo` with the same password. **Seeding replaces the SplitMate demo accounts and their sample data in that database.**

5. Start the API and frontend together:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:5173](http://localhost:5173). The API runs on [http://localhost:8000](http://localhost:8000).

## Razorpay demo payments

Use Razorpay **Test Mode** API keys in `server/.env`. In checkout, use Razorpay's test payment details, and leave **Save this card** unchecked if prompted to save a card. A successful test checkout updates the SplitMate group balance, but no real money moves. Razorpay checkout sends payment to the merchant account associated with the keys; it does not automatically pay the other group member.

The server verifies payment signatures and confirms the Razorpay payment before recording a settlement. The database must support transactions; MongoDB Atlas does, while a local MongoDB setup needs to run as a replica set.

## Project structure

```text
client/   React + Vite frontend
server/   Express API, Mongoose models, and seed script
```

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the API and frontend for local development |
| `npm run seed` | Create/replace the sample demo data |
| `npm run build` | Build the frontend for production |
| `npm start` | Start the server (serves the built frontend in production) |

## Deployment

The live app is deployed on Render as one web service: the Express server serves the built React client and handles `/api` requests. The production service needs `MONGODB_URI`, `JWT_SECRET`, `NODE_ENV=production`, `CLIENT_ORIGIN` set to the live app origin, and (for test checkout) the two Razorpay Test Mode variables. Do not put private credentials in the client or commit them to GitHub.

## Notes

- Invitations are in-app; SplitMate does not send invitation emails automatically.
- The app uses INR for groups and settlements.
- A successful Razorpay Test Mode payment is a simulation, not a real transfer or payout to a group member.
