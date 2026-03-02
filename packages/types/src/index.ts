import { z } from 'zod';

// --- ERS (Emergency Response System) Types ---

export const IncidentStatusSchema = z.enum(['PENDING', 'ASSIGNED', 'RESOLVED', 'FALSE_ALARM', 'ESCALATED', 'ARCHIVED']);
export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const IncidentTypeSchema = z.enum(['MEDICAL', 'SECURITY', 'FIRE', 'ACCIDENT', 'ABUSE', 'JUSTICE', 'HEALTH', 'LOGISTICS', 'OTHER']);
export type IncidentType = z.infer<typeof IncidentTypeSchema>;

export const IncidentSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  type: IncidentTypeSchema,
  status: IncidentStatusSchema,
  description: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  user_id: z.string().uuid(),
  assigned_guide_id: z.string().uuid().nullable(),
  assigned_guide_ids: z.array(z.string().uuid()).optional(),
  sla_deadline: z.string().datetime().optional().nullable(),
  escalated_at: z.string().datetime().optional().nullable(),
  accepted_by: z.string().uuid().optional().nullable(),
});

export type Incident = z.infer<typeof IncidentSchema>;

// --- PALO (Personal Life OS) Types ---

export const DocumentTypeSchema = z.enum(['ID_CARD', 'PASSPORT', 'MEDICAL_RECORD', 'CERTIFICATE', 'OTHER']);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const VerificationStatusSchema = z.enum(['PENDING', 'VERIFIED', 'REJECTED']);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;

export const VaultDocumentSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  user_id: z.string().uuid(),
  title: z.string(),
  document_type: DocumentTypeSchema,
  verification_status: VerificationStatusSchema,
  file_url: z.string(),
  metadata: z.record(z.any()).optional(),
  linked_incident_id: z.string().uuid().optional().nullable(),
});

export type VaultDocument = z.infer<typeof VaultDocumentSchema>;

// --- Skill Taxonomy (Phase 5) ---

export const SkillCategorySchema = z.enum(['Medical', 'Legal', 'Technical', 'Logistics', 'Safety']);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillTagSchema = z.enum([
  'Nurse', 'Doctor', 'Paramedic', 'CPR_Certified',       // Medical
  'Lawyer', 'Paralegal', 'Human_Rights_Officer',          // Legal
  'Welder', 'Mechanic', 'Electrician',                    // Technical
  'Driver', 'Vulcanizer', 'Dispatcher',                   // Logistics
  'Firefighter',                                          // Safety
]);
export type SkillTag = z.infer<typeof SkillTagSchema>;

export const SkillTierSchema = z.enum(['NOVICE', 'COMPETENT', 'EXPERT']);
export type SkillTier = z.infer<typeof SkillTierSchema>;

export const RoleSchema = z.enum(['USER', 'GUIDE', 'ADMIN']);
export type Role = z.infer<typeof RoleSchema>;

// --- Identity & Profile ---

export const ProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  role: RoleSchema.default('USER'),
  trust_score: z.number().min(0).max(100).default(50),
  token_balance: z.number().default(0),
  skills_set: z.array(SkillTagSchema).default([]),
  skill_tier: SkillTierSchema.default('NOVICE'),
  did: z.string().optional(),
  created_at: z.string().datetime(),
});

export type Profile = z.infer<typeof ProfileSchema>;

// --- P2P Verification / Endorsement (Phase 5) ---

export const EndorsementSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  endorser_id: z.string().uuid(),
  recipient_id: z.string().uuid(),
  skill_tag: SkillTagSchema,
  statement: z.string().optional().nullable(),
});

export type Endorsement = z.infer<typeof EndorsementSchema>;

// --- Token Economy Types ---

export const TransactionTypeSchema = z.enum(['REWARD', 'STAKE', 'TRANSFER', 'PENALTY']);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  user_id: z.string().uuid(),
  amount: z.number(),
  type: TransactionTypeSchema,
  description: z.string(),
  reference_id: z.string().optional(),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// --- Marketplace (Phase 6) ---

export const OrderStatusSchema = z.enum(['PENDING', 'ESCROW_HELD', 'COMPLETED', 'REFUNDED', 'CANCELLED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const MarketplaceItemSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  category: z.enum(['Mobile_Data', 'Cooking_Gas', 'Food_Voucher']),
  name: z.string(),
  description: z.string().optional().nullable(),
  token_price: z.number().int().positive(),
  provider_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().default(true),
  stock: z.number().int().default(-1),  // -1 = unlimited
});
export type MarketplaceItem = z.infer<typeof MarketplaceItemSchema>;

export const MarketplaceOrderSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  confirmed_at: z.string().datetime().optional().nullable(),
  buyer_id: z.string().uuid(),
  item_id: z.string().uuid(),
  token_amount: z.number().int().positive(),
  status: OrderStatusSchema,
  ussd_confirm_code: z.string().length(6),
  provider_notified: z.boolean().default(false),
  metadata: z.record(z.any()).optional(),
});
export type MarketplaceOrder = z.infer<typeof MarketplaceOrderSchema>;
