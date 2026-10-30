import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db";
import { sha256 } from "../lib/auth";

declare global {
  namespace Express {
    interface Request {
      agent?: { deviceId: string; deviceName: string; userId: string; credentialId: string };
    }
  }
}

// Agents send:  Authorization: Bearer upa_xxxxxxxx
export async function requireAgent(req: Request, res: Response, next: NextFunction) {
  const match = /^Bearer (upa_[A-Za-z0-9_-]{20,})$/.exec(req.get("authorization") ?? "");

  const credential = match
    ? await prisma.agentCredential.findUnique({
        where: { credentialHash: sha256(match[1]) },
        include: { device: true },
      })
    : null;

  const invalid =
    !credential ||
    credential.revokedAt !== null ||
    (credential.expiresAt !== null && credential.expiresAt < new Date()) ||
    credential.device.status === "REVOKED";

  if (invalid) {
    res.status(401).json({
      error: { code: "AGENT_UNAUTHENTICATED", message: "Agent key is invalid or revoked. Pair the agent again." },
    });
    return;
  }

  req.agent = {
    deviceId: credential.device.id,
    deviceName: credential.device.deviceName,
    userId: credential.device.userId,
    credentialId: credential.id,
  };
  next();
}