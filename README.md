# SplitMate

SplitMate is a MERN app for keeping shared expenses fair across friends, roommates, and trips. It includes account registration, invitations that members can accept or decline, equal/custom/percentage splits, per-group balances, expense filters, and Razorpay test-mode settlements in INR.

## Stack and layout

- `client/`: React, Vite, React Router, Tailwind CSS, Axios
- `server/`: Express REST API, Mongoose, MongoDB, Zod request validation
- Authentication uses bcrypt password hashes and a JWT in an HTTP-only cookie.

## Run locally

Requirements: Node.js 18.18+ (Node 20 LTS recommended), npm, and a MongoDB server. A local MongoDB install can use `mongodb://127.0.0.1:27017/splitmate`. MongoDB Atlas works too.

1. In a terminal opened at this project root, install dependencies:

   ```bash
   npm install
   npm install --prefix client
   npm install --prefix server
   ```

2. Create `server/.env` from the example:

   ```powershell
   Copy-Item server/.env.example server/.env
   ```

3. Set `MONGODB_URI` in `server/.env` to your local MongoDB URI or Atlas connection string. Set `JWT_SECRET` to a private random value of at least 32 characters. Do not commit `.env` or share your Atlas password. `CLIENT_ORIGIN` defaults to `http://localhost:5173`.
4. For online test checkout, create Razorpay **Test Mode** API keys in the Razorpay Dashboard and put `RAZORPAY_KEY_ID` (`rzp_test_...`) and `RAZORPAY_KEY_SECRET` in `server/.env`. Never put the secret in the React client or share it publicly. SplitMate groups use INR.

5. Seed the fictional demo accounts, two INR groups, and example expenses:

   ```bash
   npm run seed
   ```

6. Start the API and frontend together:

   ```bash
   npm run dev
   ```

Open `http://localhost:5173`. The API listens on `http://localhost:8000`.

Demo login: `alex@splitmate.demo` / `splitmate123`. Seed also creates `jamie@splitmate.demo` and `taylor@splitmate.demo` with the same password. The seed script only replaces these demo accounts and its sample data.

## Environment variables

| Variable | Required | Purpose |
|---|---:|---|
| `MONGODB_URI` | Yes | MongoDB connection string. Local default: `mongodb://127.0.0.1:27017/splitmate`. |
| `JWT_SECRET` | Yes | Private signing key with 32+ characters. |
| `PORT` | No | API port, default `8000`. |
| `CLIENT_ORIGIN` | No | Frontend origin allowed by CORS, default `http://localhost:5173`. |
| `NODE_ENV` | No | Set `production` to enable secure cookies over HTTPS. |
| `VITE_API_URL` | No | Optional frontend API URL override. By default, the client uses the browser's current hostname on port `8000`, keeping local and LAN development on the same host for session cookies. |
| `RAZORPAY_KEY_ID` | No | Razorpay Test Mode key ID (`rzp_test_...`). Required to show online checkout. |
| `RAZORPAY_KEY_SECRET` | No | Test Mode secret, used only by the API to create orders and verify payment signatures. |

## Balance calculation

Money is stored and sent by the API as integer cents. An expense credits its payer by the total and debits each participant by their allocation. A user's net is therefore **amount paid minus their allocated shares**. If Alex pays $60 and their own share is $20, Alex is credited $60 and debited $20, so the other participants collectively owe Alex $40. A positive net means the group owes that member; a negative net means that member owes the group. Settlements move the two members' balances toward zero and leave the original expense unchanged. The API prevents a settlement from exceeding the amount the sender owes that recipient.

Equal splits distribute leftover cents one at a time so the shares add to the total. Custom amounts must be whole cents and add up exactly. Percentage splits must total 100%; any rounding cents are distributed among the selected allocations so the stored shares still equal the expense amount. A member may be included with a zero-cent share.

Archived groups are omitted from active group lists and dashboard totals. Expenses remain in their history.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET/PATCH /api/profile`
- `GET/POST /api/groups`, `GET/PATCH /api/groups/:id`, `POST /api/groups/:id/members`
- `POST /api/groups/:id/expenses`, `PATCH/DELETE /api/groups/:id/expenses/:expenseId`
- `POST /api/groups/:id/payments/razorpay/order`, `POST /api/groups/:id/payments/razorpay/verify`
- `GET /api/dashboard`, `GET /api/health`

Private routes require the session cookie. Group details accept `category`, `payer`, `from`, and `to` query filters. Inviting someone creates a pending invitation; they sign in or register using that email and accept or decline it from **Invitations**. SplitMate does not send invitation emails.

## Razorpay test checkout

SplitMate uses INR for all groups and settlements. On startup, older group, profile, and settlement currency labels are standardized to INR; their stored numeric amounts are kept as-is and are not converted using an exchange rate. All balance settlements must go through Razorpay. There is no manual “mark as paid” flow.

The settle-up dialog offers **Continue to Razorpay** when test keys are configured. The server creates a Razorpay order, verifies the Checkout signature, fetches the payment from Razorpay, captures it if needed, and records an internal settlement only after the payment is confirmed as captured. The MongoDB connection needs transaction support (MongoDB Atlas or a local replica set) for payment-to-settlement reconciliation.

Razorpay Test Mode simulates payment outcomes; it does not transfer real money. In this app, a successful test payment updates SplitMate's group balances. Standard Checkout charges the Razorpay merchant account associated with the API keys; it does **not** automatically pay the other group member. Real payouts to members need a separate recipient onboarding and payout integration such as Razorpay Route, plus its account approval and compliance setup.

Settlement is recorded when the payer returns from Checkout and the server verifies the payment. If the browser is closed before verification, the user may need to contact the group creator to reconcile the payment.

## Troubleshooting

- **MongoDB connection refused:** start the local MongoDB service or check the Atlas URI, password, and network allowlist.
- **JWT_SECRET error:** set a private value of at least 32 characters in `server/.env`.
- **Browser cannot reach API:** confirm both dev servers are running and `CLIENT_ORIGIN` matches the browser URL.
- **Demo login fails:** run `npm run seed` after setting up the database.

Build the production frontend with `npm run build`. Serve `client/dist` from a static host and run the API with `npm start --prefix server`, setting production environment values and using HTTPS.
