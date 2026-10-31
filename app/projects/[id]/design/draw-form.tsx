'use client';

import { useFormStatus } from 'react-dom';

// The ask-for-another-version form. A mockup takes 10 to 60 seconds, so the button says so
// while it works, and cannot be pressed twice.

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? 'Drawing… (10–60 s)' : label}
    </button>
  );
}

export function DrawForm({ action, first, easy, estimate, base }: {
  action: (form: FormData) => Promise<void>;
  first: boolean;
  easy: boolean;
  /** Plain-words cost line shown before the button. */
  estimate: string;
  /** The version on screen, which the change applies to. */
  base?: number;
}) {
  return (
    <form action={action} className="stack">
      {base !== undefined && <input type="hidden" name="base" value={base} />}
      {!first && (
        <div>
          <label htmlFor="feedback">{easy ? 'What would you like changed?' : `Change request, applied to v${base}`}</label>
          <textarea id="feedback" name="feedback" required maxLength={600}
            placeholder="e.g. Put the booking button at the top, make it feel warmer, add a menu page" />
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>{estimate}</p>
      <div><Submit label={first ? (easy ? 'Show me what it will look like' : 'Draw the mockup') : (easy ? 'Try another version' : 'Draw a new version')} /></div>
    </form>
  );
}
