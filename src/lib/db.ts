/**
 * The Prisma client singleton — the app's real persistence layer.
 *
 * Replaces the committed-JSON snapshot store (the hackathon shortcut). A single
 * PrismaClient is reused across hot reloads in dev (Next re-evaluates modules on
 * every request in dev, which would otherwise leak connections). SQLite file at
 * prisma/dev.db; see prisma/schema.prisma (ADR-001 Decision 2 — swappable
 * datasource, now swapped from JSON to a real DB).
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
