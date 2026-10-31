'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { parseIntake } from '../../../src/server/intake.ts';
import { DEFAULT_RELAY, PRESETS, withPreset, type PresetId } from '../../../src/server/plan.ts';
import { createProject, saveSpecVersion, type ProjectSpec } from '../../../src/server/projects.ts';
import { draftFeatures, splitWithModel } from '../../../src/server/split.ts';

export interface IntakeState {
  error: string | null;
}

export async function createProjectAction(_prev: IntakeState, form: FormData): Promise<IntakeState> {
  const parsed = parseIntake(form);
  if ('error' in parsed) return { error: parsed.error };
  const id = await createProject(parsed.name, parsed.spec);
  revalidatePath('/projects');
  redirect(`/projects/${id}`);
}

/**
 * Without paid Claude or OpenAI keys, plan on the free providers this server has keys for:
 * each phase on a different company where it can, Gemini for the build (the best tool use of
 * the free models), and Gemini models for any phase whose provider has no key.
 */
function onKeysHere(spec: ProjectSpec, env: Readonly<Record<string, string | undefined>> = process.env): ProjectSpec {
  if (!env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY) return spec;
  const pick = (choices: Array<[string | undefined, string]>, fallback: string) =>
    choices.find(([key]) => key)?.[1] ?? fallback;
  return {
    ...spec,
    buildModel: 'google/gemini-3.8-flash',
    relay: {
      spec: pick([[env.MISTRAL_API_KEY, 'mistral/mistral-small-latest']], 'google/gemini-3.1-flash-lite'),
      architect: pick([[env.OPENROUTER_API_KEY, 'openrouter/gpt-oss-120b-free']], 'google/gemini-3-flash-preview'),
      review: pick([[env.GROQ_API_KEY, 'groq/llama-3.3-70b-versatile']], 'google/gemini-3.5-flash-lite'),
    },
  };
}

/**
 * One prompt in, features out: the project starts from the keyword split, then a model
 * splits the prompt through the Budget Gate and its split becomes spec v2. The relay
 * (spec, architect, build, review on their own models) then runs on those features.
 */
export async function createFromPromptAction(_prev: IntakeState, form: FormData): Promise<IntakeState> {
  const name = String(form.get('name') ?? '').trim();
  const idea = String(form.get('idea') ?? '').trim();
  if (!name || name.length > 80) return { error: 'Give the project a name of up to 80 characters.' };
  if (idea.length < 10 || idea.length > 2_000) return { error: 'Describe the app in 10 to 2,000 characters.' };
  const presetRaw = String(form.get('preset') ?? 'balanced');
  const preset = (presetRaw in PRESETS ? presetRaw : 'balanced') as PresetId;

  const base: ProjectSpec = {
    idea, features: draftFeatures(idea), commercialUse: form.get('commercial') === 'on',
    horizon: 'first_month', monthlyVisitors: 1_000, buildModel: 'anthropic/claude-sonnet-5-5',
    unpricedItems: [], relay: DEFAULT_RELAY,
  };
  const id = await createProject(name, onKeysHere(withPreset(base, preset)));
  const split = await splitWithModel(id, idea);
  if (split.source === 'ai') await saveSpecVersion(id, name, onKeysHere(withPreset({ ...base, features: split.features }, preset)));
  revalidatePath('/projects');
  redirect(`/projects/${id}`);
}
