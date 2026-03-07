import dotenv from "dotenv"

dotenv.config()

export const config = {
  NODE_ENV:  process.env.NODE_ENV as string,
  APP_ORIGIN: process.env.APP_ORIGIN!,
  PORT: process.env.PORT!,
  BASE_PATH: process.env.BASE_PATH!,
  DATABASE_URL:process.env.DATABASE_URL,

  JWT: {
    SECRET: process.env.JWT_SECRET as string,
    EXPIRES_IN: process.env.JWT_SECRET_IN as string,
    REFRESH_SECRET: process.env.JWT_REFRESH_SECRET as string,
    REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN as string,
  },
  
  MAILER_SENDER: process.env.MAILER_SENDER,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
}


export const corsOptions = {
  origin :  process.env.FRONTEND_URL,
  credentials: true, //Majorly because of cookies
}