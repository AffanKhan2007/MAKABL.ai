'use client';

const DEFAULT_STEPS = ['Describe', 'Features', 'Usage', 'Build'];

export function WizardProgress({ step, steps = DEFAULT_STEPS }: { step: number; steps?: readonly string[] }) {
  const STEPS = steps;
  return (
    <nav className="wizard-progress" aria-label="Project creation progress">
      <ol>
        {STEPS.map((label, index) => {
          const number = index + 1;
          const state = number < step ? 'complete' : number === step ? 'current' : 'upcoming';
          return (
            <li key={label} className={`wizard-progress-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="wizard-progress-marker" aria-hidden="true">{state === 'complete' ? '✓' : number}</span>
              <span className="wizard-progress-label">{label}</span>
            </li>
          );
        })}
      </ol>
      <p className="wizard-step-count">Step {step} of {STEPS.length}</p>
    </nav>
  );
}

export function WizardActions({ step, total = 4, onPrevious, onContinue, pending, submitLabel }: {
  step: number;
  total?: number;
  onPrevious: () => void;
  onContinue: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="wizard-actions">
      {step > 1
        ? <button type="button" className="secondary" onClick={onPrevious} disabled={pending}>← Previous</button>
        : <span />}
      {step < total
        ? <button type="button" onClick={onContinue} disabled={pending}>Continue <span aria-hidden="true">→</span></button>
        : <button type="submit" disabled={pending}>{submitLabel} <span aria-hidden="true">→</span></button>}
    </div>
  );
}
