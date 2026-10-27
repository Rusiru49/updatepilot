import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import type { CookieOptions } from "express";
import { prisma } from "../db";

export const SESSION_COOKIE = "up_session";
const SESSION_DAYS = 7;

export const cookieOptions: CookieOptions = {
  httpOnly: true, // JavaScript in the browser cannot read it
  sameSite: "lax", // helps block cross-site requests
  secure: process.env.NODE_ENV === "production", // HTTPS only in production
  path: "/",
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// Creates a random token. Only its hash is saved in the database.
export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export async function findSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

export async function deleteSession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

// Never send passwordHash to the browser
export const toPublicUser = (u: { id: string; email: string; displayName: string; createdAt: Date }) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  createdAt: u.createdAt,
});