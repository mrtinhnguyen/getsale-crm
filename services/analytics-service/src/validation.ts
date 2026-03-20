import { z } from 'zod';

export type AnPeriodKey = 'today' | 'week' | 'month' | 'year';

export const AnPeriodQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'year']).default('month'),
});

export const AnBdAnalyticsQuerySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'year']).default('month'),
  bd_account_id: z.string().uuid().optional(),
  folder_id: z.coerce.number().int().min(0).optional(),
});

/** Monday start date in UTC (YYYY-MM-DD). */
export const AnBdTeamWeekQuerySchema = z.object({
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((s) => {
      const d = new Date(`${s}T00:00:00.000Z`);
      return !Number.isNaN(d.getTime()) && d.getUTCDay() === 1;
    }, 'week_start must be a Monday (UTC)'),
});
