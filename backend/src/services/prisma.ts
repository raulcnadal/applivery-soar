import { PrismaClient } from "@prisma/client";

// Single shared Prisma Client instance for the whole process.
export const prisma = new PrismaClient();
