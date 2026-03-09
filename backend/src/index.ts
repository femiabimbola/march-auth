import express, { Request, Response } from 'express';
import { db } from './database';

const app = express();
const port = process.env.PORT || 8000;

app.get('/', (req: Request, res: Response) => {
  res.send('Hello, TypeScript + Express!');
});


app.listen(port, async () => {
  console.log(`[server]: Server is running at http://localhost:${port} in ${process.env.NODE_ENV}`);
  await db
    .execute("select 1")
    .then(() => console.log("Database successfully connected"))
    .catch(() => console.log("database could not successfully connect"));
});