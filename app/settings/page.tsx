import { getMode } from '../../src/server/mode.ts';
import { requireUser } from '../../src/server/session.ts';
import { setModeAction } from '../mode-actions.ts';
import { ThemeSelector } from './theme-selector.tsx';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();
  const mode = await getMode();

  return (
    <main style={{ maxWidth: 860 }}>
      <div style={{ marginBottom: 24 }}>
        <span className="eyebrow">Workspace</span>
        <h1 style={{ marginTop: 8 }}>Settings</h1>
        <p className="sub" style={{ margin: 0 }}>
          Manage your account credentials, appearance preferences, and application defaults.
        </p>
      </div>

      <div className="stack" style={{ gap: 20 }}>
        {/* Account Information */}
        <section className="card stack">
          <div className="row spread">
            <div>
              <h2 style={{ margin: 0 }}>Account Information</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Your authentication details and workspace identity.
              </p>
            </div>
            <span className="badge good">Active Session</span>
          </div>

          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <th style={{ width: 160 }}>Email</th>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 550 }}>{user.email}</span>
                      <span className="badge accent">Verified</span>
                    </div>
                  </td>
                </tr>
                <tr>
                  <th>User ID</th>
                  <td>
                    <code className="mono small">{user.id}</code>
                  </td>
                </tr>
                <tr>
                  <th>Session Security</th>
                  <td className="muted small">
                    Signed in with secure, HTTP-only cookie. Session automatically renews for up to 30 days.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Appearance Settings */}
        <section className="card stack">
          <div className="row spread">
            <div>
              <h2 style={{ margin: 0 }}>Appearance</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>
                Choose between Light Mode, Dark Mode, or match your System Default. Changes take effect instantly.
              </p>
            </div>
          </div>

          <ThemeSelector />

          <div className="setting-box" style={{ marginTop: 8 }}>
            <div className="setting-box-header">
              <strong>Typography System</strong>
              <span className="badge">Geist</span>
            </div>
            <p className="muted small" style={{ margin: '6px 0 10px' }}>
              Engineered with high-legibility Geist Sans and tabular Geist Mono figures for financial accuracy.
            </p>
            <div className="mono small num" style={{ color: 'var(--text-2)' }}>
              Sample: $12.45 – $48.20 · 1.2M tokens
            </div>
          </div>
        </section>

        {/* Application Preferences */}
        <section className="card stack">
          <div>
            <h2 style={{ margin: 0 }}>Application Preferences</h2>
            <p className="muted small" style={{ margin: '4px 0 0' }}>
              Tailor the build forecasting workflow to your preference.
            </p>
          </div>

          <div className="setting-row">
            <div>
              <strong>Interface Mode</strong>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                {mode === 'easy'
                  ? 'Currently set to Easy Mode: Simplified language, quick presets, and essential numbers.'
                  : 'Currently set to Pro Mode: Multi-model relays, granular phase pricing, and comprehensive verification reports.'}
              </p>
            </div>

            <form action={setModeAction} className="mode-switch" aria-label="Interface mode selector">
              <button
                type="submit"
                name="mode"
                value="easy"
                aria-pressed={mode === 'easy'}
                title="Plain words, fewer choices"
              >
                Easy
              </button>
              <button
                type="submit"
                name="mode"
                value="pro"
                aria-pressed={mode === 'pro'}
                title="Every model, phase and number"
              >
                Pro
              </button>
            </form>
          </div>

          <div className="setting-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div>
              <strong>Budget Gate Protection</strong>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                Every model call reserves its worst-case token spend before running. If a call could exceed your cap, the build pauses and requests explicit approval.
              </p>
            </div>
            <span className="badge good">Enabled</span>
          </div>

          <div className="setting-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div>
              <strong>Calibration Accuracy</strong>
              <p className="muted small" style={{ margin: '2px 0 0' }}>
                Anonymous token counts and verified run logs refine cost ranges for future projects without exposing workspace data.
              </p>
            </div>
            <span className="badge accent">Active</span>
          </div>
        </section>
      </div>
    </main>
  );
}
