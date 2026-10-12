import { Tooltip } from '../components/ds/Tooltip.jsx';
import { Icon } from '../components/ui.jsx';
import { usePrefs } from '../prefs.jsx';
import { N_, t } from '../i18n/translate.js';

const SIZES = [
  ['s', 'S', N_('Small')],
  ['m', 'M', N_('Medium')],
  ['l', 'L', N_('Wide')],
];

/**
 * The frame every dashboard widget sits in: a ruled section heading (optionally collapsible, remembered per person)
 * and, while customising, move / resize / hide controls. Widgets do not draw their own borders.
 */
export default function WidgetFrame({ id, label, eyebrow, title, actions, collapsible = true, size, edit, controls, className = '', children }) {
  const { prefs, setPrefs } = usePrefs();
  const collapsed = collapsible && prefs.collapsed?.includes(id) && !edit;
  const toggle = () => setPrefs({ collapsed: collapsed ? (prefs.collapsed ?? []).filter((w) => w !== id) : [...(prefs.collapsed ?? []), id] });
  const bodyId = `widget-${id}-body`;

  return (
    <section className={`widget size-${size}${edit ? ' editing' : ''}${collapsed ? ' is-collapsed' : ''} ${className}`} data-widget={id} aria-label={label ?? title}>
      {edit && controls && (
        <div className="widget-edit" role="toolbar" aria-label={t('Customise {value}', { value: label ?? title })}>
          <span className="widget-edit-name">
            <Icon name="grip" size={14} /> {label ?? title}
          </span>
          <span className="widget-edit-tools">
            <button className="btn icon sm ghost" onClick={controls.onUp} disabled={!controls.canUp} aria-label={t('Move {value} earlier', { value: label ?? title })} title={t('Move earlier')}>
              <Icon name="up" size={14} />
            </button>
            <button className="btn icon sm ghost" onClick={controls.onDown} disabled={!controls.canDown} aria-label={t('Move {value} later', { value: label ?? title })} title={t('Move later')}>
              <Icon name="down" size={14} />
            </button>
            <span className="segmented mini" role="radiogroup" aria-label={t('Size of {value}', { value: label ?? title })}>
              {SIZES.map(([v, short, long]) => (
                <button key={v} role="radio" aria-checked={size === v} className={size === v ? 'active' : ''} onClick={() => controls.onSize(v)} title={t(long)} aria-label={t(long)}>
                  {short}
                </button>
              ))}
            </span>
            <button className="btn icon sm ghost" onClick={controls.onHide} aria-label={t('Hide {value}', { value: label ?? title })} title={t('Hide')}>
              <Icon name="eyeOff" size={14} />
            </button>
          </span>
        </div>
      )}
      {!title && label && <h2 className="sr-only">{label}</h2>}
      {(title || actions) && (
        <header className="section-head">
          {collapsible ? (
            <button className="section-toggle" onClick={toggle} aria-expanded={!collapsed} aria-controls={bodyId}>
              <Icon name="chevron" size={14} />
              <span>
                {eyebrow && <span className="eyebrow block">{eyebrow}</span>}
                <h2>{title}</h2>
              </span>
            </button>
          ) : (
            <div>
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              <h2>{title}</h2>
            </div>
          )}
          {actions && <div className="section-actions">{actions}</div>}
        </header>
      )}
      <div className={`section-collapse${collapsed ? ' closed' : ''}`} id={bodyId}>
        <div>
          <div className="widget-body">{children}</div>
        </div>
      </div>
    </section>
  );
}

export { Tooltip };
