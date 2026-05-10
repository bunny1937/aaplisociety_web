import { z } from "zod";

export const societyConfigSchema = z.object({
  name: z.string().min(2, "Society name must be at least 2 characters"),
  registrationNo: z.string().optional(),
  address: z.string().optional(),
  config: z.object({
    maintenanceRate: z.number().min(0),
    sinkingFundRate: z.number().min(0),
    repairFundRate: z.number().min(0),
    interestRate: z.number().min(0).max(100),
    serviceTaxRate: z.number().min(0).max(100),
    gracePeriodDays: z.number().min(0).max(90),
    billDueDay: z.number().min(1).max(31).default(10),
    billPayFinalDay: z.number().min(1).max(31).default(25),
    interestCalculationMethod: z.enum(["SIMPLE", "COMPOUND"]).default("SIMPLE"),
    interestBasis: z.enum(["MONTHLY", "DAILY"]).default("MONTHLY"),
    billGenerationDay: z.number().min(1).max(28).default(1),
    billPushDay: z.number().min(1).max(28).default(1),
    fixedCharges: z.object({
      water: z.number().min(0),
      security: z.number().min(0),
      electricity: z.number().min(0),
    }),
  }),
});

export const matrixConfigSchema = z.object({
  L: z.number().min(1).max(50),
  R: z.number().min(1).max(50),
  billingHeads: z.array(
    z.object({
      id: z.string(),
      label: z.string().min(1),
    }),
  ),
});

export const memberSchema = z.object({
  roomNo: z.string().min(1),
  wing: z.string().optional(),
  ownerName: z.string().min(2),
  areaSqFt: z.number().min(1),
  contact: z.string().optional(),
  openingBalance: z.number().optional(), // legacy — kept for backward compat
  openingPrincipal: z.number().min(0).optional().default(0),
  openingInterest: z.number().min(0).optional().default(0),
});
export const bulkMemberSchema = z.array(memberSchema);
