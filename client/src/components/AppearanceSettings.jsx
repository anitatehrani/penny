import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApp } from '../context.jsx';
import { ACCENTS, usePrefs } from '../prefs.jsx';
import AvatarPicker from './avatar/AvatarPicker.jsx';
import { Avatar } from './Avatar.jsx';
import { Icon, Segmented, Switch, ThemeToggle } from './ui.jsx';

const SWATCH = { blue: '#1f5fc4', green: '#2a7a3b', violet: '#6a4fc9', amber: '#a35f00', rose: '#c2335a', graphite: '#363a41' };

function Row({ label, hint, htmlFor, children }) {
  return (
    <div className="pref-row">
      <label className="pref-text" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint && <span className="muted small">{hint}</span>}
      </label>
      <div className="pref-control">{children}</div>
    </div>
  );
}

/** How the app looks and behaves for you: theme, accent colour, density, sidebar, dashboard layout, avatar and status. */
export default function AppearanceSettings() {
  const { prefs, setPrefs, resetPrefs } = usePrefs();
  const { user, setUser } = useAuth();
  const { notify } = useApp();
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);

  async function setStatus(on) {
    try {
      const res = await api.put('/profile', { name: user.name, username: user.username, phone: user.phone ?? null, discoverable: user.discoverable, find_by_email: user.find_by_email, find_by_phone: user.find_by_phone, show_status: on });
      setUser(res.user);
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  return (
    <div className="pref-stack">
      <section className="card pref-section">
        <div className="pref-head">
          <h2>Look and feel</h2>
          <p className="muted small">These choices follow you to any device. Shared budgets keep their own teal colour so you always know whose money you are looking at.</p>
        </div>
        <Row label="Theme" hint="Light, dark, or follow your device.">
          <ThemeToggle />
        </Row>
        <Row label="Accent colour" hint="Used for buttons, links and highlights.">
          <div className="swatches" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map(([id, name]) => (
              <button key={id} role="radio" aria-checked={prefs.accent === id} aria-label={name} title={name} className={`swatch-btn${prefs.accent === id ? ' on' : ''}`} style={{ '--sw': SWATCH[id] }} onClick={() => setPrefs({ accent: id })}>
                {prefs.accent === id && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Density" hint="Compact fits more on screen; comfortable gives rows more room.">
          <Segmented
            label="Density"
            value={prefs.density}
            onChange={(v) => setPrefs({ density: v })}
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
        </Row>
        <Row label="Collapse the sidebar" hint="Show only icons in the menu. Hover an icon to see its name." htmlFor="sb">
          <Switch id="sb" checked={prefs.sidebar_collapsed} onChange={(v) => setPrefs({ sidebar_collapsed: v })} label="Collapse the sidebar" />
        </Row>
      </section>

      <section className="card pref-section">
        <div className="pref-head">
          <h2>Dashboard</h2>
          <p className="muted small">Rearrange, resize or hide the widgets on your dashboard.</p>
        </div>
        <Row label="Customise the layout" hint="Opens the dashboard in edit mode.">
          <button className="btn" onClick={() => navigate('/?customize=1')}>
            <Icon name="layout" size={16} /> Customise dashboard
          </button>
        </Row>
        <Row label="Start again" hint="Puts the widgets, sizes, pins, density and accent back to the defaults.">
          <button
            className="btn"
            onClick={async () => {
              await resetPrefs();
              notify('Preferences reset');
            }}
          >
            Reset all preferences
          </button>
        </Row>
      </section>

      <section className="card pref-section">
        <div className="pref-head">
          <h2>You</h2>
        </div>
        <Row label="Avatar" hint="A photo, your initials, a generated pattern or a small illustration.">
          <button className="btn avatar-change" onClick={() => setPicking(true)}>
            <Avatar user={user} size={24} showStatus={false} /> Change avatar
          </button>
        </Row>
        <Row label="Show when I’m active" hint="People you are connected to, or share a budget with, see a green dot while you are using the app." htmlFor="st">
          <Switch id="st" checked={user.show_status !== false} onChange={setStatus} label="Show when I’m active" />
        </Row>
      </section>
      {picking && <AvatarPicker onClose={() => setPicking(false)} />}
    </div>
  );
}
