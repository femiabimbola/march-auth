# Express JWT Auth with Neon PostgreSQL

Full authentication system using **access tokens** (short-lived) and **refresh tokens** (long-lived, rotated on every use).

## Stack

- **Express.js** — HTTP server
- **Neon** — serverless PostgreSQL
- **bcryptjs** — password hashing
- **jsonwebtoken** — JWT generation & verification
- **cookie-parser** — httpOnly cookie support

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your `.env`:

```env
DATABASE_URL=postgresql://user:pass@ep-xxxx.us-east-1.aws.neon.tech/neondb?sslmode=require
ACCESS_TOKEN_SECRET=<run: openssl rand -hex 64>
REFRESH_TOKEN_SECRET=<run: openssl rand -hex 64>
ACCESS_TOKEN_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
PORT=3000
```

> Get your `DATABASE_URL` from [Neon dashboard](https://console.neon.tech) → Project → Connection Details.

### 3. Start the server

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Tables are created automatically on startup.

---

## Token Strategy

```
┌────────┐  POST /login  ┌─────────────────────────────────────────┐
│ Client │──────────────▶│ Server                                  │
│        │               │  1. Verify credentials                  │
│        │               │  2. Issue access token  (15m, in body)  │
│        │◀──────────────│  3. Issue refresh token (7d, httpOnly)  │
└────────┘               └─────────────────────────────────────────┘

      Access token expires → POST /refresh
┌────────┐               ┌─────────────────────────────────────────┐
│ Client │──────────────▶│  1. Verify refresh token JWT            │
│(cookie)│               │  2. Check token exists in DB            │
│        │               │  3. DELETE old token (rotation)         │
│        │◀──────────────│  4. Issue new access + refresh tokens   │
└────────┘               └─────────────────────────────────────────┘
```

- **Access token** — sent in `Authorization: Bearer <token>` header
- **Refresh token** — stored in `httpOnly` cookie (invisible to JS) and persisted in the database
- **Rotation** — every `/refresh` call invalidates the old refresh token and issues a new one (prevents replay attacks)

---

## API Reference

### POST `/api/auth/register`

```json
// Request body
{ "name": "Alice", "email": "alice@example.com", "password": "secret123" }

// Response 201
{ "success": true, "accessToken": "eyJ...", "user": { "id": "...", "email": "...", "name": "..." } }
```

### POST `/api/auth/login`

```json
// Request body
{ "email": "alice@example.com", "password": "secret123" }

// Response 200 (+ sets refreshToken cookie)
{ "success": true, "accessToken": "eyJ...", "user": { ... } }
```

### POST `/api/auth/refresh`

Reads `refreshToken` from the httpOnly cookie automatically.

```json
// Response 200 (+ rotates refreshToken cookie)
{ "success": true, "accessToken": "eyJ...", "user": { ... } }
```

### POST `/api/auth/logout`

Revokes the current refresh token.

```json
// Response 200
{ "success": true, "message": "Logged out successfully" }
```

### GET `/api/auth/me` 🔒

Requires `Authorization: Bearer <accessToken>` header.

```json
// Response 200
{ "success": true, "user": { "id": "...", "name": "...", "email": "...", "created_at": "..." } }
```

### POST `/api/auth/logout-all` 🔒

Revokes ALL refresh tokens for the user (signs out every device).

```json
// Response 200
{ "success": true, "message": "Logged out from all devices" }
```

---

## Project Structure

```
src/
├── index.js                    # App entry point
├── db/
│   └── index.js                # Neon connection + table init
├── utils/
│   └── jwt.js                  # Token generation & verification
├── middleware/
│   └── authenticate.js         # Access token guard
├── controllers/
│   └── auth.controller.js      # Register, login, refresh, logout
└── routes/
    └── auth.routes.js          # Route definitions
```

---

## Frontend Usage (Axios example)

```javascript
// Login
const { data } = await axios.post('/api/auth/login',
  { email, password },
  { withCredentials: true }  // ← needed to receive the cookie
);
localStorage.setItem('accessToken', data.accessToken);

// Authenticated request
axios.get('/api/auth/me', {
  headers: { Authorization: `Bearer ${accessToken}` }
});

// Refresh when access token expires
const { data } = await axios.post('/api/auth/refresh',
  {},
  { withCredentials: true }  // ← sends the cookie automatically
);
```