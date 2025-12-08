import { z } from 'zod';

export const inputSchema = z.object({
  team_id: z.string(),
  message: z.string().max(1000),
  phone: z
    .string()
    .regex(/^\d{10,15}$/, 'Phone must contain only digits (country code + number)')
    .optional(),
  email: z.string().email().optional(),
  user_confirmation: z.boolean().optional(),
  message_type: z.enum(['text', 'image', 'audio', 'video', 'document', 'sticker', 'unknown']).optional(),
});

export type InputSchema = z.infer<typeof inputSchema>;
