import { z } from 'zod';

export const RuleCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255).trim(),
  triggerType: z.string().min(1, 'Trigger type is required').max(100),
  triggerConfig: z.record(z.unknown()).optional().nullable(),
  conditions: z.array(z.unknown()).optional(),
  actions: z.array(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

export const RunSlaCronBodySchema = z.object({
  organizationId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
}).optional();

export type RuleCreateInput = z.infer<typeof RuleCreateSchema>;
export type RunSlaCronBodyInput = z.infer<typeof RunSlaCronBodySchema>;
