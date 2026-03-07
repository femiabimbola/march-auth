# Express Auth with JWT, 2FA on Neon PostgresSQL

An authentication system using **access tokens** (short-lived) and **refresh tokens** (long-lived, rotated on every use) with 2FA security.

## Stack

- **Express.js** — HTTP server
- **PG** —  PostgreSQL Database
- **bcryptjs** — password hashing
- **jsonwebtoken** — JWT generation & verification
- **cookie-parser** — httpOnly cookie support
- **ORM** - Drizzle RM

---

### Project Setup

```bash
npm install cors dotenv jsonwebtoken bcryptjs passport passport-jwt pg drizzle-orm
```
Then install the typescript defination

---
### Database Connection
The connection to the database must first be achieved.