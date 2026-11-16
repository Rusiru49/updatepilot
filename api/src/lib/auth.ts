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
export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

// A random CSRF token, one per login session
export const newCsrfToken = () => crypto.randomBytes(32).toString("base64url");

// Compare in constant time, so the token can't be guessed from response timing
export function csrfMatches(sent: string | undefined, expected: string) {
  if (!sent || !expected) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Creates a random session token (only its hash is saved) and a CSRF token for this session.
export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfToken = newCsrfToken();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      csrfToken,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return { token, csrfToken };
}

export async function findSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;

  // Sessions created before CSRF protection existed get a token now (no forced logout)
  if (!session.csrfToken) {
    const csrfToken = newCsrfToken();
    await prisma.session.update({ where: { id: session.id }, data: { csrfToken } });
    session.csrfToken = csrfToken;
  }
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