import express, { Request, Response } from 'express';
import passport from "passport";
import { db } from './database';
import * as dotenv from "dotenv";
dotenv.config();

import "./config/passport"; // initialize passport strategies
import authRouter from "./routes/authRoutes";
import { requireAuth, requireAuthAnd2FA } from './middleware/authenticate';

const app = express();
const port = process.env.PORT || 8000;

// ── Middleware ──────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize()); 

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, TypeScript + Express!');
});

// ── Routes ──────────────────────────────────────
app.use("/auth", authRouter);

// Example protected route
app.get("/profile", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Example sensitive route — requires 2FA verified token
app.get("/admin", requireAuthAnd2FA, (req, res) => {
  res.json({ message: "Welcome to admin" });
});

app.listen(port, async () => {
  console.log(`[server]: Server is running at http://localhost:${port} in ${process.env.NODE_ENV}`);
  await db
    .execute("select 1")
    .then(() => console.log("Database successfully connected"))
    .catch(() => console.log("database could not successfully connect"));
});