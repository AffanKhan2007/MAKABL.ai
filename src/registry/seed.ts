import { usd } from '../domain/types.ts';
import { modelPrices } from './models.ts';
import type { PriceEntry } from './pricing.ts';

// Hand-curated seed for hosting, database and git. Every entry was checked against the
// official page in sourceUrl on 2026-10-27 and must be rechecked after revalidateAfter; after that date the UI shows
// it as an assumption again (working model 7.6). Prices are list prices in USD.
// verifiedAt covers prices and limits. Commercial-use terms were checked only for Vercel;
// the other commercialUse values are unchecked judgements.

const VERIFIED = '2026-10-27';
const REVALIDATE = '2027-01-27';

export const seedPrices: PriceEntry[] = [
  // Every model a phase can run on (checked 2026-10-31); see models.ts.
  ...modelPrices,
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
