import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import { dateLabel, dateLong, monthLabel, todayYMD } from '../format.js';
import { commitRows, flipType, includeNotBooked, needsLook, previewLines, sameMerchant, sectionOnByDefault, setAction, setCategory, setSection, setText, span, startReview, summary, visible, WHY } from '../importReview.js';
import Select from './ds/Select.jsx';
import { Empty, ErrorBox, Icon, Modal, Switch } from './ui.jsx';

// Reading a statement (docs/DESIGN.md section 41). The file is opened in this browser and never sent anywhere; what is sent for a preview
// and what is saved is only the list of lines shown here.

const MAPS_KEY = 'penny.import.maps';
const loadMaps = () => {
  try {
    return new Map(JSON.parse(localStorage.getItem(MAPS_KEY) || '[]'));
  } catch {
    return new Map();
  }
};
const saveMap = (signature, mapping) => {
  try {
    const all = loadMaps();
    all.delete(signature);
    all.set(signature, mapping);
    localStorage.setItem(MAPS_KEY, JSON.stringify([...all].slice(-30)));
  } catch {
    /* storage may be off: the mapping is simply not remembered */
  }
};
const hint = () => {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  let decimal = ',';
  try {
    decimal = new Intl.NumberFormat(lang).format(1.1).includes(',') ? ',' : '.';
  } catch {
    /* default */
  }
  return { dateOrder: /^en-(US|PH)\b/.test(lang) ? 'mdy' : 'dmy', decimal };
};
const todayParts = () => {
  const [y, m, d] = todayYMD().split('-').map(Number);
  return { y, m, d };
};

const KINDS = { csv: 'CSV file', xlsx: 'Excel file', pdf: 'PDF', html: 'table' };
const PAGE = 100;

export default function ImportDialog({ onClose, onDone }) {
  const { categories, reloadCategories, notify } = useApp();
  const [step, setStep] = useState('pick'); // pick | reading | password | map | review | saving | done
  const [error, setError] = useState(null);
  const [opened, setOpened] = useState(null);
  const [overrides, setOverrides] = useState({});
  const [read, setRead] = useState(null); // the reader's answer for the current overrides
  const [mapAt, setMapAt] = useState(0);
  const [rows, setRows] = useState([]);
  const [sectionOn, setSectionOn] = useState({});
  const [remember, setRemember] = useState(true);
  const [done, setDone] = useState(null);
  const [pending, setPending] = useState(null); // { file, wrong } while a password is asked for
  const [memory, setMemory] = useState(false); // what Penny remembers, shown inside this window so Escape and Back do not lose the review
  const lib = useRef(null);
  const kindRef = useRef('csv');

  const importer = async () => (lib.current ??= await import('../importer/read.js'));

  async function begin(file, password) {
    setError(null);
    setStep('reading');
    try {
      const { openStatement } = await importer();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const isPdf = new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-');
      const pdfjs = isPdf ? await (await import('../importer/pdf.js')).loadPdfjs() : undefined;
      const o = await openStatement(bytes, { pdfjs, password });
      kindRef.current = o.kind;
      setOpened(o);
      setOverrides({});
      await understand(o, {});
    } catch (e) {
      if (e?.code === 'password') {
        setPending({ file, wrong: !!e.wrong });
        setStep('password');
        return;
      }
      setError(e?.name === 'ImportError' ? e.message : 'Penny could not read that file.');
      setStep('pick');
    }
  }

  async function understand(o, ov) {
    const { interpret } = await importer();
    const res = interpret(o, { overrides: ov, saved: loadMaps(), hint: hint(), today: todayParts() });
    setRead(res);
    if (res.needsMapping >= 0 && !res.rows.length) {
      setMapAt(res.needsMapping);
      setStep('map');
      return;
    }
    await toReview(res);
  }

  async function toReview(res) {
    setStep('reading');
    try {
      const on = Object.fromEntries(res.sections.map((s) => [s.id, sectionOnByDefault(s)]));
      setSectionOn(on);
      const answers = await api.post('/import/preview', { rows: previewLines(res.rows) });
      setRows(startReview(res.rows, answers.rows, on));
      setStep('review');
    } catch (e) {
      setError(e.message);
      setStep('pick');
    }
  }

  async function save() {
    setStep('saving');
    try {
      const out = await api.post('/import/commit', { kind: kindRef.current, remember, rows: commitRows(rows) });
      setDone({ ...out, span: span(rows) });
      reloadCategories();
      setStep('done');
    } catch (e) {
      notify(e.message, 'error');
      setStep('review');
    }
  }

  async function undo() {
    if (!done?.batch_id) return;
    try {
      const r = await api.del(`/import/batches/${done.batch_id}`);
      notify(`Import undone: ${r.removed} payment${r.removed === 1 ? '' : 's'} removed`);
      onDone();
      onClose();
    } catch (e) {
      notify(e.message, 'error');
    }
  }

  const title = memory ? 'What Penny remembers' : { pick: 'Import a bank statement', reading: 'Reading…', password: 'Password needed', map: 'Match the columns', review: 'Check the payments', saving: 'Saving…', done: 'Done' }[step];
  return (
    <Modal title={title} onClose={onClose} wide>
      {memory && <Memory onClose={() => setMemory(false)} />}
      <div hidden={memory}>
      {step === 'pick' && <Pick onFile={begin} error={error} onChanged={onDone} onMemory={() => setMemory(true)} />}
      {step === 'reading' && (
        <div className="imp-wait" role="status">
          <span className="spinner" aria-hidden="true" /> Reading the statement on your device…
        </div>
      )}
      {step === 'password' && <Password wrong={pending?.wrong} onSubmit={(pw) => begin(pending.file, pw)} onCancel={() => setStep('pick')} />}
      {step === 'map' && opened && (
        <MapColumns
          opened={opened}
          index={mapAt}
          onBack={() => setStep('pick')}
          onUse={async (mapping) => {
            const { mappingToRemember } = await importer();
            const keep = mappingToRemember(opened.grids[mapAt], mapping);
            if (keep) saveMap(keep.signature, keep.mapping);
            const next = { ...overrides, [mapAt]: mapping };
            setOverrides(next);
            await understand(opened, next);
          }}
          importer={importer}
        />
      )}
      {step === 'review' && read && (
        <Review
          rows={rows}
          setRows={setRows}
          read={read}
          sectionOn={sectionOn}
          setSectionOn={setSectionOn}
          remember={remember}
          setRemember={setRemember}
          categories={categories}
          onBack={() => setStep('pick')}
          onFix={() => {
            setMapAt(read.sections.findIndex((s) => s.count > 0) >= 0 ? read.sections.findIndex((s) => s.count > 0) : 0);
            setStep('map');
          }}
          onSave={save}
          onMemory={() => setMemory(true)}
        />
      )}
      {step === 'saving' && (
        <div className="imp-wait" role="status">
          <span className="spinner" aria-hidden="true" /> Saving…
        </div>
      )}
      {step === 'done' && done && <Finished done={done} onUndo={undo} onShow={() => { onDone(done.last_date ?? done.span?.last); onClose(); }} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Choose a file
// ---------------------------------------------------------------------------------------------------------------------------------

function Pick({ onFile, error, onChanged, onMemory }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const [recent, setRecent] = useState(null);
  const { notify } = useApp();
  const loadRecent = () => api.get('/import/batches').then(setRecent, () => setRecent([]));
  useEffect(() => {
    loadRecent();
  }, []);
  const take = (files) => {
    const f = files?.[0];
    if (f) onFile(f);
  };
  async function undo(b) {
    if (!window.confirm(`Remove the ${b.remaining} payment${b.remaining === 1 ? '' : 's'} this import added${b.settled ? ' and put back the scheduled ones it marked as paid' : ''}?`)) return;
    try {
      await api.del(`/import/batches/${b.id}`);
      notify('Import undone');
      loadRecent();
      onChanged();
    } catch (e) {
      notify(e.message, 'error');
    }
  }
  return (
    <div className="imp-body">
      <div
        className={`imp-drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" size={28} />
        <strong>Drop a statement here</strong>
        <span className="muted">A PDF or a spreadsheet (CSV or Excel) from your bank, from any bank</span>
        <button type="button" className="btn primary" onClick={() => input.current?.click()}>
          Choose a file
        </button>
        <input ref={input} type="file" hidden accept=".csv,.tsv,.txt,.xlsx,.pdf,.html,.htm,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { take(e.target.files); e.target.value = ''; }} aria-label="Bank statement file" />
      </div>
      {error && <ErrorBox error={{ message: error }} />}
      <div className="imp-safe">
        <Icon name="shield" size={18} />
        <p>
          <strong>Your statement stays on your device.</strong> Penny reads it here, in your browser, and never uploads the file. Only the payment lines you see in the next step are sent, with account and card numbers taken out, and only when you press Import.
        </p>
      </div>
      {recent?.length > 0 && (
        <section className="imp-recent">
          <h3>Recent imports</h3>
          <ul>
            {recent.map((b) => (
              <li key={b.id}>
                <span>
                  <strong>{b.added} payment{b.added === 1 ? '' : 's'}</strong>
                  {b.settled > 0 && <> + {b.settled} marked paid</>}
                  <span className="muted"> · {b.first_date ? `${dateLabel(b.first_date)} to ${dateLabel(b.last_date)} · ` : ''}imported {dateLong(b.created_at.slice(0, 10))}{b.by ? ` by ${b.by}` : ''}</span>
                </span>
                <button type="button" className="btn sm" onClick={() => undo(b)}>
                  <Icon name="undo" size={14} /> Undo
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="muted small imp-foot">
        Penny learns the categories you choose. <button type="button" className="link-quiet" onClick={onMemory}>What Penny remembers</button>
      </p>
    </div>
  );
}

function Password({ wrong, onSubmit, onCancel }) {
  const [pw, setPw] = useState('');
  return (
    <form className="imp-body" onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }}>
      <p>{wrong ? 'That password is not right. Try again.' : 'This PDF is protected with a password. Banks often use a code you set up for statements.'}</p>
      <label className="field">
        <span className="field-label">PDF password</span>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" autoFocus />
        <span className="field-hint">It is used on your device to open the file and goes nowhere else.</span>
      </label>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>Back</button>
        <button className="btn primary" disabled={!pw}>Open</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Match the columns by hand
// ---------------------------------------------------------------------------------------------------------------------------------

const SIGNS = [
  ['signed', 'A minus sign means money out'],
  ['positiveOut', 'Plain numbers are money I spent'],
  ['positiveIn', 'Plain numbers are money I received'],
  ['direction', 'Another column says in or out'],
];

function MapColumns({ opened, index, onUse, onBack, importer }) {
  const grid = opened.grids[index];
  const [roles, setRoles] = useState(null);
  const [m, setM] = useState(null); // headerRow, dateOrder, decimal, sign
  const [ROLES, setROLES] = useState([]);
  const [live, setLive] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const lib = await importer();
      const { analyseGrid } = await import('../importer/detect.js');
      const { ROLES: R } = await import('../importer/headers.js');
      const g = analyseGrid(grid, { hint: hint() });
      if (!alive) return;
      setROLES(R);
      setRoles(g.roles?.length ? g.roles : Array(Math.max(...grid.rows.map((r) => r.length), 1)).fill('ignore'));
      setM({ headerRow: g.headerRow ?? -1, dateOrder: g.dateOrder ?? 'dmy', decimal: g.decimal ?? ',', sign: g.sign ?? 'signed', currency: g.currency ?? null, compactDates: !!g.compactDates });
      void lib;
    })();
    return () => {
      alive = false;
    };
  }, [grid]); // eslint-disable-line react-hooks/exhaustive-deps

  const mapping = useMemo(() => (roles && m ? { ...m, roles, dataStart: Math.max(0, m.headerRow + 1), confidence: 'high', notes: [] } : null), [roles, m]);
  useEffect(() => {
    if (!mapping) return;
    let alive = true;
    importer().then(({ interpret }) => {
      if (!alive) return;
      const r = interpret({ ...opened, grids: opened.grids.map((g, i) => (i === index ? g : { ...g, rows: [] })) }, { overrides: { [index]: mapping }, today: todayParts() });
      setLive({ rows: r.rows.slice(0, 5), count: r.rows.length, left: r.left.length, problem: r.sections[index]?.problem });
    });
    return () => {
      alive = false;
    };
  }, [mapping]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mapping) return <div className="imp-wait"><span className="spinner" aria-hidden="true" /> Looking…</div>;
  const width = roles.length;
  const sample = grid.rows.slice(0, 14);
  const set = (i, role) => setRoles((r) => r.map((x, k) => (k === i ? role : x)));
  const single = roles.includes('amount');
  return (
    <div className="imp-body">
      <p>
        Penny could not tell by itself which column is which. Choose the role of each column below. The first lines it would import show underneath, so you can see that it is right. Next time a file with the same headings is matched for you.
      </p>
      <div className="imp-scroll">
        <table className="imp-grid">
          <thead>
            <tr>
              {roles.map((role, i) => (
                <th key={i}>
                  <Select label={`Column ${i + 1}`} variant="inline" value={role} onChange={(v) => set(i, v)} options={ROLES.map((r) => ({ value: r.role, label: r.label }))} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sample.map((r, ri) => (
              <tr key={ri} className={ri === m.headerRow ? 'is-head' : ri < m.headerRow ? 'is-above' : ''} onClick={() => setM({ ...m, headerRow: ri === m.headerRow ? -1 : ri })} title="Click a line to say it holds the headings">
                {Array.from({ length: width }, (_v, i) => (
                  <td key={i}>{r[i] ?? ''}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Click the line that holds the headings (or the same line again if the file has none). Lines above it are ignored.</p>
      <div className="imp-opts">
        <label className="field">
          <span className="field-label">Dates are written</span>
          <Select label="Dates" value={m.dateOrder} onChange={(v) => setM({ ...m, dateOrder: v })} options={[{ value: 'dmy', label: 'Day, month, year (31/12/2026)' }, { value: 'mdy', label: 'Month, day, year (12/31/2026)' }]} />
        </label>
        <label className="field">
          <span className="field-label">Decimals are written</span>
          <Select label="Decimals" value={m.decimal} onChange={(v) => setM({ ...m, decimal: v })} options={[{ value: ',', label: 'With a comma (1.234,56)' }, { value: '.', label: 'With a dot (1,234.56)' }]} />
        </label>
        {single && (
          <label className="field">
            <span className="field-label">The amounts</span>
            <Select label="Amounts" value={m.sign} onChange={(v) => setM({ ...m, sign: v })} options={SIGNS.map(([value, label]) => ({ value, label }))} />
          </label>
        )}
      </div>
      <div className="imp-live" aria-live="polite">
        {live?.problem ? (
          <div className="banner warn">{live.problem}</div>
        ) : live?.rows.length ? (
          <>
            <strong>{live.count} payment{live.count === 1 ? '' : 's'} found</strong>
            <ul>
              {live.rows.map((r) => (
                <li key={r.id}>
                  <span>{dateLabel(r.date, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  <span className="imp-trunc">{r.description}</span>
                  <span className={`num ${r.type === 'income' ? 'pos' : ''}`}>{r.type === 'income' ? '+' : '−'}{r.amount.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <span className="muted">No payments found with these choices yet.</span>
        )}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onBack}>Back</button>
        <button type="button" className="btn primary" disabled={!live || !!live.problem || !live.count} onClick={() => onUse(mapping)}>
          Use this
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 3. Review
// ---------------------------------------------------------------------------------------------------------------------------------

function categoryOptions(categories, type, extra) {
  const mine = categories.filter((c) => c.kind === type).map((c) => ({ value: String(c.id), label: c.name, dot: c.color }));
  const out = [{ value: '', label: 'No category' }, ...mine];
  if (extra?.isNew) out.push({ value: `new:${extra.name}`, label: `${extra.name} (new)`, dot: extra.color });
  out.push({ value: '__new', label: 'New category…' });
  return out;
}

function Review({ rows, setRows, read, sectionOn, setSectionOn, remember, setRemember, categories, onBack, onFix, onSave, onMemory }) {
  const { money, currency } = useApp();
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [section, setSection] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [shown, setShown] = useState(PAGE);
  const [offer, setOffer] = useState(null); // { ids, category, merchant }
  const s = useMemo(() => summary(rows), [rows]);
  const list = useMemo(() => visible(rows, { view, q, section }), [rows, view, q, section]);
  const sections = read.sections.filter((x) => x.count > 0);
  const foreign = read.currency && read.currency !== currency;

  const choose = (row, value) => {
    let category;
    if (value === '__new') {
      const name = window.prompt(`Name of the new category for ${row.type === 'income' ? 'income' : 'spending'}:`)?.trim();
      if (!name) return;
      category = categories.find((c) => c.kind === row.type && c.name.toLowerCase() === name.toLowerCase());
      category = category ? { id: category.id, name: category.name, kind: category.kind } : { id: null, name: name.slice(0, 60), kind: row.type, isNew: true };
    } else if (value === '') category = null;
    else if (value.startsWith('new:')) category = row.suggested?.isNew ? row.suggested : { id: null, name: value.slice(4), kind: row.type, isNew: true };
    else {
      const c = categories.find((x) => String(x.id) === value);
      category = c ? { id: c.id, name: c.name, kind: c.kind } : null;
    }
    const next = setCategory(rows, [row.i], category);
    setRows(next);
    const others = category ? sameMerchant(next, { ...row, category }) : [];
    setOffer(others.length ? { ids: others, category, merchant: row.merchant || row.original } : null);
  };

  const bulk = (fn) => {
    const ids = [...selected];
    if (ids.length) setRows(fn(ids));
  };
  const bulkCategory = (value) => {
    const c = categories.find((x) => String(x.id) === value);
    const ids = [...selected].filter((i) => rows[i].type === (c ? c.kind : rows[i].type));
    if (value === '' || c) setRows(setCategory(rows, ids, c ? { id: c.id, name: c.name, kind: c.kind } : null));
  };
  const toggle = (i) => setSelected((cur) => {
    const n = new Set(cur);
    if (n.has(i)) n.delete(i);
    else n.add(i);
    return n;
  });
  const allShown = list.slice(0, shown);
  const allSelected = allShown.length > 0 && allShown.every((r) => selected.has(r.i));

  const views = [
    ['all', 'All', s.total],
    ['check', 'To check', s.check + s.none],
    ['skipped', 'Left out', s.skipped],
    ...(s.duplicates ? [['duplicates', 'Duplicates', s.duplicates]] : []),
    ...(s.transfers ? [['transfers', 'Transfers', s.transfers]] : []),
  ];
  const hasNotBooked = rows.some((r) => r.action === 'skip' && r.why === 'notbooked');
  const nothing = s.importing + s.settling === 0;

  return (
    <div className="imp-body imp-review">
      <div className="imp-top">
        <div className="imp-sum">
          <strong>{s.total} line{s.total === 1 ? '' : 's'} found</strong>
          <span className="muted">
            {s.importing} to import · <span className="num">−{money(s.out)}</span> · <span className="num pos">+{money(s.in)}</span>
            {s.settling > 0 && <> · {s.settling} scheduled marked paid</>}
          </span>
        </div>
        <button type="button" className="btn sm ghost" onClick={onFix}>How Penny read this file</button>
      </div>
      {read.check.checked >= 3 && (
        <p className={`imp-note ${read.check.agree / read.check.checked >= 0.9 ? 'ok' : 'warn'}`}>
          <Icon name={read.check.agree / read.check.checked >= 0.9 ? 'check' : 'alert'} size={14} />{' '}
          {read.check.agree / read.check.checked >= 0.9
            ? `Checked against the statement's own balance column: ${read.check.agree} of ${read.check.checked} lines add up.`
            : `Only ${read.check.agree} of ${read.check.checked} lines add up with the statement's balance column. Check that money in and money out were not swapped.`}
        </p>
      )}
      {foreign && <div className="banner warn">This statement is in {read.currency} but this budget uses {currency}. Amounts are imported as they are, without converting.</div>}
      {read.sections.some((x) => x.notes?.length) && (
        <ul className="imp-notes">
          {[...new Set(read.sections.flatMap((x) => x.notes ?? []))].map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      {read.notes.map((n) => <div key={n} className="banner warn">{n}</div>)}
      {s.newCategories.length > 0 && (
        <p className="imp-note"><Icon name="tag" size={14} /> New categories will be created for the lines that use them: {s.newCategories.map((c) => c.name).join(', ')}.</p>
      )}
      {sections.length > 1 && (
        <div className="imp-sections" role="group" aria-label="Parts of the statement">
          {sections.map((x) => (
            <label key={x.id} className="imp-sec">
              <Switch checked={!!sectionOn[x.id]} label={`Include ${x.title}`} onChange={(on) => { setSectionOn({ ...sectionOn, [x.id]: on }); setRows(setSection(rows, x.id, on)); }} />
              <span>{x.title.replace(/ from .*$/i, '')} <span className="muted">({x.count})</span></span>
            </label>
          ))}
        </div>
      )}
      {hasNotBooked && (
        <p className="imp-note">
          Some lines are not booked by the bank yet, so they may still change; they are left out.{' '}
          <button type="button" className="link-quiet" onClick={() => setRows(includeNotBooked(rows))}>Include them anyway</button>
        </p>
      )}

      <div className="imp-bar">
        <div className="chips" role="group" aria-label="Show">
          {views.map(([v, label, n]) => (
            <button key={v} type="button" className={`chip${view === v ? ' active' : ''}`} onClick={() => { setView(v); setShown(PAGE); }}>
              {label} <span className="seg-count">{n}</span>
            </button>
          ))}
        </div>
        <label className="search-box imp-search">
          <Icon name="search" size={16} />
          <input type="search" placeholder="Search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} aria-label="Search the lines" />
        </label>
      </div>

      <div className="imp-bulk" data-active={selected.size > 0}>
        <label className="imp-check">
          <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(allShown.map((r) => r.i)))} aria-label="Select all shown" />
          <span>{selected.size ? `${selected.size} selected` : 'Select'}</span>
        </label>
        {selected.size > 0 && (
          <>
            <Select
              label="Set category"
              variant="inline"
              value=""
              onChange={bulkCategory}
              options={[
                { value: '', label: 'Set category…' },
                ...categories.filter((c) => c.kind === 'expense').map((c) => ({ value: String(c.id), label: c.name, dot: c.color, group: 'Spending' })),
                ...categories.filter((c) => c.kind === 'income').map((c) => ({ value: String(c.id), label: c.name, dot: c.color, group: 'Income' })),
              ]}
            />
            <button type="button" className="btn sm" onClick={() => bulk((ids) => setAction(rows, ids, 'skip'))}>Leave out</button>
            <button type="button" className="btn sm" onClick={() => bulk((ids) => setAction(rows, ids, 'import'))}>Bring back</button>
            <button type="button" className="btn sm" onClick={() => bulk((ids) => flipType(rows, ids))} title="For lines whose money in and out were read the wrong way round">Swap in / out</button>
          </>
        )}
      </div>

      {offer && (
        <div className="imp-offer" role="status">
          <span>
            Use <strong>{offer.category.name}</strong> for the {offer.ids.length} other line{offer.ids.length === 1 ? '' : 's'} from <strong>{offer.merchant}</strong> too?
          </span>
          <button type="button" className="btn sm primary" onClick={() => { setRows(setCategory(rows, offer.ids, offer.category)); setOffer(null); }}>Yes</button>
          <button type="button" className="btn sm" onClick={() => setOffer(null)}>No</button>
        </div>
      )}

      {list.length === 0 ? (
        <Empty title="Nothing here" icon="search">{q ? 'No line matches your search.' : view === 'check' ? 'Everything has a category you are happy with.' : 'No lines in this view.'}</Empty>
      ) : (
        <ul className="imp-list">
          {allShown.map((r) => (
            <Line key={r.i} r={r} categories={categories} selected={selected.has(r.i)} onSelect={() => toggle(r.i)} onCategory={(v) => choose(r, v)} onText={(f) => setRows(setText(rows, r.i, f))} onAction={(a) => setRows(setAction(rows, [r.i], a))} money={money} />
          ))}
        </ul>
      )}
      {list.length > shown && (
        <button type="button" className="btn" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more of {list.length - shown}</button>
      )}

      <div className="imp-foot-bar">
        <div className="imp-remember">
          <Switch checked={remember} onChange={setRemember} label="Remember my category choices" />
          <span>Remember my category choices</span>
          <button type="button" className="link-quiet" onClick={onMemory}>What Penny remembers</button>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onBack}>Back</button>
          <button type="button" className="btn primary" disabled={nothing} onClick={onSave}>
            Import {s.importing} payment{s.importing === 1 ? '' : 's'}
            {s.settling > 0 ? ` and mark ${s.settling} paid` : ''}
          </button>
        </div>
        {s.none > 0 && <p className="muted small">{s.none} line{s.none === 1 ? ' has' : 's have'} no category. They are imported without one; you can pick one now or later.</p>}
      </div>
    </div>
  );
}

const MARK = { check: ['Check', 'Penny is not sure about this one.'], none: ['Needs a category', 'Penny has no idea what this is.'] };

function Line({ r, categories, selected, onSelect, onCategory, onText, onAction, money }) {
  const [open, setOpen] = useState(false);
  const off = r.action === 'skip';
  const mark = !off && !r.touched ? (r.category === null ? MARK.none : r.review ? MARK.check : null) : null;
  const options = useMemo(() => categoryOptions(categories, r.type, r.suggested?.isNew ? r.suggested : r.category?.isNew ? r.category : null), [categories, r.type, r.suggested, r.category]);
  const value = r.category ? (r.category.isNew ? `new:${r.category.name}` : String(r.category.id)) : '';
  return (
    <li className={`imp-line${off ? ' off' : ''}${selected ? ' sel' : ''}`}>
      <input type="checkbox" className="imp-pick" checked={selected} onChange={onSelect} aria-label={`Select ${r.description}`} />
      <div className="imp-date">
        <strong>{dateLabel(r.date)}</strong>
        {r.guessedYear && <span className="muted" title="The statement does not say the year">year assumed</span>}
      </div>
      <div className="imp-what">
        <input className="imp-desc" value={r.description} onChange={(e) => onText({ description: e.target.value })} aria-label="Description" maxLength={200} />
        <div className="imp-badges">
          {off && <span className="badge">{WHY[r.why] ?? 'Left out'}</span>}
          {r.action === 'settle' && <span className="badge ok" title={`Matches your scheduled payment "${r.duplicate?.tx?.description}" on ${r.duplicate?.tx ? dateLabel(r.duplicate.tx.date) : ''}. Penny will mark that one as paid instead of adding another.`}>Marks “{r.duplicate?.tx?.description}” as paid</span>}
          {r.duplicate && r.action !== 'settle' && (
            <span className="badge tone-warn" title={`${r.duplicate.tx.description}, ${dateLabel(r.duplicate.tx.date)}, ${money(r.duplicate.tx.amount)}`}>
              {r.duplicate.kind === 'imported' ? 'Already imported' : r.duplicate.kind === 'similar' ? 'Similar payment exists' : 'Possible duplicate'}
            </span>
          )}
          {r.transfer && !off && <span className="badge" title="A movement of money between accounts or people">Transfer</span>}
          {mark && <span className={`badge ${r.category === null ? 'danger' : 'tone-warn'}`} title={r.reason}>{mark[0]}</span>}
          {r.description !== r.original && <button type="button" className="link-quiet imp-orig" onClick={() => onText({ description: r.original })} title="Use the bank's words">bank: {r.original.slice(0, 40)}</button>}
          <button type="button" className="link-quiet" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Less' : 'More'}</button>
        </div>
        {open && (
          <div className="imp-more">
            <label className="field">
              <span className="field-label">Note</span>
              <input value={r.note} onChange={(e) => onText({ note: e.target.value.slice(0, 300) })} maxLength={300} />
            </label>
            <p className="muted small">{r.reason}</p>
          </div>
        )}
      </div>
      <div className="imp-cat">
        <Select label={`Category for ${r.description}`} variant="inline" value={value} onChange={onCategory} options={options} disabled={off} />
      </div>
      <div className={`imp-amount num ${r.type === 'income' ? 'pos' : ''}`}>{r.type === 'income' ? '+' : '−'}{money(r.amount)}</div>
      <button type="button" className="btn icon ghost sm imp-toggle" onClick={() => onAction(off ? (r.duplicate?.action === 'settle' ? 'settle' : 'import') : 'skip')} aria-label={off ? `Bring back ${r.description}` : `Leave out ${r.description}`} title={off ? 'Bring back' : 'Leave out'}>
        <Icon name={off ? 'undo' : 'x'} size={16} />
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 4. Done
// ---------------------------------------------------------------------------------------------------------------------------------

function Finished({ done, onUndo, onShow }) {
  const { money } = useApp();
  return (
    <div className="imp-body imp-done">
      <span className="empty-icon" aria-hidden="true"><Icon name="check" size={22} /></span>
      <h3>
        {done.added} payment{done.added === 1 ? '' : 's'} added{done.settled > 0 ? `, ${done.settled} scheduled marked paid` : ''}
      </h3>
      <p className="muted">
        {done.first_date && <>From {dateLong(done.first_date)} to {dateLong(done.last_date)}. </>}
        Money in <span className="num pos">+{money(done.total_in)}</span>, money out <span className="num">−{money(done.total_out)}</span>.
        {done.skipped > 0 && <> {done.skipped} line{done.skipped === 1 ? ' was' : 's were'} already there and left alone.</>}
        {done.created_categories.length > 0 && <> New categories: {done.created_categories.map((c) => c.name).join(', ')}.</>}
        {done.learned > 0 && <> Penny will remember {done.learned} of your category choices.</>}
      </p>
      <div className="modal-actions">
        {done.batch_id && (
          <button type="button" className="btn" onClick={onUndo}>
            <Icon name="undo" size={14} /> Undo this import
          </button>
        )}
        <button type="button" className="btn primary" onClick={onShow}>
          {done.last_date ? `Show ${monthLabel(done.last_date.slice(0, 7))}` : 'Close'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// What Penny remembers
// ---------------------------------------------------------------------------------------------------------------------------------

function Memory({ onClose }) {
  const { notify } = useApp();
  const [rules, setRules] = useState(null);
  const load = () => api.get('/import/rules').then(setRules, (e) => notify(e.message, 'error'));
  useEffect(() => {
    load();
  }, []);
  const forget = async (id) => {
    try {
      await api.del(`/import/rules/${id}`);
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  const forgetAll = async () => {
    if (!window.confirm('Forget every category Penny learned from your imports? Your payments stay as they are.')) return;
    try {
      await api.del('/import/rules');
      load();
    } catch (e) {
      notify(e.message, 'error');
    }
  };
  return (
    <>
      <div className="imp-body">
        <p className="muted">When you change a category while importing, Penny keeps the shop and the category (nothing else: no amounts, no dates) and prefers it next time. It is kept for this budget only.</p>
        {!rules ? (
          <div className="imp-wait"><span className="spinner" aria-hidden="true" /> Loading…</div>
        ) : rules.length === 0 ? (
          <Empty title="Nothing yet" icon="tag">Choose a category for a line while importing and Penny will remember it.</Empty>
        ) : (
          <ul className="imp-rules">
            {rules.map((r) => (
              <li key={r.id}>
                <span><strong>{r.merchant_key}</strong> <span className="muted">({r.kind === 'income' ? 'income' : 'spending'})</span></span>
                <span className="cat"><span className="dot" style={{ background: r.category_color }} /> {r.category_name}</span>
                <button type="button" className="btn icon ghost sm" onClick={() => forget(r.id)} aria-label={`Forget ${r.merchant_key}`}><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          {rules?.length > 0 && <button type="button" className="btn" onClick={forgetAll}>Forget everything</button>}
          <button type="button" className="btn primary" onClick={onClose}>Back</button>
        </div>
      </div>
    </>
  );
}
