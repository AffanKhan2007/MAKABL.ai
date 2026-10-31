'use client';

const STEPS = ['Describe', 'Features', 'Usage', 'Build'] as const;

export function WizardProgress({ step }: { step: number }) {
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

export function WizardActions({ step, onPrevious, onContinue, pending, submitLabel }: {
  step: number;
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
      {step < 4
        ? <button type="button" onClick={onContinue} disabled={pending}>Continue <span aria-hidden="true">→</span></button>
        : <button type="submit" disabled={pending}>{submitLabel} <span aria-hidden="true">→</span></button>}
    </div>
  );
}
