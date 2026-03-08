# Drizzle ORM with PostgreSQL in an Express Application

A complete step-by-step guide to setting up Drizzle ORM with a PostgreSQL database in an Express.js application.

---

## Prerequisites

- Node.js 18+ installed
- PostgreSQL installed and running (locally or via a cloud provider like Supabase, Neon, or Railway)
- Basic knowledge of Express.js

---

## Step 1: Initialize the Project

```bash
mkdir drizzle-express-app
cd drizzle-express-app
npm init -y
```

---

## Step 2: Install Dependencies

```bash
# Core dependencies
npm install express drizzle-orm pg dotenv

# Dev dependencies
npm install -D drizzle-kit @types/pg tsx typescript @types/express
```

**What each package does:**
- `drizzle-orm` — the ORM itself
- `pg` — PostgreSQL client for Node.js
- `drizzle-kit` — CLI tool for migrations and schema introspection
- `tsx` — run TypeScript files directly (for scripts)

---

## Step 3: Configure TypeScript

```bash
npx tsc --init
```

Then update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

---

## Step 4: Set Up Environment Variables

Create a `.env` file in the project root:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/mydb
PORT=3000
```

> Replace `username`, `password`, and `mydb` with your actual PostgreSQL credentials.

Also create a `.env.example` for documentation purposes:

```env
DATABASE_URL=postgresql://username:password@localhost:5432/mydb
PORT=3000
```

---

## Step 5: Create the Project Structure

```
drizzle-express-app/
├── src/
│   ├── db/
│   │   ├── index.ts        # DB connection
│   │   └── schema.ts       # Table definitions
│   ├── routes/
│   │   └── users.ts        # Example route
│   └── index.ts            # Express app entry point
├── drizzle/                # Auto-generated migrations (created later)
├── drizzle.config.ts       # Drizzle Kit config
├── .env
└── package.json
```

---

## Step 6: Configure Drizzle Kit

Create `drizzle.config.ts` in the root:

```typescript
import type { Config } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;
```

---

## Step 7: Define Your Database Schema

Create `src/db/schema.ts`:

```typescript
import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Posts table (with foreign key to users)
export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content"),
  published: boolean("published").default(false).notNull(),
  authorId: integer("author_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Define relations (for joins)
export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, {
    fields: [posts.authorId],
    references: [users.id],
  }),
}));
```

---

## Step 8: Create the Database Connection

Create `src/db/index.ts`:

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import * as dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
```

---

## Step 9: Generate and Run Migrations

Generate the SQL migration files from your schema:

```bash
npx drizzle-kit generate
```

This creates SQL files in the `drizzle/` folder. To apply them to your database:

```bash
npx drizzle-kit migrate
```

> You can also use `npx drizzle-kit push` during development to directly push schema changes without creating migration files.

Add these scripts to `package.json` for convenience:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

---

## Step 10: Create Route Handlers

Create `src/routes/users.ts` with full CRUD operations:

```typescript
import { Router, Request, Response } from "express";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// GET /users — fetch all users
router.get("/", async (req: Request, res: Response) => {
  try {
    const allUsers = await db.select().from(users);
    res.json(allUsers);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// GET /users/:id — fetch single user
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, parseInt(id)))
      .limit(1);

    if (user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// POST /users — create a new user
router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, email } = req.body;

    const newUser = await db
      .insert(users)
      .values({ name, email })
      .returning(); // returns the inserted row

    res.status(201).json(newUser[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to create user" });
  }
});

// PUT /users/:id — update a user
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email } = req.body;

    const updatedUser = await db
      .update(users)
      .set({ name, email })
      .where(eq(users.id, parseInt(id)))
      .returning();

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(updatedUser[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to update user" });
  }
});

// DELETE /users/:id — delete a user
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deletedUser = await db
      .delete(users)
      .where(eq(users.id, parseInt(id)))
      .returning();

    if (deletedUser.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ message: "User deleted", user: deletedUser[0] });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

export default router;
```

---

## Step 11: Create the Express App Entry Point

Create `src/index.ts`:

```typescript
import express from "express";
import * as dotenv from "dotenv";
import usersRouter from "./routes/users";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/users", usersRouter);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

---

## Step 12: Run the Application

```bash
npm run dev
```

Test the endpoints using `curl` or a tool like Postman:

```bash
# Create a user
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'

# Get all users
curl http://localhost:3000/users

# Get a specific user
curl http://localhost:3000/users/1

# Update a user
curl -X PUT http://localhost:3000/users/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice Smith", "email": "alice@example.com"}'

# Delete a user
curl -X DELETE http://localhost:3000/users/1
```

---

## Bonus: Useful Drizzle Query Patterns

### Filtering with `where`

```typescript
import { eq, like, gt, and, or } from "drizzle-orm";

// Exact match
await db.select().from(users).where(eq(users.email, "alice@example.com"));

// Pattern match (LIKE)
await db.select().from(users).where(like(users.name, "%Alice%"));

// Multiple conditions (AND)
await db.select().from(users).where(
  and(eq(users.name, "Alice"), gt(users.id, 5))
);

// Multiple conditions (OR)
await db.select().from(users).where(
  or(eq(users.name, "Alice"), eq(users.name, "Bob"))
);
```

### Pagination

```typescript
const page = 1;
const pageSize = 10;

const result = await db
  .select()
  .from(users)
  .limit(pageSize)
  .offset((page - 1) * pageSize);
```

### Joins

```typescript
const usersWithPosts = await db
  .select()
  .from(users)
  .leftJoin(posts, eq(users.id, posts.authorId));
```

### Transactions

```typescript
await db.transaction(async (tx) => {
  const newUser = await tx
    .insert(users)
    .values({ name: "Bob", email: "bob@example.com" })
    .returning();

  await tx.insert(posts).values({
    title: "First Post",
    content: "Hello World",
    authorId: newUser[0].id,
  });
});
```

### Drizzle Studio (Visual DB Browser)

```bash
npm run db:studio
```

Opens a browser-based UI at `https://local.drizzle.studio` to inspect and edit your database visually.

---

## Summary

| Step | What You Did |
|------|-------------|
| 1–2 | Created project and installed dependencies |
| 3–4 | Configured TypeScript and environment variables |
| 5–6 | Set up folder structure and Drizzle Kit config |
| 7 | Defined tables and relations in `schema.ts` |
| 8 | Created the database connection pool |
| 9 | Generated and applied migrations |
| 10–11 | Built Express routes with full CRUD |
| 12 | Ran and tested the application |