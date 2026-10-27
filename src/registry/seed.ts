import { usd } from '../domain/types.ts';
import type { PriceEntry } from './pricing.ts';

// Hand-curated seed. Every entry was checked against the official page in sourceUrl on
// 2026-10-27 and must be rechecked after revalidateAfter; after that date the UI shows
// it as an assumption again (working model 7.6). Prices are list prices in USD.
// verifiedAt covers prices and limits. Commercial-use terms were checked only for Vercel;
// the other commercialUse values are unchecked judgements.

const VERIFIED = '2026-10-27';
const REVALIDATE = '2027-01-27';
const ANTHROPIC_PRICING = 'https://platform.claude.com/docs/en/about-claude/pricing';

export const seedPrices: PriceEntry[] = [
  {
    id: 'anthropic/claude-opus-5-5',
    provider: 'anthropic', product: 'claude-opus-5-5', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    // Cache reads on Opus 5.5 are 0.05x base input, not the usual 0.1x.
    rates: {
      inputPerMTok: usd(4), outputPerMTok: usd(20),
      cacheWrite5mPerMTok: usd(5), cacheWrite1hPerMTok: usd(8), cacheReadPerMTok: usd(0.2),
    },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: ANTHROPIC_PRICING,
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'anthropic/claude-sonnet-5-5',
    provider: 'anthropic', product: 'claude-sonnet-5-5', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    // Cache reads on Sonnet 5.5 are 0.05x base input, not the usual 0.1x.
    rates: {
      inputPerMTok: usd(2), outputPerMTok: usd(10),
      cacheWrite5mPerMTok: usd(2.5), cacheWrite1hPerMTok: usd(4), cacheReadPerMTok: usd(0.1),
    },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: ANTHROPIC_PRICING,
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'anthropic/claude-haiku-5-5',
    provider: 'anthropic', product: 'claude-haiku-5-5', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    rates: {
      inputPerMTok: usd(0.1), outputPerMTok: usd(0.5),
      cacheWrite5mPerMTok: usd(0.125), cacheWrite1hPerMTok: usd(0.2), cacheReadPerMTok: usd(0.01),
    },
    longPrompt: {
      overTokens: 100_000,
      rates: {
        inputPerMTok: usd(0.5), outputPerMTok: usd(2.5),
        cacheWrite5mPerMTok: usd(0.625), cacheWrite1hPerMTok: usd(1), cacheReadPerMTok: usd(0.05),
      },
    },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: ANTHROPIC_PRICING,
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    // Not a build model here: it is where "default" refusal fallbacks send cyber-category
    // declines from Opus 5.5, so it bounds what a fallback attempt can cost.
    id: 'anthropic/claude-opus-4-8',
    provider: 'anthropic', product: 'claude-opus-4-8', plan: 'api', category: 'llm',
    currency: 'USD', unit: 'token',
    rates: {
      inputPerMTok: usd(5), outputPerMTok: usd(25),
      cacheWrite5mPerMTok: usd(6.25), cacheWrite1hPerMTok: usd(10), cacheReadPerMTok: usd(0.5),
    },
    billingPeriod: 'usage', commercialUse: 'allowed',
    sourceUrl: ANTHROPIC_PRICING,
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'vercel/hobby',
    provider: 'vercel', product: 'hosting', plan: 'hobby', category: 'host',
    currency: 'USD', unit: 'month', rates: { flat: 0 }, billingPeriod: 'month',
    freeLimits: [
      'Monthly guideline: 100 GB Fast Data Transfer, 1M function invocations, 4 h Active CPU',
    ],
    includedUsage: {
      function_invocations: 1_000_000, active_cpu: 4, provisioned_memory: 360, fast_data_transfer: 100,
    },
    upgradeCliff: 'Commercial use or exceeding fair-use limits requires Pro',
    commercialUse: 'prohibited',
    commercialNote: 'Non-commercial personal use only; a paid employee or consultant writing the code counts as commercial',
    sourceUrl: 'https://vercel.com/docs/limits/fair-use-guidelines',
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'vercel/pro',
    provider: 'vercel', product: 'hosting', plan: 'pro', category: 'host',
    // The pricing page lists Pro at $20/mo and a Pro developer seat at $20/month; one
    // developer seat is assumed. Includes $20 of usage credit.
    currency: 'USD', unit: 'seat-month', rates: { flat: usd(20) }, billingPeriod: 'month',
    // From the fair-use guidelines page. Fast Data Transfer on Pro is "Flat Rate CDN"
    // with no per-GB price published there, so it has no meter and is shown as unpriced.
    meters: [
      { id: 'function_invocations', unit: 'invocation', perUnits: 1_000_000, price: usd(0.6) },
      { id: 'active_cpu', unit: 'hour', perUnits: 1, price: usd(0.128), startingAt: true },
      { id: 'provisioned_memory', unit: 'GB-hour', perUnits: 1, price: usd(0.0106), startingAt: true },
    ],
    includedCredit: usd(20),
    upgradeCliff: 'Usage beyond the $20 included credit bills on demand; enable spend-management pause',
    commercialUse: 'allowed',
    sourceUrl: 'https://vercel.com/pricing',
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'supabase/free',
    provider: 'supabase', product: 'postgres', plan: 'free', category: 'database',
    currency: 'USD', unit: 'month', rates: { flat: 0 }, billingPeriod: 'month',
    freeLimits: ['Limit of 2 active projects', 'Projects pause after 1 week of inactivity'],
    upgradeCliff: 'Paused projects go offline until restored; production use needs Pro',
    // The pricing page says nothing about commercial use either way.
    commercialUse: 'unknown',
    sourceUrl: 'https://supabase.com/pricing',
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'supabase/pro',
    provider: 'supabase', product: 'postgres', plan: 'pro', category: 'database',
    currency: 'USD', unit: 'org-month', rates: { flat: usd(25) }, billingPeriod: 'month',
    upgradeCliff:
      'Includes $10/month compute credit (one Micro instance); spend cap is on by default and ' +
      'excludes compute and some add-ons',
    commercialUse: 'allowed',
    sourceUrl: 'https://supabase.com/pricing',
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
  {
    id: 'github/free',
    provider: 'github', product: 'repositories', plan: 'free', category: 'git',
    currency: 'USD', unit: 'month', rates: { flat: 0 }, billingPeriod: 'month',
    freeLimits: ['Unlimited public and private repositories'],
    commercialUse: 'allowed',
    sourceUrl: 'https://github.com/pricing',
    verifiedAt: VERIFIED, confidence: 'high', revalidateAfter: REVALIDATE,
  },
];
