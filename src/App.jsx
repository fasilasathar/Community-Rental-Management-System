import { useEffect, useState, useCallback } from 'react';

const localStorage = window.sessionStorage; // each tab keeps its own login

const api = async (url, method = 'GET', body) => {
  const token = localStorage.getItem('token');
  const isForm = body instanceof FormData;

  const res = await fetch(url, {
    method,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    headers: {
      ...(!isForm && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: 'Bearer ' + token })
    }
  });

  const data = await res.json();

  if (!res.ok) {
    throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  }

  return data;
};

const typeLabel = { deposit: 'Deposit', rent: 'Rent', late_fee: 'Late fee', damage: 'Damage charge', refund: 'Deposit refund' };
const modeLabel = { cash: 'Cash', upi: 'UPI', card: 'Card', netbanking: 'Net Banking' };
const upiQuery = (p, to, upi) =>
  `pa=${upi}&pn=${encodeURIComponent(to)}&am=${Number(p.amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`${typeLabel[p.type]} - ${p.item}`)}`;
// ===== FULL KEYBOARD NAVIGATION =====
function useKeyboardNavigation() {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't interrupt typing or native dropdown controls
      const tag = document.activeElement?.tagName;
      if (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) ||
        document.activeElement?.isContentEditable ||
        e.ctrlKey || e.altKey || e.metaKey
      ) return;

      const elements = [...document.querySelectorAll(
        'a[href], button:not(:disabled), input:not(:disabled), ' +
        'select:not(:disabled), textarea:not(:disabled), ' +
        '[tabindex]:not([tabindex="-1"])'
      )].filter(el =>
        el.getClientRects().length &&
        getComputedStyle(el).visibility !== 'hidden'
      );

      const current = document.activeElement;
      const index = elements.indexOf(current);

      // Tab and Shift+Tab remain native browser navigation
      if (e.key === 'Tab') return;

      // Home and End: first or last focusable control
      if (e.key === 'Home' || e.key === 'End') {
        if (!elements.length) return;
        e.preventDefault();
        elements[e.key === 'Home' ? 0 : elements.length - 1].focus();
        return;
      }

      // Escape: release current focus
      if (e.key === 'Escape') {
        if (current && current !== document.body) current.blur();
        return;
      }

      const directions = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }
      };

      const direction = directions[e.key];
      if (!direction || !elements.length) return;

      const rect = current?.getBoundingClientRect();
      if (!rect || index === -1) {
        // Start keyboard navigation at the first control
        e.preventDefault();
        elements[0].focus();
        return;
      }

      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      let best = null;
      let bestScore = Infinity;

      elements.forEach((el, i) => {
        if (el === current) return;

        const r = el.getBoundingClientRect();
        const dx = r.left + r.width / 2 - cx;
        const dy = r.top + r.height / 2 - cy;

        const primary =
          dx * direction.x + dy * direction.y;

        // Only consider controls in the requested direction
        if (primary <= 2) return;

        const secondary =
          Math.abs(dx * direction.y - dy * direction.x);

        const score = primary + secondary * 2.5;

        if (score < bestScore) {
          bestScore = score;
          best = el;
        }
      });

      if (best) {
        e.preventDefault();
        best.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () =>
      document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
function Auth({ onAuth }) {
  const [reg, setReg] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      const out = await api(reg ? '/api/auth/register' : '/api/auth/login', 'POST', Object.fromEntries(new FormData(e.target)));
      localStorage.setItem('token', out.token); localStorage.setItem('user', JSON.stringify(out.user)); onAuth(out.user);
    } catch (e2) { setErr(e2.message); }
  };
  return (<main className="auth"><h2>{reg ? 'Create account' : 'Sign in'}</h2>
    {err && <p className="err">{err}</p>}
    <form onSubmit={submit} className="stack">
      {reg && <>
        <input name="name" placeholder="Full name" required />
        <input name="address" placeholder="Address" required />
        <input name="upi_id" placeholder="UPI ID (optional)" />
      </>}
      <input name="phone" placeholder={reg ? 'Phone' : 'Name or phone'} required />
      <input name="password" type="password" placeholder="Password (min 6)" required />
      <button>{reg ? 'Register' : 'Log in'}</button>
    </form>
    <p><a href="#" onClick={e => { e.preventDefault(); setReg(!reg); setErr(''); }}>
      {reg ? 'Have an account? Log in' : 'New here? Register'}</a></p></main>);
}

/* ====================== ADMIN PANEL ====================== */
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN');
const sortRows = (rows, sort, opts) => {
  const opt = opts.find(o => o[0] === sort.key);
  if (!opt) return rows;
  const get = opt[2] || (r => r[sort.key]);
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    const ex = x == null || x === '', ey = y == null || y === '';
    if (ex || ey) return ex === ey ? 0 : ex ? 1 : -1;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
  });
};

function SortBar({ opts, sort, setSort }) {
  return (
    <span className="sortbar">
      <select value={sort.key} onChange={e => setSort({ ...sort, key: e.target.value })}>
        <option value="">Sort by…</option>
        {opts.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      <button type="button" className="sm ghost" disabled={!sort.key}
        onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}>
        {sort.dir === 'asc' ? 'A→Z · 1→9 ↑' : 'Z→A · 9→1 ↓'}
      </button>
    </span>
  );
}

const memberSort = [['member_id', 'ID'], ['name', 'Name'], ['address', 'Address'], ['phone', 'Phone'], ['items', 'Items'], ['rentals', 'Rentals'], ['active', 'Active']];
const itemSort = [['name', 'Name'], ['category', 'Category'], ['owner', 'Owner'], ['daily_rate', 'Rate'], ['deposit', 'Deposit'], ['status', 'Status']];
const rentalSort = [['rental_id', '#'], ['item', 'Item'], ['owner', 'Owner'], ['renter', 'Renter'], ['start_date', 'Start'], ['due_date', 'Due'], ['return_date', 'Returned'], ['total_amount', 'Rent']];
const paymentSort = [['paid_on', 'Date'], ['rental_id', 'Rental'], ['item', 'Item'], ['type', 'Type', p => typeLabel[p.type]], ['mode', 'Mode', p => modeLabel[p.mode]], ['amount', 'Amount']];
const userMemberSort = [['member_id', 'ID'], ['name', 'Name'], ['address', 'Address'], ['phone', 'Phone']];
const userRentalSort = [['item', 'Item'], ['renter', 'Renter'], ['start_date', 'Start'], ['due_date', 'Due'], ['return_date', 'Returned'], ['total_amount', 'Rent']];
function Admin() {
  const [tab, setTab] = useState('dashboard');
  const [d, setD] = useState({ ov: null, members: [], items: [], rentals: [], payments: [], categories: [] });
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [rf, setRf] = useState('all');
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [edit, setEdit] = useState(null); // null = form closed, 'new' = add form, an item = edit form
  const [view, setView] = useState(null); // item shown in the photo viewer
  const [pick, setPick] = useState(null); // preview of a newly chosen photo
  const logout = () => { localStorage.clear(); window.location.reload(); };

  const load = useCallback(async () => {
    try {
      const [ov, members, items, rentals, payments, categories] = await Promise.all(
        ['admin/overview', 'admin/members', 'items', 'rentals', 'payments', 'categories'].map(k => api('/api/' + k)));
      setD({ ov, members, items, rentals, payments, categories });
    } catch (e) { if (e.status === 401) logout(); else setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async fn => { setErr(''); try { await fn(); await load(); return true; } catch (e) { setErr(e.message); return false; } };
  const match = (...f) => !q.trim() || f.join(' ').toLowerCase().includes(q.trim().toLowerCase());
  const switchTab = t => { setTab(t); setQ(''); setErr(''); setEdit(null); setSort({ key: '', dir: 'asc' }); };
  const openForm = it => { setEdit(it); setPick(null); setErr(''); };
  const saveItem = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get('image')?.size) fd.delete('image'); // no new photo chosen
    const ok = await act(() => edit === 'new' ? api('/api/admin/items', 'POST', fd) : api(`/api/admin/items/${edit.item_id}`, 'PUT', fd));
    if (ok) openForm(null);
  };
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && setView(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const exportCsv = () => {
    const rows = [['Date', 'Rental', 'Item', 'Type', 'Mode', 'From', 'To', 'Amount'],
      ...d.payments.map(p => [p.paid_on, p.rental_id, p.item, typeLabel[p.type], modeLabel[p.mode],
        p.type === 'refund' ? p.owner : p.renter, p.type === 'refund' ? p.renter : p.owner, p.amount])];
    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'payments.csv'; a.click();
  };

  const ov = d.ov;
  const t = ov?.totals || {};
  const maxM = Math.max(1, ...(ov?.monthly || []).map(m => m.total));
  const tabs = [['dashboard', 'Dashboard'], ['members', 'Members'], ['items', 'Items'],
    ['rentals', 'Rentals'], ['payments', 'Payments'], ['categories', 'Categories']];

  const search = ph => <input className="adm-search" placeholder={ph} value={q} onChange={e => setQ(e.target.value)} />;

  return (<div className="adm">
    <aside>
      <div className="adm-brand"><span className="logo">CR</span>
        <div><b>Community Rentals</b><small>Admin console</small></div></div>
      <small className="adm-nav">Menu</small>
      {tabs.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => switchTab(k)}>{label}</button>)}
      <button className="adm-out" onClick={logout}>⎋ Log out</button>
    </aside>
    <section>
      <div className="adm-head">
        <h2 className="adm-title">{tabs.find(x => x[0] === tab)[1]}</h2>
        <span className="adm-date">{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
      </div>
      {err && <p className="err">{err}</p>}

      {tab === 'dashboard' && ov && <>
        <div className="cards">
          {[
            ['Members', t.members, '👥'], ['Items', `${t.available}/${t.items} free`, '📦'], ['Active rentals', t.active, '🔁'],
            ['Overdue', t.overdue, '⏰'], ['Total rentals', t.rentals, '🧾'], ['Rent collected', money(t.rent), '💰'],
            ['Late fees', money(t.late_fees), '🕒'], ['Damage charges', money(t.damage), '🛠️'], ['Deposits held', money(t.deposits_held), '🔒']
          ].map(([k, v, ic]) => <div className={'card' + (k === 'Rent collected' ? ' hero' : '')} key={k}>
            <i>{ic}</i><b>{v ?? 0}</b>{k}</div>)}
        </div>
        <div className="adm-row">
          <div className="panel"><h3>Revenue by month</h3>
            {ov.monthly.length === 0 ? <p className="hint">No payments yet.</p> :
              <div className="bars">{ov.monthly.map(m => <div className="bar" key={m.month}>
                <small>{money(m.total)}</small><i style={{ height: (m.total / maxM * 100) + '%' }} /><span>{m.month}</span></div>)}</div>}
          </div>
          <div className="panel"><h3>Most rented items</h3>
            {ov.topItems.length === 0 ? <p className="hint">No rentals yet.</p> :
              <ol className="rank">{ov.topItems.map((x, i) => <li key={i}>{x.name}<b>{x.n}</b></li>)}</ol>}
            <h3 style={{ marginTop: 14 }}>Most active renters</h3>
            {ov.topMembers.length === 0 ? <p className="hint">No rentals yet.</p> :
              <ol className="rank">{ov.topMembers.map((x, i) => <li key={i}>{x.name}<b>{x.n}</b></li>)}</ol>}
          </div>
        </div>
        <div className="panel"><h3>Overdue rentals ({ov.overdueList.length})</h3>
          {ov.overdueList.length === 0 ? <p className="hint">Nothing overdue</p> :
            <table><thead><tr><th>Rental</th><th>Item</th><th>Renter</th><th>Due</th></tr></thead>
              <tbody>{ov.overdueList.map(o => <tr key={o.rental_id}><td>#{o.rental_id}</td><td>{o.item}</td><td>{o.renter}</td>
                <td><span className="tag overdue">{o.due_date}</span></td></tr>)}</tbody></table>}
        </div>
      </>}

      {tab === 'members' && <>
        <div className="adm-bar">
  {search("Search name, phone, address…")}
  <SortBar opts={memberSort} sort={sort} setSort={setSort} />
</div>
        <table><thead><tr><th>ID</th><th>Name</th><th>Address</th><th>Phone</th><th>UPI</th><th>Items</th><th>Rentals</th><th>Active</th><th></th></tr></thead>
          <tbody>{sortRows(d.members.filter(m => match(m.name, m.phone, m.address)), sort, memberSort).map(m => <tr key={m.member_id}>
            <td>{m.member_id}</td><td>{m.name}</td><td>{m.address}</td><td>{m.phone}</td><td>{m.upi_id || '—'}</td>
            <td>{m.items}</td><td>{m.rentals}</td><td>{m.active}</td>
            <td className="actions">
              <button className="sm" onClick={() => {
                const p = window.prompt(`New password for ${m.name} (min 6 characters):`);
                if (p) act(() => api(`/api/admin/members/${m.member_id}/password`, 'PUT', { password: p }));
              }}>Reset password</button>
              <button className="sm danger" onClick={() => window.confirm(`Delete ${m.name} and ALL their items, rentals and payments? This cannot be undone.`) &&
                act(() => api(`/api/admin/members/${m.member_id}`, 'DELETE'))}>Delete</button>
            </td></tr>)}</tbody></table>
      </>}

      {tab === 'items' && <>
        <div className="adm-bar">
          {search("Search item, category, owner…")}
          <SortBar opts={itemSort} sort={sort} setSort={setSort} />
          {!edit && <button className="adm-btn" onClick={() => openForm('new')}>+ Add item</button>}
        </div>
        {edit && <div className="panel"><h3>{edit === 'new' ? 'Add an item' : `Edit "${edit.name}"`}</h3>
          {edit.status === 'rented' && <p className="hint">This item is rented out, so its rate and deposit are locked. You can still change the photo, name and category.</p>}
          <form key={edit === 'new' ? 'new' : edit.item_id} onSubmit={saveItem}>
            {edit === 'new' && <select name="owner_id" required defaultValue="">
              <option value="" disabled>Owner…</option>
              {sortRows(d.members, sort, userMemberSort).map(m => <option key={m.member_id} value={m.member_id}>{m.name}</option>)}</select>}
            <input name="name" defaultValue={edit.name} placeholder="Item name" required />
            <select name="category_id" defaultValue={edit.category_id} required>
              {d.categories.map(c => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</select>
            <input name="daily_rate" type="number" min="1" step="0.5" defaultValue={edit.daily_rate} placeholder="₹ / day" required readOnly={edit.status === 'rented'} />
            <input name="deposit" type="number" min="0" defaultValue={edit.deposit} placeholder="Deposit ₹" readOnly={edit.status === 'rented'} />
            <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Item photo"
              onChange={e => setPick(e.target.files[0] ? URL.createObjectURL(e.target.files[0]) : null)} />
            {(pick || edit.image) && <img src={pick || edit.image} alt="Item photo preview" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} />}
            {edit.image && !pick && <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
              <input type="checkbox" name="remove_image" value="1" style={{ minWidth: 0, width: 18, height: 18, padding: 0 }} /> Remove photo</label>}
            <button>{edit === 'new' ? 'Add item' : 'Save changes'}</button>
            <button type="button" className="ghost" onClick={() => openForm(null)}>Cancel</button>
          </form></div>}
        <table><thead><tr><th></th><th>Name</th><th>Category</th><th>Owner</th><th>Rate</th><th>Deposit</th><th>Status</th><th></th></tr></thead>
          <tbody>{sortRows(d.items.filter(i => match(i.name, i.category, i.owner)), sort, itemSort).map(i => <tr key={i.item_id}>
            <td>{i.image
              ? <img src={i.image} alt={`View photo of ${i.name}`} role="button" tabIndex={0} onClick={() => setView(i)}
                  onKeyDown={e => e.key === 'Enter' && setView(i)}
                  style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, display: 'block', cursor: 'zoom-in' }} />
              : '📦'}</td>
            <td>{i.name}</td><td>{i.category}</td><td>{i.owner}</td><td>₹{i.daily_rate}/day</td><td>₹{i.deposit}</td>
            <td><span className={'tag ' + i.status}>{i.status}</span></td>
            <td className="actions">
              <button className="sm" onClick={() => { openForm(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
              <button className="sm danger" onClick={() => window.confirm(`Delete "${i.name}" and its rental history?`) &&
                act(() => api(`/api/admin/items/${i.item_id}`, 'DELETE'))}>Delete</button></td></tr>)}</tbody></table>
      </>}

      {tab === 'rentals' && <>
        <div className="adm-bar">
          {search("Search item, renter, owner…")}
          <SortBar opts={rentalSort} sort={sort} setSort={setSort} />
          <select value={rf} onChange={e => setRf(e.target.value)}>
            <option value="all">All rentals</option><option value="active">Active</option>
            <option value="overdue">Overdue</option><option value="returned">Returned</option>
          </select>
        </div>
        <table><thead><tr><th>#</th><th>Item</th><th>Owner</th><th>Renter</th><th>Start</th><th>Due</th><th>Returned</th><th>Rent</th><th></th></tr></thead>
          <tbody>{sortRows(d.rentals.filter(r => match(r.item, r.renter, r.owner) &&
  (rf === 'all' || (rf === 'active' && !r.return_date) || (rf === 'overdue' && r.overdue) || (rf === 'returned' && r.return_date))), sort, rentalSort)
  .map(r => <tr key={r.rental_id}>
              <td>{r.rental_id}</td><td>{r.item}</td><td>{r.owner}</td><td>{r.renter}</td><td>{r.start_date}</td>
              <td>{r.due_date} {r.overdue ? <span className="tag overdue">overdue</span> : null}</td>
              <td>{r.return_date || '—'}</td><td>{r.total_amount ?? '—'}</td>
              <td className="actions">
                {!r.return_date && <>
                  <button className="sm" onClick={() => {
                    const v = window.prompt('New due date (YYYY-MM-DD):', r.due_date);
                    if (v) act(() => api(`/api/admin/rentals/${r.rental_id}`, 'PUT', { due_date: v }));
                  }}>Edit due</button>
                  <button className="sm" onClick={() => {
                    const v = window.prompt('Damage charge ₹ (0 if none):', '0');
                    if (v === null) return;
                    act(() => api(`/api/admin/rentals/${r.rental_id}/return`, 'POST', { damage: Number(v) || 0 }));
                  }}>Force return</button></>}
                <button className="sm danger" onClick={() => window.confirm('Delete this rental and its payments?') &&
                  act(() => api(`/api/admin/rentals/${r.rental_id}`, 'DELETE'))}>Delete</button>
              </td></tr>)}</tbody></table>
      </>}

      {tab === 'payments' && <>
        <div className="adm-bar">
          {search("Search item, member, type…")}
          <SortBar opts={paymentSort} sort={sort} setSort={setSort} />
          <button className="adm-btn" onClick={exportCsv}>⬇ Export CSV</button>
        </div>
        <table><thead><tr><th>Date</th><th>Rental</th><th>Item</th><th>Type</th><th>Mode</th><th>From → To</th><th>Amount</th></tr></thead>
          <tbody>{sortRows(d.payments.filter(p => match(p.item, p.renter, p.owner, typeLabel[p.type])), sort, paymentSort).map(p => {
            const refund = p.type === 'refund';
            return <tr key={p.payment_id}>
              <td>{p.paid_on}</td><td>#{p.rental_id}</td><td>{p.item}</td>
              <td><span className={'tag pay-' + p.type}>{typeLabel[p.type]}</span></td>
              <td><span className="tag mode">{modeLabel[p.mode]}</span></td>
              <td>{refund ? p.owner : p.renter} → {refund ? p.renter : p.owner}</td>
              <td><b>₹{p.amount}</b></td></tr>;
          })}</tbody></table>
      </>}

      {tab === 'categories' && <>
        <form className="adm-bar" onSubmit={async e => {
          e.preventDefault(); const f = e.target;
          await act(() => api('/api/admin/categories', 'POST', { name: f.name.value })); f.reset();
        }}>
          <input name="name" placeholder="New category name" required />
          <button className="adm-btn">Add category</button>
          <SortBar opts={[['name', 'Category'], ['n', 'Items', c => d.items.filter(i => i.category_id === c.category_id).length]]} sort={sort} setSort={setSort} />
        </form>
        <table><thead><tr><th>Category</th><th>Items</th><th></th></tr></thead>
          <tbody>{sortRows(d.categories, sort, [['name', 'Category'], ['n', 'Items', c => d.items.filter(i => i.category_id === c.category_id).length]]).map(c => {
            const n = d.items.filter(i => i.category_id === c.category_id).length;
            return <tr key={c.category_id}><td>{c.name}</td><td>{n}</td>
              <td className="actions"><button className="sm danger" disabled={n > 0} title={n > 0 ? 'Has items' : ''}
                onClick={() => window.confirm(`Delete category "${c.name}"?`) &&
                  act(() => api(`/api/admin/categories/${c.category_id}`, 'DELETE'))}>Delete</button></td></tr>;
          })}</tbody></table>
      </>}
    </section>
    {view && (
      <div className="lightbox" onClick={() => setView(null)}>
        <button className="close" aria-label="Close" onClick={() => setView(null)}>✕</button>
        <div className="viewer" onClick={e => e.stopPropagation()}>
          {view.image ? <img src={view.image} alt={view.name} /> : <div className="ph big">📦</div>}
          <div className="vinfo">
            <h3>{view.name}</h3>
            <p>{view.category} · listed by {view.owner}</p>
            <p><b>₹{view.daily_rate}</b> / day · Deposit ₹{view.deposit} <span className={'tag ' + view.status}>{view.status}</span></p>
          </div>
        </div>
      </div>
    )}
  </div>);
}

/* ====================== MEMBER APP ====================== */
export default function App() {
  useKeyboardNavigation();
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('user') || 'null'));
  const [tab, setTab] = useState('items');
  const [d, setD] = useState({ items: [], members: [], rentals: [], payments: [], categories: [], stats: {} });
  const [err, setErr] = useState('');
  const [itemView, setItemView] = useState('mine');
  const [preview, setPreview] = useState(null);
  const [edit, setEdit] = useState(null);
  const [editR, setEditR] = useState(null);
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const logout = () => { localStorage.clear(); setUser(null); };

  const load = useCallback(async () => {
    try {
      const [items, members, rentals, payments, categories, stats] = await Promise.all(
        ['items', 'members', 'rentals', 'payments', 'categories', 'stats'].map(k => api('/api/' + k)));
      setD({ items, members, rentals, payments, categories, stats });
    } catch (e) { e.status === 401 ? logout() : setErr(e.message); }
  }, []);
  useEffect(() => { if (user && !user.admin) load(); }, [user, load]);
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && setPreview(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!user) return <Auth onAuth={setUser} />;
  if (user.admin) return <Admin />;

  const act = async (fn) => { setErr(''); try { await fn(); await load(); return true; } catch (e) { setErr(e.message); } };
  const submit = (fn, raw) => async (e) => {
    e.preventDefault(); const f = e.target;
    if (await act(() => fn(raw ? new FormData(f) : Object.fromEntries(new FormData(f))))) f.reset();
  };

  const myItems = d.items.filter(i => i.owner_id === user.id);
  const otherItems = d.items.filter(i => i.owner_id !== user.id);
  const shown = itemView === 'mine' ? myItems : otherItems;

  return (<>
    <header style={{ display: 'flex', justifyContent: 'space-between' }}>
      <h2 style={{ margin: 0 }}>Community Rental Management</h2>
      <span>{user.name} · <a href="#" style={{ color: '#fff' }} onClick={e => { e.preventDefault(); logout(); }}>Log out</a></span>
    </header>
    <main>
      <div className="cards">
        {[
          ['Members', d.stats.members],
          ['Items', d.stats.items],
          ['Active rentals', d.stats.active],
          ['Overdue', d.stats.overdue],
          ['Rent collected ₹', d.stats.revenue]
        ].map(([k, v]) => (
          <div className="card" key={k}><b>{v ?? 0}</b>{k}</div>
        ))}
      </div>
      <nav>{['items', 'rentals', 'payments', 'members'].map(t =>
        <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); setSort({ key: '', dir: 'asc' }); }}>{t.toUpperCase()}</button>)}</nav>
      {err && <p className="err">{err}</p>}

      {tab === 'members' && <>
        {(() => { const me = d.members.find(m => m.member_id === user.id) || {}; return (
          <div className="panel"><h3>My profile</h3>
            <form key={me.member_id + me.name + me.phone + me.upi_id} onSubmit={submit(async b => {
              const out = await api('/api/members/me', 'PUT', b);
              const u = { id: user.id, name: out.name }; localStorage.setItem('user', JSON.stringify(u)); setUser(u); })}>
              <input name="name" defaultValue={me.name} placeholder="Name" required />
              <input name="address" defaultValue={me.address} placeholder="Address" required />
              <input name="phone" defaultValue={me.phone} placeholder="Phone" required />
              <input name="upi_id" defaultValue={me.upi_id} placeholder="UPI ID (e.g. name@okaxis)" />
              <input name="password" type="password" placeholder="New password (optional)" />
              <button>Save profile</button>
              <button type="button" className="danger" onClick={() => window.confirm('Delete your account permanently?') &&
                act(async () => { await api('/api/members/me', 'DELETE'); logout(); })}>Delete account</button>
            </form></div>); })()}
            <SortBar opts={userMemberSort} sort={sort} setSort={setSort} />
        <table><thead><tr><th>ID</th><th>Name</th><th>Address</th><th>Phone</th></tr></thead>
          <tbody>{d.members.map(m => <tr key={m.member_id}><td>{m.member_id}</td><td>{m.name}</td><td>{m.address}</td><td>{m.phone}</td></tr>)}</tbody></table>
      </>}

      {tab === 'items' && <>
        <nav className="sub">
          <button className={itemView === 'mine' ? 'on' : ''} onClick={() => setItemView('mine')}>My items ({myItems.length})</button>
          <button className={itemView === 'others' ? 'on' : ''} onClick={() => setItemView('others')}>Other items ({otherItems.length})</button>
        </nav>
        {itemView === 'mine' && <div className="panel"><h3>{edit ? 'Edit item' : 'List an item'}</h3>
        <form key={edit ? edit.item_id : 'new'} onSubmit={submit(async b => {
          await (edit ? api(`/api/items/${edit.item_id}`, 'PUT', b) : api('/api/items', 'POST', b)); setEdit(null); }, true)}>
          <input name="name" defaultValue={edit?.name} placeholder="Item name" required />
          <select name="category_id" defaultValue={edit?.category_id} required>{d.categories.map(c => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</select>
          <input name="daily_rate" type="number" min="1" step="0.5" defaultValue={edit?.daily_rate} placeholder="₹ / day" required />
          <input name="deposit" type="number" min="0" defaultValue={edit?.deposit} placeholder="Deposit ₹" />
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" />
          <button>{edit ? 'Save changes' : 'List my item'}</button>
          {edit && <button type="button" className="ghost" onClick={() => setEdit(null)}>Cancel</button>}
        </form></div>}
        <SortBar opts={itemSort} sort={sort} setSort={setSort} />
        <div className="grid">{sortRows(shown, sort, itemSort).map(i => (
          <div className="gcard" key={i.item_id}>
            <div className="gimg" onClick={() => setPreview(i)}>
              {i.image ? <img src={i.image} alt={i.name} /> : <span className="ph">📦</span>}
              <span className={'tag ' + i.status}>{i.status}</span>
            </div>
            <div className="ginfo">
              <b>{i.name}</b>
              <small>{i.category} · {i.owner}</small>
              <span>₹{i.daily_rate}/day · Deposit ₹{i.deposit}</span>
              {i.owner_id === user.id && <div className="gactions">
                <button className="sm" onClick={() => { setEdit(i); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Edit</button>
                <button className="sm danger" onClick={() => window.confirm('Delete this item?') && act(() => api(`/api/items/${i.item_id}`, 'DELETE'))}>Delete</button>
              </div>}
            </div>
          </div>
        ))}</div>
        {shown.length === 0 && <p className="empty">{itemView === 'mine' ? 'You have not listed any items yet.' : 'No items from other members yet.'}</p>}
      </>}

      {tab === 'rentals' && <>
        <form onSubmit={submit(async b => {
          await api('/api/rentals', 'POST', b);
          if (b.payment_mode === 'upi' && d.items.find(i => i.item_id === Number(b.item_id))?.deposit > 0) setTab('payments');
        })}>
          <select name="item_id" required>{d.items.filter(i => i.status === 'available' && i.owner_id !== user.id)
            .map(i => <option key={i.item_id} value={i.item_id}>{i.name} (₹{i.daily_rate}/day, deposit ₹{i.deposit})</option>)}</select>
          <input name="due_date" type="date" required />
          <select name="payment_mode" required>{Object.entries(modeLabel).map(([k, v]) => <option key={k} value={k}>Pay by {v}</option>)}</select>
          <button>Rent item</button>
        </form>
        <SortBar opts={userRentalSort} sort={sort} setSort={setSort} />
        <table><thead><tr><th>Item</th><th>Renter</th><th>Start</th><th>Due</th><th>Returned</th><th>Rent</th><th></th></tr></thead>
          <tbody>{sortRows(d.rentals, sort, userRentalSort).map(r => <tr key={r.rental_id}><td>{r.item}</td><td>{r.renter}</td><td>{r.start_date}</td>
            <td>{editR?.id === r.rental_id
              ? <input type="date" value={editR.due} onChange={e => setEditR({ ...editR, due: e.target.value })} />
              : <>{r.due_date} {r.overdue ? <span className="tag overdue">overdue</span> : null}</>}</td>
            <td>{r.return_date || '—'}</td><td>{r.total_amount ?? '—'}</td>
            <td className="actions">{(r.renter_id === user.id || r.owner_id === user.id) && (editR?.id === r.rental_id ? <>
              <button className="sm" onClick={() => act(async () => { await api(`/api/rentals/${r.rental_id}`, 'PUT', { due_date: editR.due }); setEditR(null); })}>Save</button>
              <button className="sm ghost" onClick={() => setEditR(null)}>Cancel</button></> : <>
              {!r.return_date && <>
                <button className="sm" onClick={() => setEditR({ id: r.rental_id, due: r.due_date })}>Edit</button>
                <button className="sm" onClick={() => {
                  let damage = 0;
                  if (r.owner_id === user.id) {
                    const v = window.prompt('Damage charge ₹ (0 if none):', '0');
                    if (v === null) return;
                    damage = Number(v) || 0;
                  }
                  act(() => api(`/api/rentals/${r.rental_id}/return`, 'POST', { damage }));
                }}>Return</button></>}
              <button className="sm danger" onClick={() => window.confirm('Delete this rental and its payments?') && act(() => api(`/api/rentals/${r.rental_id}`, 'DELETE'))}>Delete</button></>)}</td>
          </tr>)}</tbody></table>
      </>}

      {tab === 'payments' && <>
        <SortBar opts={paymentSort} sort={sort} setSort={setSort} />
        <table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Mode</th><th>Details</th><th>Amount</th><th></th></tr></thead>
          <tbody>{sortRows(d.payments, sort, paymentSort).map(p => {
            const refund = p.type === 'refund';
            const payer = refund ? p.owner : p.renter;
            const receiver = refund ? p.renter : p.owner;
            const toUpi = refund ? p.renter_upi : p.owner_upi;
            const iPaid = (refund ? p.owner_id : p.renter_id) === user.id;
            return <tr key={p.payment_id}>
              <td>{p.paid_on}</td>
              <td>{p.item} <small>(rental #{p.rental_id})</small></td>
              <td><span className={'tag pay-' + p.type}>{typeLabel[p.type]}</span></td>
              <td><span className="tag mode">{modeLabel[p.mode]}</span></td>
              <td>{iPaid ? `You paid ${receiver}` : `${payer} paid you`}</td>
              <td className={iPaid ? 'out' : 'in'}>{iPaid ? '−' : '+'} ₹{p.amount}</td>
              <td className="actions">{p.mode === 'upi' && iPaid && (toUpi
                ? <>
                    <a className="btn" href={`gpay://upi/pay?${upiQuery(p, receiver, toUpi)}`}>Pay with Google Pay</a>
                    <a className="btn ghost" href={`upi://pay?${upiQuery(p, receiver, toUpi)}`}>Other UPI app</a>
                  </>
                : <small>{receiver} has not added a UPI ID</small>)}</td>
            </tr>;
          })}</tbody></table>
        <p className="hint">Google Pay buttons work on a phone with Google Pay installed. This app records payments but cannot confirm that the money was sent.</p>
      </>}
    </main>
    {preview && (
      <div className="lightbox" onClick={() => setPreview(null)}>
        <button className="close" onClick={() => setPreview(null)}>✕</button>
        <div className="viewer" onClick={e => e.stopPropagation()}>
          {preview.image ? <img src={preview.image} alt={preview.name} /> : <div className="ph big">📦</div>}
          <div className="vinfo">
            <h3>{preview.name}</h3>
            <p>{preview.category} · listed by {preview.owner}</p>
            <p><b>₹{preview.daily_rate}</b> / day · Deposit ₹{preview.deposit} <span className={'tag ' + preview.status}>{preview.status}</span></p>
          </div>
        </div>
      </div>
    )}
  </>);
}