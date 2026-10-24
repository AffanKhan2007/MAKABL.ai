import { usd } from '../domain/types.ts';
import type { PriceEntry } from './pricing.ts';

// Hand-curated seed. Every entry has verifiedAt: null until someone checks the official
// page and records the date, so the UI shows these as assumptions ([VERIFY] in the plan).
// LLM rates are Anthropic first-party list prices as cached 2026-10-06.

export const seedPrices: PriceEntry[] = [
  {
    id: 'anthropic/claude-opus-5-5',
    provider: 'anthropic', product: 'claude-opus-5-5', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    rates: { inputPerMTok: usd(4), outputPerMTok: usd(20) },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: 'https://www.anthropic.com/pricing',
    verifiedAt: null, confidence: 'medium', revalidateAfter: null,
  },
  {
    id: 'anthropic/claude-sonnet-5-5',
    provider: 'anthropic', product: 'claude-sonnet-5-5', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    rates: { inputPerMTok: usd(2), outputPerMTok: usd(10) },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: 'https://www.anthropic.com/pricing',
    verifiedAt: null, confidence: 'medium', revalidateAfter: null,
  },
  {
    id: 'anthropic/claude-haiku-5-5',
    provider: 'anthropic', product: 'claude-haiku-5-5', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    // Rate for prompts up to 100K tokens; longer prompts bill at $0.50 / $2.50.
    rates: { inputPerMTok: usd(0.1), outputPerMTok: usd(0.5) },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: 'https://www.anthropic.com/pricing',
    verifiedAt: null, confidence: 'medium', revalidateAfter: null,
  },
  {
    id: 'vercel/hobby',
    provider: 'vercel', product: 'hosting', plan: 'hobby', category: 'host',
    currency: 'USD', unit: 'month', rates: { flat: 0 }, billingPeriod: 'month',
    freeLimits: ['Fair-use limits on bandwidth and function execution'],
    upgradeCliff: 'Commercial use or exceeding fair-use limits requires Pro',
    commercialUse: 'prohibited',
    commercialNote: 'Non-commercial personal use only; a paid consultant writing the code counts as commercial',
    sourceUrl: 'https://vercel.com/docs/limits/fair-use-guidelines',
    verifiedAt: null, confidence: 'medium', revalidateAfter: null,
  },
  {
    id: 'vercel/pro',
    provider: 'vercel', product: 'hosting', plan: 'pro', category: 'host',
    currency: 'USD', unit: 'seat-month', rates: { flat: usd(20) }, billingPeriod: 'month',
    upgradeCliff: 'Usage beyond included allotments bills as overage; enable spend-management pause',
    commercialUse: 'allowed',
    sourceUrl: 'https://vercel.com/pricing',
    verifiedAt: null, confidence: 'low', revalidateAfter: null,
  },
  {
    id: 'supabase/free',
    provider: 'supabase', product: 'postgres', plan: 'free', category: 'database',
    currency: 'USD', unit: 'month', rates: { flat: 0 }, billingPeriod: 'month',
    freeLimits: ['Max 2 free projects per owner', 'Project pauses after 7 days of low activity'],
    upgradeCliff: 'Paused projects go offline until restored; production use needs Pro',
    commercialUse: 'unknown',
    sourceUrl: 'https://supabase.com/docs/guides/platform/billing-on-supabase',
    verifiedAt: null, confidence: 'medium', revalidateAfter: null,
  },
  {
    id: 'supabase/pro',
    provider: 'supabase', product: 'postgres', plan: 'pro', category: 'database',
    currency: 'USD', unit: 'org-month', rates: { flat: usd(25) }, billingPeriod: 'month',
    upgradeCliff: 'Spend cap covers egress, storage and MAU but excludes compute and some add-ons',
    commercialUse: 'allowed',
    sourceUrl: 'https://supabase.com/pricing',
    verifiedAt: null, confidence: 'low', revalidateAfter: null,
  },
  {
    id: 'github/free',
    provider: 'github', product: 'repositories', plan: 'free', category: 'git',
    currency: 'USD', unit: 'month', rates: { flat: 0 }, billingPeriod: 'month',
    commercialUse: 'allowed',
    sourceUrl: 'https://github.com/pricing',
    verifiedAt: null, confidence: 'medium', revalidateAfter: null,
  },
];
