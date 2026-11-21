import React, { useState, useMemo, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { apiRequest, apiTable, authSignIn, authRefresh, authLogout, updateAccount, TEST_PASSWORD, PREVIEW } from './api.js';
import { US_STATE_ABBRS, cityOption, filterCityOptions, loadUsCityOptions, normalizeCityQuery } from './usCities.js';
import {
  LayoutDashboard, Package, Users, Wallet, CalendarDays, Truck,
  Plus, Pencil, Trash2, X, Settings as SettingsIcon, Search, CornerDownRight,
  ChevronLeft, ChevronRight, Bell, Download, AlertTriangle, LogOut, ArrowRightLeft, Menu
} from 'lucide-react';

// Field-name mapping helpers between the JS (camelCase) Load shape used
// throughout the UI and the snake_case columns in the `loads` table.
function loadToDb(l) {
  return {
    load_number: l.loadNumber,
    is_partial: l.isPartial,
    parent_load_number: l.isPartial ? (l.parentLoadNumber || null) : null,
    driver_id: l.driverId || null,
    from_city: l.from || null,
    to_city: l.to || null,
    status: l.status,
    pickup_date: l.pickupDate || null,
    delivery_date: l.deliveryDate || null,
    total: l.total,
    assigned_to: l.assignedTo || null,
  };
}
function loadFromDb(r) {
  return {
    id: r.id,
    loadNumber: r.load_number,
    isPartial: r.is_partial,
    parentLoadNumber: r.parent_load_number || '',
    driverId: r.driver_id || '',
    from: r.from_city || '',
    to: r.to_city || '',
    status: r.status,
    pickupDate: r.pickup_date || '',
    deliveryDate: r.delivery_date || '',
    total: Number(r.total),
    assignedTo: r.assigned_to || '',
  };
}

// ---------------------------------------------------------------------------
// DATA SHAPES
// Load:   { id, loadNumber, isPartial, parentLoadNumber, driverId, from, to,
//           status: 'available' | 'pickedup' | 'delivered',
//           pickupDate, deliveryDate: 'YYYY-MM-DD', total }
// Driver: { id, firstName, lastName, truckNumber, type: 'company' | 'owner' }
// Settings: { fullPct, partialPct, dispatcherName } — fullPct/partialPct are
// the fixed dispatch fee % applied to every load company-wide (set on the
// Settings page), dispatcherName is shown in the sidebar.
// All three live as state in DispatchCRM. Dashboard filters loads by
// pickupDate for the selected period, and treats a load as "Order" (full)
// when isPartial is false, or "Partial" when isPartial is true.
// ---------------------------------------------------------------------------

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'loads', label: 'Loads', icon: Package },
  { id: 'drivers', label: 'Drivers', icon: Users },
  { id: 'salary', label: 'Salary', icon: Wallet },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'employees', label: 'Employees', icon: Users },
];

const periodOptions = [
  { id: 'allTime', label: 'All time' },
  { id: 'thisWeek', label: 'This week' },
  { id: 'thisMonth', label: 'This month' },
  { id: 'lastWeek', label: 'Last week' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

// ---------------------------------------------------------------------------
// DATE HELPERS
// ---------------------------------------------------------------------------

function pad2(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function startOfWeek(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Monday = 0
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}
function endOfWeek(d) {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  e.setHours(23, 59, 59, 999);
  return e;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d) {
  const e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  e.setHours(23, 59, 59, 999);
  return e;
}
function fmtLabel(d) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getPeriodRange(type, customStart, customEnd) {
  const now = new Date();
  switch (type) {
    case 'allTime':
      return { start: new Date(2000, 0, 1), end: new Date(2100, 0, 1) };
    case 'thisWeek':
      return { start: startOfWeek(now), end: endOfWeek(now) };
    case 'thisMonth':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'lastWeek': {
      const ref = new Date(now); ref.setDate(ref.getDate() - 7);
      return { start: startOfWeek(ref), end: endOfWeek(ref) };
    }
    case 'lastMonth': {
      const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { start: startOfMonth(ref), end: endOfMonth(ref) };
    }
    case 'custom': {
      if (!customStart || !customEnd) return { start: startOfWeek(now), end: endOfWeek(now) };
      const s = new Date(customStart); s.setHours(0, 0, 0, 0);
      const e = new Date(customEnd); e.setHours(23, 59, 59, 999);
      return { start: s, end: e };
    }
    default:
      return { start: startOfWeek(now), end: endOfWeek(now) };
  }
}

const currency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);

// ---------------------------------------------------------------------------
// UI PRIMITIVES
// ---------------------------------------------------------------------------

function Sidebar({ active, onSelect, dispatcherName, avatarUrl, role, onLogout, open, onClose }) {
  const initials = dispatcherName
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
    <div className={`sidebar-backdrop ${open ? 'sidebar-backdrop--open' : ''}`} onClick={onClose} aria-hidden="true" />
    <aside className={`sidebar ${open ? 'sidebar--open' : ''}`} id="app-sidebar">
      <div className="brand">
        <Truck size={20} strokeWidth={2.2} />
        <span>SDS UZ INC</span>
        <button className="sidebar-close" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
      </div>
      <nav>
        {navItems.filter((item) => role === 'admin' || item.id !== 'employees').map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <React.Fragment key={item.id}>
              {item.id === 'settings' && <div className="nav-divider" />}
              <button
                className={`nav-item ${isActive ? 'nav-item--active' : ''}`}
                onClick={() => { onSelect(item.id); onClose(); }}
              >
                <Icon size={17} strokeWidth={2} />
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        {avatarUrl
          ? <img src={avatarUrl} alt="" className="dispatcher-avatar" />
          : <div className="dispatcher-badge">{initials}</div>}
        <div className="sidebar-footer-info">
          <div className="dispatcher-name">{dispatcherName}</div>
          <div className="dispatcher-role">{role === 'admin' ? 'Administrator' : 'Dispatcher'}</div>
        </div>
        <button className="logout-btn" onClick={onLogout} title="Log out">
          <LogOut size={15} />
        </button>
      </div>
    </aside>
    </>
  );
}

function Placeholder({ label }) {
  return (
    <div className="placeholder">
      <div className="placeholder-inner">
        <h2>{label}</h2>
        <p>This section is coming up next.</p>
      </div>
    </div>
  );
}

function PeriodSelector({ period, setPeriod, customStart, setCustomStart, customEnd, setCustomEnd, rangeLabel }) {
  return (
    <div className="period-selector">
      {period === 'custom' && (
        <div className="custom-range">
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          <span className="custom-range-sep">to</span>
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
        </div>
      )}
      {period !== 'custom' && <div className="range-label">{rangeLabel}</div>}
      <select
        className="period-select"
        value={period}
        onChange={(e) => setPeriod(e.target.value)}
      >
        {periodOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DASHBOARD PAGE
// ---------------------------------------------------------------------------

// Fee % for a dispatcher: their own value if the admin set one, else the company-wide %.
function dispatcherPct(employees, userId, settings) {
  const p = (employees || []).find((e) => e.user_id === userId);
  const own = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  return {
    full: own(p?.full_pct) ?? settings.fullPct,
    partial: own(p?.partial_pct) ?? settings.partialPct,
  };
}

function Dashboard({ loads, drivers, settings, role, employees }) {
  const [period, setPeriod] = useState('thisMonth');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [driverFilter, setDriverFilter] = useState('all');
  const [dispatcherFilter, setDispatcherFilter] = useState('all');

  const { start, end } = useMemo(
    () => getPeriodRange(period, customStart, customEnd),
    [period, customStart, customEnd]
  );

  const rangeLabel = period === 'allTime' ? 'All time' : `${fmtLabel(start)} – ${fmtLabel(end)}`;

  const driverById = useMemo(() => {
    const map = {};
    drivers.forEach((d) => { map[d.id] = d; });
    return map;
  }, [drivers]);

  // Dispatchers only receive their own drivers, so their dashboard counts only
  // loads on their own trucks (shared-pool loads on other trucks are left out).
  const isAdmin = role === 'admin';
  // Admin-only dispatcher filter: a load belongs to its assigned dispatcher,
  // falling back to the dispatcher of its truck (same rule as the fee calculation).
  const loadDispatcherId = (l) => l.assignedTo || driverById[l.driverId]?.dispatcherId || '';
  const scopedLoads = useMemo(() => {
    if (!isAdmin) return loads.filter((l) => driverById[l.driverId]);
    if (dispatcherFilter === 'all') return loads;
    return loads.filter((l) => {
      const id = loadDispatcherId(l);
      return dispatcherFilter === 'none' ? !id : id === dispatcherFilter;
    });
  }, [loads, driverById, isAdmin, dispatcherFilter]);
  const visibleDrivers = useMemo(
    () => (isAdmin ? drivers.filter((d) => matchesDispatcher(d, dispatcherFilter)) : drivers),
    [drivers, isAdmin, dispatcherFilter]
  );

  const periodLoads = useMemo(() => {
    return scopedLoads.filter((l) => {
      const d = new Date(l.pickupDate);
      const inRange = d >= start && d <= end;
      const matchesDriver = driverFilter === 'all' || l.driverId === driverFilter;
      return inRange && matchesDriver;
    });
  }, [scopedLoads, start, end, driverFilter]);

  const stats = useMemo(() => {
    let gross = 0, partial = 0;
    periodLoads.forEach((l) => {
      if (!l.isPartial) gross += l.total;
      else partial += l.total;
    });
    const monthlyGross = gross + partial;
    // Each load's fee uses its dispatcher's own % (set by the admin on Employees),
    // falling back to the company-wide % from Settings.
    let fullFee = 0, partialFee = 0;
    periodLoads.forEach((l) => {
      const pct = dispatcherPct(employees, l.assignedTo || driverById[l.driverId]?.dispatcherId, settings);
      if (!l.isPartial) fullFee += l.total * (pct.full / 100);
      else partialFee += l.total * (pct.partial / 100);
    });
    const totalEarnings = fullFee + partialFee;
    return { monthlyGross, gross, partial, fullFee, partialFee, totalEarnings };
  }, [periodLoads, settings, employees, driverById]);

  const counts = useMemo(() => {
    let fullCount = 0, partialCount = 0;
    periodLoads.forEach((l) => {
      if (!l.isPartial) fullCount += 1;
      else partialCount += 1;
    });
    return { fullCount, partialCount };
  }, [periodLoads]);

  const topDrivers = useMemo(() => {
    const totals = {};
    periodLoads.forEach((l) => {
      totals[l.driverId] = (totals[l.driverId] || 0) + l.total;
    });
    return Object.entries(totals)
      .map(([driverId, total]) => {
        const d = driverById[driverId];
        return { name: d ? `${d.firstName} ${d.lastName}` : 'Unknown', total };
      })
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [periodLoads, driverById]);

  // Per-truck summary for the selected period, plus the truck's current open load.
  const truckRows = useMemo(() => {
    return visibleDrivers
      .filter((d) => driverFilter === 'all' || d.id === driverFilter)
      .map((d) => {
        const inPeriod = periodLoads.filter((l) => l.driverId === d.id);
        const open = scopedLoads
          .filter((l) => l.driverId === d.id && l.status !== 'delivered')
          .sort((a, b) => (b.pickupDate || '').localeCompare(a.pickupDate || ''))[0];
        return { driver: d, count: inPeriod.length, gross: inPeriod.reduce((sum, l) => sum + l.total, 0), open };
      })
      .sort((a, b) => b.gross - a.gross || (a.driver.truckNumber || '').localeCompare(b.driver.truckNumber || ''));
  }, [visibleDrivers, driverFilter, periodLoads, scopedLoads]);

  const driverFilterLabel = driverFilter === 'all' ? 'All drivers' : (() => {
    const d = driverById[driverFilter];
    return d ? `${d.firstName} ${d.lastName}` : 'All drivers';
  })();
  const dispatcherFilterLabel = dispatcherFilter === 'all' ? 'All dispatchers'
    : dispatcherFilter === 'none' ? 'Not assigned'
    : (staffName(employees, dispatcherFilter) || 'All dispatchers');

  const handleExportPdf = () => {
    const rows = [
      ['Monthly Gross', currency(stats.monthlyGross)],
      ['Order', `${currency(stats.gross)} (fee ${currency(stats.fullFee)})`],
      ['Partial', `${currency(stats.partial)} (fee ${currency(stats.partialFee)})`],
      ['Total Earnings', currency(stats.totalEarnings)],
      ['Full loads', String(counts.fullCount)],
      ['Partial loads', String(counts.partialCount)],
    ];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dashboard Report</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 48px; max-width: 640px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 6px 0; }
  .meta { font-size: 12px; color: #555; margin-bottom: 28px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 11px 0; border-bottom: 1px solid #ddd; font-size: 14px; }
  td:last-child { text-align: right; font-weight: 600; }
  @media print { body { padding: 24px; } }
</style></head><body>
<h1>SDS UZ INC — Dashboard Report</h1>
<div class="meta">Period: ${rangeLabel}${isAdmin ? ` &middot; Dispatcher: ${dispatcherFilterLabel}` : ''} &middot; Driver: ${driverFilterLabel} &middot; Generated ${new Date().toLocaleString('en-US')}</div>
<table>${rows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join('')}</table>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dashboard-report-${isoDate(new Date())}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Display-only helpers for the layout below (no effect on the numbers).
  const fullShare = stats.monthlyGross > 0 ? (stats.gross / stats.monthlyGross) * 100 : 0;
  const onLoadCount = truckRows.filter((r) => r.open).length;
  const pickedUpCount = truckRows.filter((r) => r.open?.status === 'pickedup').length;
  const freeCount = truckRows.length - onLoadCount;
  const topMax = topDrivers.length ? topDrivers[0].total : 0;

  return (
    <div className="page dash">
      <header className="dash-head">
        <div className="dash-title">
          <h1>Dashboard</h1>
          <p className="dash-range">{rangeLabel}</p>
        </div>
        <button className="btn-ghost dashboard-pdf-btn" onClick={handleExportPdf}>
          <Download size={14} /> Export PDF
        </button>
      </header>

      <div className="dash-filters">
        <PeriodSelector
          period={period}
          setPeriod={setPeriod}
          customStart={customStart}
          setCustomStart={setCustomStart}
          customEnd={customEnd}
          setCustomEnd={setCustomEnd}
          rangeLabel={rangeLabel}
        />
        {isAdmin && (
          <DispatcherFilter
            employees={employees || []}
            value={dispatcherFilter}
            onChange={(v) => { setDispatcherFilter(v); setDriverFilter('all'); }}
          />
        )}
        <select className="period-select" value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
          <option value="all">{isAdmin ? 'All drivers' : 'All my trucks'}</option>
          {visibleDrivers.map((d) => (
            <option key={d.id} value={d.id}>{d.truckNumber ? `${d.truckNumber} — ` : ''}{d.firstName} {d.lastName}</option>
          ))}
        </select>
      </div>

      <section className="ledger" aria-label="Gross and earnings for the selected period">
        <div className="ledger-top">
          <div>
            <div className="ledger-label">Monthly gross</div>
            <div className="ledger-gross">{currency(stats.monthlyGross)}</div>
          </div>
          <div className="ledger-earn">
            <div className="ledger-label">Total earnings</div>
            <div className="ledger-earn-value">{currency(stats.totalEarnings)}</div>
          </div>
        </div>

        <div className="ledger-bar" role="img" aria-label={`Full loads ${Math.round(fullShare)}% of gross, partial ${Math.round(100 - fullShare)}%`}>
          {stats.monthlyGross > 0 ? (
            <>
              <span className="ledger-bar-full" style={{ width: `${fullShare}%` }} />
              <span className="ledger-bar-partial" style={{ width: `${100 - fullShare}%` }} />
            </>
          ) : <span className="ledger-bar-empty" />}
        </div>

        <div className="ledger-split">
          <div className="ledger-part">
            <div className="ledger-part-name"><i className="swatch swatch--full" />Order <span>{counts.fullCount} loads</span></div>
            <div className="ledger-part-value">{currency(stats.gross)}</div>
            <div className="ledger-part-fee">Fee {currency(stats.fullFee)}</div>
          </div>
          <div className="ledger-part">
            <div className="ledger-part-name"><i className="swatch swatch--partial" />Partial <span>{counts.partialCount} loads</span></div>
            <div className="ledger-part-value">{currency(stats.partial)}</div>
            <div className="ledger-part-fee">Fee {currency(stats.partialFee)}</div>
          </div>
        </div>
      </section>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-header">
            <h3>Driver performance</h3>
            <span className="panel-subtitle">Top 5 by gross</span>
          </div>
          {topDrivers.length > 0 ? (
            <ol className="rank">
              {topDrivers.map((d) => (
                <li key={d.name} className="rank-row">
                  <span className="rank-name">{d.name}</span>
                  <span className="rank-track"><span className="rank-fill" style={{ width: `${topMax ? (d.total / topMax) * 100 : 0}%` }} /></span>
                  <span className="rank-value">{currency(d.total)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-chart">No loads booked in this period.</div>
          )}
        </section>

        <section className="panel fleet">
          <div className="panel-header">
            <h3>{isAdmin ? 'Fleet right now' : 'My trucks right now'}</h3>
          </div>
          <div className="fleet-total">{truckRows.length}<span>{truckRows.length === 1 ? 'truck' : 'trucks'}</span></div>
          <div className="fleet-bar" aria-hidden="true">
            {truckRows.map(({ driver, open }) => (
              <span key={driver.id} className={`fleet-cell ${open ? `fleet-cell--${open.status}` : ''}`} />
            ))}
          </div>
          <ul className="fleet-legend">
            <li><i className="dot dot--pickedup" />Picked up<b>{pickedUpCount}</b></li>
            <li><i className="dot dot--available" />Booked, not picked up<b>{onLoadCount - pickedUpCount}</b></li>
            <li><i className="dot" />Free<b>{freeCount}</b></li>
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3>{isAdmin ? 'Trucks' : 'My trucks'}</h3>
          <span className="panel-subtitle">Loads and gross for the selected period</span>
        </div>
        {truckRows.length === 0 ? (
          <div className="empty-chart">{isAdmin ? 'No drivers yet. Add them on the Drivers page.' : 'No trucks are assigned to you yet. Ask the administrator to assign your drivers.'}</div>
        ) : (
          <div className="trucks-table">
            <div className={`trucks-row trucks-row--head ${isAdmin ? 'trucks-row--admin' : ''}`}>
              <span>Truck</span><span>Driver</span><span>Type</span>
              {isAdmin && <span>Dispatcher</span>}
              <span>Current load</span><span className="num">Loads</span><span className="num">Gross</span>
            </div>
            {truckRows.map(({ driver, count, gross, open }) => (
              <div className={`trucks-row ${isAdmin ? 'trucks-row--admin' : ''}`} key={driver.id}>
                <span><span className="trucks-truck">{driver.truckNumber || '—'}</span></span>
                <span>{driver.firstName} {driver.lastName}</span>
                <span className="trucks-muted">{driver.type === 'owner' ? 'Owner operator' : 'Company driver'}</span>
                {isAdmin && <span className="trucks-muted">{staffName(employees, driver.dispatcherId) || 'No dispatcher'}</span>}
                <span>{open
                  ? <span className={`truck-status truck-status--${open.status}`}><i className={`dot dot--${open.status}`} />{open.loadNumber}<em>{statusLabel(open.status)}</em></span>
                  : <span className="trucks-muted">Free</span>}</span>
                <span className="num">{count}</span>
                <span className="num trucks-gross">{currency(gross)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DRIVERS PAGE
// ---------------------------------------------------------------------------

const emptyDriverForm = {
  firstName: '', lastName: '', truckNumber: '', type: 'company', dispatcherId: '',
};

function driverFromDb(r) {
  return { id: r.id, firstName: r.first_name, lastName: r.last_name, truckNumber: r.truck_number, type: r.type, dispatcherId: r.dispatcher_id || '' };
}

const activeDispatchers = (employees) => employees.filter((e) => e.role === 'dispatcher' && e.is_active);
const staffName = (employees, id) => {
  const person = employees.find((e) => e.user_id === id);
  return person ? (person.full_name || person.email) : '';
};

// Admin-only filter: narrows driver-based pages to one dispatcher's trucks.
function DispatcherFilter({ employees, value, onChange }) {
  return (
    <select className="period-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All dispatchers</option>
      <option value="none">Not assigned</option>
      {activeDispatchers(employees).map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>)}
    </select>
  );
}
const matchesDispatcher = (driver, filter) =>
  filter === 'all' || (filter === 'none' ? !driver.dispatcherId : driver.dispatcherId === filter);

function DriverModal({ initial, role, employees, onCancel, onSave }) {
  const [form, setForm] = useState(initial || emptyDriverForm);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const canSave = form.firstName.trim() && form.lastName.trim();

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{initial ? 'Edit Driver' : 'Add Driver'}</h3>
          <button className="icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>First Name</label>
            <input value={form.firstName} onChange={update('firstName')} placeholder="John" />
          </div>
          <div className="field-row">
            <label>Last Name</label>
            <input value={form.lastName} onChange={update('lastName')} placeholder="Carter" />
          </div>
          <div className="field-row">
            <label>Truck Number</label>
            <input value={form.truckNumber} onChange={update('truckNumber')} placeholder="T-102" />
          </div>
          <div className="field-row">
            <label>Type</label>
            <select value={form.type} onChange={update('type')}>
              <option value="company">Company Driver</option>
              <option value="owner">Owner Operator</option>
            </select>
          </div>
          <div className="field-row">
            <label>Dispatcher</label>
            {role === 'admin' ? <select value={form.dispatcherId || ''} onChange={update('dispatcherId')}>
              <option value="">Not assigned</option>
              {activeDispatchers(employees).map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>)}
            </select> : <div className="truck-readonly">Assigned to you</div>}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!canSave}
            onClick={() => onSave(form)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Drivers({ drivers, setDrivers, logActivity, accessToken, role, userId, employees }) {
  const [dispatcherFilter, setDispatcherFilter] = useState('all');
  const visibleDrivers = drivers.filter((d) => matchesDispatcher(d, dispatcherFilter));
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [saveError, setSaveError] = useState('');

  const editingDriver = drivers.find((d) => d.id === editingId) || null;

  const openAdd = () => { setEditingId(null); setModalOpen(true); setSaveError(''); };
  const openEdit = (id) => { setEditingId(id); setModalOpen(true); setConfirmDeleteId(null); setSaveError(''); };
  const closeModal = () => setModalOpen(false);

  const table = apiTable('drivers', accessToken);

  const saveDriver = async (form) => {
    const row = {
      first_name: form.firstName, last_name: form.lastName, truck_number: form.truckNumber, type: form.type,
      dispatcher_id: role === 'admin' ? (form.dispatcherId || null) : userId,
    };
    try {
      if (editingId) {
        const [updated] = await table.update(editingId, row);
        if (!updated) throw new Error('This driver is no longer available.');
        setDrivers(drivers.map((d) => (d.id === editingId ? driverFromDb(updated) : d)));
        logActivity(`Edited driver ${form.firstName} ${form.lastName}`);
      } else {
        const [created] = await table.insert(row);
        setDrivers([...drivers, driverFromDb(created)]);
        logActivity(`Added driver ${form.firstName} ${form.lastName}`);
      }
      setModalOpen(false);
    } catch (e) {
      setSaveError(e.message || 'Could not save driver.');
    }
  };

  const deleteDriver = async (id) => {
    const d = drivers.find((x) => x.id === id);
    try {
      await table.remove(id);
      setDrivers(drivers.filter((x) => x.id !== id));
      if (d) logActivity(`Deleted driver ${d.firstName} ${d.lastName}`);
    } catch (e) {
      setSaveError(e.message || 'Could not delete driver.');
    }
    setConfirmDeleteId(null);
  };

  const typeLabel = (t) => (t === 'owner' ? 'Owner Operator' : 'Company Driver');

  const exportExcel = () => {
    const header = ['Truck #', 'First Name', 'Last Name', 'Type', 'Dispatcher'];
    const rows = visibleDrivers.map((d) => [d.truckNumber || '', d.firstName, d.lastName, typeLabel(d.type), staffName(employees, d.dispatcherId)]);
    const ws = safeSheet([header, ...rows]);
    ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Drivers');
    XLSX.writeFile(wb, `drivers-${isoDate(new Date())}.xlsx`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Drivers</h1>
          <p className="subtitle">{role === 'admin' ? 'All drivers and their dispatchers' : 'Your drivers'}</p>
        </div>
        <div className="loads-header-actions">
          {role === 'admin' && <DispatcherFilter employees={employees} value={dispatcherFilter} onChange={setDispatcherFilter} />}
          <button className="btn-ghost" onClick={exportExcel}><Download size={14} /> Excel</button>
          <button className="btn-primary" onClick={openAdd}><Plus size={15} /> Add Driver</button>
        </div>
      </header>

      {saveError && <div className="overdue-banner"><AlertTriangle size={14} /> {saveError}</div>}

      {visibleDrivers.length === 0 ? (
        <div className="empty-state">{drivers.length === 0 ? 'No drivers yet. Add your first driver to get started.' : 'No drivers for this dispatcher.'}</div>
      ) : (
        <div className="driver-plain-list">
          {visibleDrivers.map((d) => (
            <div className="driver-plain-row" key={d.id}>
              <div className="driver-plain-info">
                <span className="driver-plain-name">{d.truckNumber ? `${d.truckNumber} · ` : ''}{d.firstName} {d.lastName}</span>
                <span className="driver-plain-type">{typeLabel(d.type)}{role === 'admin' && ` · ${staffName(employees, d.dispatcherId) || 'No dispatcher'}`}</span>
              </div>

              {confirmDeleteId === d.id ? (
                <div className="confirm-row">
                  <span>Delete this driver?</span>
                  <button className="btn-ghost-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  <button className="btn-danger-sm" onClick={() => deleteDriver(d.id)}>Delete</button>
                </div>
              ) : (
                <div className="driver-plain-actions">
                  <button className="icon-btn" onClick={() => openEdit(d.id)}><Pencil size={14} /></button>
                  <button className="icon-btn" onClick={() => setConfirmDeleteId(d.id)}><Trash2 size={14} /></button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <DriverModal
          initial={editingDriver}
          role={role}
          employees={employees}
          onCancel={closeModal}
          onSave={saveDriver}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOADS PAGE
// ---------------------------------------------------------------------------

const statusOptions = [
  { id: 'available', label: 'Available' },
  { id: 'pickedup', label: 'Picked Up' },
  { id: 'delivered', label: 'Delivered' },
];
const statusLabel = (s) => statusOptions.find((o) => o.id === s)?.label || s;

function fmtDateInput(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
}

function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" className="toggle-row" onClick={() => onChange(!checked)}>
      <span className={`toggle-track ${checked ? 'toggle-track--on' : ''}`}>
        <span className="toggle-thumb" />
      </span>
      <span>{label}</span>
    </button>
  );
}


// Excel runs text that starts with = + - @ (or a tab / CR) as a formula. Names, cities and
// load numbers are typed by users, so prefix such text with ' to keep it plain text.
function safeSheet(rows) {
  const clean = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
  return XLSX.utils.aoa_to_sheet(rows.map((row) => row.map(clean)));
}

// ---------------------------------------------------------------------------
// COMBOBOX — shared search-or-pick control (drivers, parent loads, cities)
// ---------------------------------------------------------------------------

function Combobox({ options, value, onSelect, placeholder, emptyMessage, extraOption, filter }) {
  const selected = options.find((o) => o.value === value);
  const [query, setQuery] = useState(selected ? selected.display : '');
  const [open, setOpen] = useState(false);

  const q = query.trim().toLowerCase();
  const filtered = filter
    ? filter(options, query)
    : (q ? options.filter((o) => o.searchText.includes(q)) : options).slice(0, 8);
  const rows = extraOption ? [...filtered, extraOption] : filtered;

  const handleSelect = (opt) => {
    onSelect(opt.value);
    setQuery(opt.display);
    setOpen(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      setOpen(false);
      const match = options.find((o) => o.value === value);
      setQuery(match ? match.display : '');
    }, 120);
  };

  return (
    <div className="combobox">
      <input
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onBlur={handleBlur}
      />
      {open && (
        <div className="combobox-list">
          {filtered.length === 0 && <div className="combobox-empty">{emptyMessage || 'No matches'}</div>}
          {rows.map((o) => (
            <div
              key={o.value}
              className={`combobox-option ${o.isAction ? 'combobox-option--action' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(o); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CityField({ value, onChange, placeholder, customCities, onAddCustomCity }) {
  const [adding, setAdding] = useState(false);
  const [newCity, setNewCity] = useState('');
  const [newState, setNewState] = useState('');
  const [newZip, setNewZip] = useState('');
  const [addError, setAddError] = useState('');

  const [usOptions, setUsOptions] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadUsCityOptions()
      .then((opts) => { if (alive) setUsOptions(opts); })
      .catch(() => { if (alive) { setLoadFailed(true); setUsOptions([]); } });
    return () => { alive = false; };
  }, []);

  const { options, selectedValue } = useMemo(() => {
    if (!usOptions) return { options: null, selectedValue: value };
    const merged = [...usOptions];
    const index = new Map(merged.map((o, i) => [o.value, i]));
    // Custom cities add their ZIP to a known city, or become a new entry.
    const custom = [];
    for (const c of customCities || []) {
      const i = index.get(`${c.city}, ${c.state}`);
      if (i === undefined) custom.push(cityOption(c.city, c.state, c.zip ? [c.zip] : []));
      else if (c.zip && !merged[i].zips.includes(c.zip)) merged[i] = { ...merged[i], zips: [...merged[i].zips, c.zip] };
    }
    const all = [...custom, ...merged];
    if (!value || all.some((o) => o.value === value)) return { options: all, selectedValue: value };
    // A saved value from the old hand-made list: show it under today's spelling
    // ("St. Louis, MO" -> "Saint Louis, MO"), or as is if the city is not listed.
    const key = normalizeCityQuery(value);
    const same = all.find((o) => o.searchText === key);
    if (same) return { options: all, selectedValue: same.value };
    const comma = value.lastIndexOf(',');
    const legacy = comma < 0 ? cityOption(value, '', []) : cityOption(value.slice(0, comma).trim(), value.slice(comma + 1).trim(), []);
    return { options: [legacy, ...all], selectedValue: legacy.value };
  }, [usOptions, customCities, value]);

  const handleSelect = (val) => {
    if (val === '__add__') {
      setNewCity(''); setNewState(''); setNewZip(''); setAddError('');
      setAdding(true);
      return;
    }
    onChange(val);
  };

  const saveNewCity = async () => {
    if (!newCity.trim() || !newState) {
      setAddError('City and state are required.');
      return;
    }
    if (!/^\d{5}$/.test(newZip.trim())) {
      setAddError('ZIP must be 5 digits.');
      return;
    }
    const entry = { city: newCity.trim(), state: newState, zip: newZip.trim() };
    try {
      await onAddCustomCity(entry);
      onChange(`${entry.city}, ${entry.state}`);
      setAdding(false);
    } catch (e) {
      setAddError(e.message || 'Could not save city.');
    }
  };

  if (adding) {
    return (
      <div className="city-add-form">
        <input placeholder="City" value={newCity} onChange={(e) => setNewCity(e.target.value)} />
        <select value={newState} onChange={(e) => setNewState(e.target.value)}>
          <option value="">State…</option>
          {US_STATE_ABBRS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input placeholder="ZIP" value={newZip} onChange={(e) => setNewZip(e.target.value)} maxLength={5} />
        {addError && <span className="field-error">{addError}</span>}
        <div className="city-add-actions">
          <button type="button" className="btn-ghost-sm" onClick={() => setAdding(false)}>Cancel</button>
          <button type="button" className="btn-primary-sm" onClick={saveNewCity}>Add city</button>
        </div>
      </div>
    );
  }

  // The Combobox reads the selected label once on mount, so wait for the list.
  if (!options) return <input disabled placeholder="Loading US cities…" />;

  return (
    <Combobox
      options={options}
      value={selectedValue}
      onSelect={handleSelect}
      placeholder={placeholder}
      filter={filterCityOptions}
      emptyMessage={loadFailed ? 'City list failed to load — refresh the page or add the city' : 'No matching US city or ZIP'}
      extraOption={{ value: '__add__', label: '+ Add a new city…', display: '', isAction: true }}
    />
  );
}

const emptyLoadForm = {
  loadNumber: '', isPartial: false, parentLoadNumber: '', driverId: '',
  from: '', to: '', status: 'available', pickupDate: '', deliveryDate: '', total: '', assignedTo: '',
};

function LoadModal({ initial, drivers, loads, customCities, employees, role, userId, onAddCustomCity, onCancel, onSave }) {
  const [form, setForm] = useState(initial || { ...emptyLoadForm, assignedTo: role === 'dispatcher' ? userId : '' });
  const [error, setError] = useState('');

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const fullLoadOptions = loads.filter((l) => !l.isPartial && l.id !== (initial && initial.id));

  const canSave = form.loadNumber.trim() && form.driverId && form.total !== '' &&
    (!form.isPartial || form.parentLoadNumber);

  // Dispatchers cannot backdate delivery. An existing past date may stay as is
  // when editing other fields; only a new or changed date must be today or later.
  const todayIso = isoDate(new Date());
  const blockBackdating = role !== 'admin';
  const deliveryChanged = !!form.deliveryDate && form.deliveryDate !== (initial?.deliveryDate || '');
  const deliveryMin = [blockBackdating && deliveryChanged ? todayIso : '', form.pickupDate || '']
    .filter(Boolean).sort().pop() || undefined;

  const handleSave = () => {
    const trimmedNumber = form.loadNumber.trim();
    const duplicate = loads.some(
      (l) => l.id !== (initial && initial.id) && l.loadNumber.toLowerCase() === trimmedNumber.toLowerCase()
    );
    if (duplicate) {
      setError('This load number already exists.');
      return;
    }
    if (form.deliveryDate && form.pickupDate && form.deliveryDate < form.pickupDate) {
      setError('Delivery date cannot be earlier than pickup date.');
      return;
    }
    if (blockBackdating && deliveryChanged && form.deliveryDate < todayIso) {
      setError('Delivery date cannot be in the past.');
      return;
    }
    onSave({
      ...form,
      loadNumber: trimmedNumber,
      total: parseFloat(form.total) || 0,
      parentLoadNumber: form.isPartial ? form.parentLoadNumber : '',
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{initial ? 'Edit Load' : 'Add Load'}</h3>
          <button className="icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div className="field-row">
            <label>Load #</label>
            <input
              value={form.loadNumber}
              onChange={(e) => { setError(''); setForm({ ...form, loadNumber: e.target.value }); }}
              placeholder="L-1001"
            />
            {error && <span className="field-error">{error}</span>}
          </div>

          <Toggle
            checked={form.isPartial}
            onChange={(val) => setForm({
              ...form,
              isPartial: val,
              parentLoadNumber: val ? form.parentLoadNumber : '',
              driverId: val ? '' : form.driverId,
            })}
            label="Partial load"
          />

          {form.isPartial && (
            <div className="field-row">
              <label>Parent Load #</label>
              <Combobox
                options={fullLoadOptions.map((l) => ({
                  value: l.loadNumber, label: l.loadNumber, display: l.loadNumber,
                  searchText: l.loadNumber.toLowerCase(),
                }))}
                value={form.parentLoadNumber}
                onSelect={(val) => {
                  const parent = fullLoadOptions.find((l) => l.loadNumber === val);
                  setForm({ ...form, parentLoadNumber: val, driverId: parent ? parent.driverId : form.driverId });
                }}
                placeholder="Search or pick load #…"
                emptyMessage="No full loads yet — add a full load first"
              />
              <span className="field-hint">Truck # is inherited from the parent load — a partial can't ride a different truck.</span>
            </div>
          )}

          {form.isPartial ? (
            <div className="field-row">
              <label>Truck #</label>
              <div className="truck-readonly">
                {form.driverId
                  ? (() => {
                      const d = drivers.find((x) => x.id === form.driverId);
                      return d ? `${d.truckNumber || '—'} — ${d.firstName} ${d.lastName}` : '—';
                    })()
                  : 'Select a parent load first'}
              </div>
            </div>
          ) : (
            <div className="field-row">
              <label>Truck #</label>
              <Combobox
                options={drivers.filter((d) => role !== 'admin' || !form.assignedTo || !d.dispatcherId || d.dispatcherId === form.assignedTo).map((d) => ({
                  value: d.id,
                  label: `${d.truckNumber || '—'} — ${d.firstName} ${d.lastName}`,
                  display: `${d.truckNumber || '—'} — ${d.firstName} ${d.lastName}`,
                  searchText: `${d.truckNumber} ${d.firstName} ${d.lastName}`.toLowerCase(),
                }))}
                value={form.driverId}
                onSelect={(val) => {
                  const picked = drivers.find((d) => d.id === val);
                  // Admin: picking a driver also hands the load to that driver's dispatcher.
                  setForm({ ...form, driverId: val, ...(role === 'admin' && picked?.dispatcherId ? { assignedTo: picked.dispatcherId } : {}) });
                }}
                placeholder="Search truck # or driver name…"
                emptyMessage="No drivers yet — add a driver first"
              />
            </div>
          )}

          <div className="field-row">
            <label>From</label>
            <CityField
              value={form.from}
              onChange={(val) => setForm({ ...form, from: val })}
              placeholder="City or ZIP…"
              customCities={customCities}
              onAddCustomCity={onAddCustomCity}
            />
          </div>
          <div className="field-row">
            <label>To</label>
            <CityField
              value={form.to}
              onChange={(val) => setForm({ ...form, to: val })}
              placeholder="City or ZIP…"
              customCities={customCities}
              onAddCustomCity={onAddCustomCity}
            />
          </div>

          <div className="field-row">
            <label>Pickup Date</label>
            <input type="date" value={form.pickupDate} onChange={update('pickupDate')} />
          </div>
          <div className="field-row">
            <label>Delivery Date</label>
            <input type="date" value={form.deliveryDate} min={deliveryMin} onChange={update('deliveryDate')} />
            {blockBackdating && <span className="field-hint">Past dates are not allowed.</span>}
          </div>

          <div className="field-row">
            <label>Total</label>
            <input type="number" min="0" step="0.01" value={form.total} onChange={update('total')} placeholder="2500" />
          </div>
          <div className="field-row">
            <label>Responsible dispatcher</label>
            {role === 'admin' ? <select value={form.assignedTo || ''} onChange={(e) => {
              const assignedTo = e.target.value;
              const current = drivers.find((d) => d.id === form.driverId);
              const keepDriver = !current || !current.dispatcherId || !assignedTo || current.dispatcherId === assignedTo;
              setForm({ ...form, assignedTo, ...(keepDriver || form.isPartial ? {} : { driverId: '' }) });
            }}>
              <option value="">Unassigned pool</option>
              {employees.filter((e) => e.role === 'dispatcher' && e.is_active).map((e) =>
                <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>)}
            </select> : <div className="truck-readonly">Assigned to you</div>}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!canSave} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}

// Transfers a load (and its partial loads) to another dispatcher. A truck belongs to
// one dispatcher, so the admin may pick one of the new dispatcher's trucks; otherwise
// the truck is cleared and the new dispatcher assigns one of their own.
function TransferModal({ load, drivers, loads, employees, role, userId, onCancel, onConfirm }) {
  const isAdmin = role === 'admin';
  const [target, setTarget] = useState('');
  const [truckId, setTruckId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const currentName = load.assignedTo ? (staffName(employees, load.assignedTo) || 'Former employee') : 'Unassigned pool';
  const choices = activeDispatchers(employees).filter((e) => e.user_id !== load.assignedTo && e.user_id !== userId);
  const targetTrucks = isAdmin && target ? drivers.filter((d) => d.dispatcherId === target) : [];
  const partials = loads.filter((l) => l.isPartial && l.parentLoadNumber === load.loadNumber);
  const targetName = staffName(employees, target);

  const pickTarget = (value) => {
    setTarget(value);
    const current = drivers.find((d) => d.id === load.driverId);
    setTruckId(isAdmin && current && current.dispatcherId === value ? current.id : '');
  };

  const confirm = async () => {
    setBusy(true); setError('');
    try { await onConfirm(target, truckId); }
    catch (e) { setError(e.message || 'Could not transfer load.'); setBusy(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Transfer load {load.loadNumber}</h3>
          <button className="icon-btn" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="field-row">
            <label>Current dispatcher</label>
            <div className="truck-readonly">{currentName}</div>
          </div>
          <div className="field-row">
            <label>New dispatcher</label>
            <select value={target} onChange={(e) => pickTarget(e.target.value)}>
              <option value="">Select dispatcher…</option>
              {choices.map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>)}
            </select>
            {choices.length === 0 && <span className="field-hint">No other active dispatchers.</span>}
          </div>
          {isAdmin && target && (
            <div className="field-row">
              <label>Truck</label>
              <select value={truckId} onChange={(e) => setTruckId(e.target.value)}>
                <option value="">{targetName} will choose a truck</option>
                {targetTrucks.map((d) => <option key={d.id} value={d.id}>{d.truckNumber || '—'} — {d.firstName} {d.lastName}</option>)}
              </select>
            </div>
          )}
          {target && !truckId && <span className="field-hint">The truck will be removed from this load. {targetName} will assign one of their trucks.</span>}
          {partials.length > 0 && <span className="field-hint">{partials.length} partial load{partials.length > 1 ? 's' : ''} ({partials.map((p) => p.loadNumber).join(', ')}) will be transferred too.</span>}
          {error && <span className="field-error">{error}</span>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" disabled={!target || busy} onClick={confirm}>{busy ? 'Transferring…' : 'Transfer'}</button>
        </div>
      </div>
    </div>
  );
}

function Loads({ loads, setLoads, drivers, customCities, setCustomCities, employees, role, userId, logActivity, accessToken }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [driverFilter, setDriverFilter] = useState('all');
  const [adminDispatcher, setAdminDispatcher] = useState('all');
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [page, setPage] = useState(1);
  const [saveError, setSaveError] = useState('');
  const [scope, setScope] = useState(role === 'dispatcher' ? 'mine' : 'all');
  const [history, setHistory] = useState(null);
  const [transferring, setTransferring] = useState(null);
  useEffect(() => {
    setScope(role === 'dispatcher' ? 'mine' : 'all');
    setSelectedIds(new Set());
  }, [role]);
  const PAGE_SIZE = 25;

  const editingLoad = loads.find((l) => l.id === editingId) || null;
  const table = apiTable('loads', accessToken);

  const openAdd = () => { setEditingId(null); setModalOpen(true); setSaveError(''); };
  const openEdit = (id) => { setEditingId(id); setModalOpen(true); setConfirmDeleteId(null); setSaveError(''); };
  const closeModal = () => setModalOpen(false);

  const saveLoad = async (form) => {
    const row = loadToDb(form);
    try {
      if (editingId) {
        const [updated] = await table.update(editingId, row);
        setLoads(loads.map((l) => (l.id === editingId ? loadFromDb(updated) : l)));
        logActivity(`Edited load ${form.loadNumber}`);
      } else {
        const [created] = await table.insert(row);
        setLoads([loadFromDb(created), ...loads]); // newest load first
        setPage(1);
        logActivity(`Added ${form.isPartial ? 'partial' : 'full'} load ${form.loadNumber}`);
      }
      setModalOpen(false);
    } catch (e) {
      const msg = (e.message || '').toLowerCase().includes('duplicate')
        ? 'This load number already exists.'
        : (e.message || 'Could not save load.');
      setSaveError(msg);
    }
  };

  const transferLoad = async (load, targetId, truckId) => {
    const body = { assigned_to: targetId, driver_id: truckId || null };
    const [updated] = await table.update(load.id, body);
    if (!updated) throw new Error('Load could not be transferred. Refresh and try again.');
    const changed = { [load.id]: loadFromDb(updated) };
    const partials = loads.filter((l) => l.isPartial && l.parentLoadNumber === load.loadNumber);
    const failed = [];
    for (const partial of partials) {
      try {
        const [moved] = await table.update(partial.id, body);
        if (moved) changed[partial.id] = loadFromDb(moved); else failed.push(partial.loadNumber);
      } catch { failed.push(partial.loadNumber); }
    }
    // The previous dispatcher no longer sees loads handed to someone else.
    setLoads((current) => current
      .map((l) => changed[l.id] || l)
      .filter((l) => role === 'admin' || !changed[l.id] || l.assignedTo === userId));
    logActivity(`Transferred load ${load.loadNumber} to ${staffName(employees, targetId) || 'another dispatcher'}`);
    setTransferring(null);
    if (failed.length) setSaveError(`Load transferred, but partial load(s) ${failed.join(', ')} could not be transferred.`);
  };

  const deleteLoad = async (id) => {
    const l = loads.find((x) => x.id === id);
    try {
      const removed = await table.remove(id);
      if (!removed?.length) throw new Error('Load could not be deleted. Refresh and try again.');
      setLoads(loads.filter((x) => x.id !== id));
      if (l) logActivity(`Deleted load ${l.loadNumber}`);
    } catch (e) {
      setSaveError(e.message || 'Could not delete load.');
    }
    setConfirmDeleteId(null);
  };

  const addCustomCity = async (entry) => {
    const [created] = await apiTable('custom_cities', accessToken).insert(entry);
    const mapped = { city: created.city, state: created.state, zip: created.zip };
    setCustomCities([...customCities, mapped]);
    return mapped;
  };

  const driverById = useMemo(() => {
    const map = {};
    drivers.forEach((d) => { map[d.id] = d; });
    return map;
  }, [drivers]);

  const todayIso = isoDate(new Date());
  const isOverdue = (l) => l.deliveryDate && l.deliveryDate < todayIso && l.status !== 'delivered';
  const overdueCount = useMemo(() => loads.filter(isOverdue).length, [loads]);

  const resetToPage1 = () => setPage(1);

  const isAdmin = role === 'admin';
  const dispatcherLabel = (l) => (l.assignedTo ? staffName(employees, l.assignedTo) || 'Former employee' : 'Unassigned');

  const filteredLoads = loads.filter((l) => {
    if (isAdmin && adminDispatcher !== 'all' && (adminDispatcher === 'none' ? !!l.assignedTo : l.assignedTo !== adminDispatcher)) return false;
    if (role === 'dispatcher' && scope === 'mine' && l.assignedTo !== userId) return false;
    if (role === 'dispatcher' && scope === 'pool' && l.assignedTo) return false;
    const matchesSearch = l.loadNumber.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
    const matchesDriver = driverFilter === 'all' || l.driverId === driverFilter;
    return matchesSearch && matchesStatus && matchesDriver;
  });

  const sortedLoads = useMemo(() => {
    if (!sortField) return filteredLoads;
    const arr = [...filteredLoads];
    arr.sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case 'truckNumber':
          av = (driverById[a.driverId]?.truckNumber || '').toLowerCase();
          bv = (driverById[b.driverId]?.truckNumber || '').toLowerCase();
          break;
        case 'dispatcher': av = dispatcherLabel(a).toLowerCase(); bv = dispatcherLabel(b).toLowerCase(); break;
        case 'from': av = (a.from || '').toLowerCase(); bv = (b.from || '').toLowerCase(); break;
        case 'to': av = (a.to || '').toLowerCase(); bv = (b.to || '').toLowerCase(); break;
        case 'status': av = a.status; bv = b.status; break;
        case 'pickupDate': av = a.pickupDate || ''; bv = b.pickupDate || ''; break;
        case 'deliveryDate': av = a.deliveryDate || ''; bv = b.deliveryDate || ''; break;
        case 'total': av = a.total; bv = b.total; break;
        default: av = a.loadNumber.toLowerCase(); bv = b.loadNumber.toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filteredLoads, sortField, sortDir, driverById]);

  const totalPages = Math.max(1, Math.ceil(sortedLoads.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageLoads = sortedLoads.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const SortArrow = ({ field }) => sortField === field ? <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span> : null;

  const toggleSelect = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };
  const selectablePageLoads = pageLoads.filter((l) => role === 'admin' || !!l.assignedTo);
  const allPageSelected = selectablePageLoads.length > 0 && selectablePageLoads.every((l) => selectedIds.has(l.id));
  const toggleSelectAllPage = () => {
    const next = new Set(selectedIds);
    if (allPageSelected) selectablePageLoads.forEach((l) => next.delete(l.id));
    else selectablePageLoads.forEach((l) => next.add(l.id));
    setSelectedIds(next);
  };

  const markSelectedDelivered = async () => {
    const ids = Array.from(selectedIds);
    try {
      const updated = await apiRequest(`/records/loads?id=in.(${ids.join(',')})`, {
        method: 'PATCH', body: { status: 'delivered' }, accessToken, prefer: 'return=representation',
      });
      if (updated.length !== ids.length) throw new Error('Some loads changed. Refresh and try again.');
      setLoads(loads.map((l) => (selectedIds.has(l.id) ? { ...l, status: 'delivered' } : l)));
      logActivity(`Marked ${updated.length} load(s) as Delivered`);
      setSelectedIds(new Set());
    } catch (e) {
      setSaveError(e.message || 'Could not update selected loads.');
    }
  };

  // Admin: hand the selected loads to one dispatcher, or spread them evenly over all
  // active dispatchers. Partials always go with their parent load. A truck is kept only
  // if it belongs to the receiving dispatcher; otherwise it is cleared ("No truck").
  const [bulkTarget, setBulkTarget] = useState('');
  const assignSelected = async () => {
    const dispatchers = activeDispatchers(employees);
    if (!bulkTarget || dispatchers.length === 0) return;
    const selected = loads.filter((l) => selectedIds.has(l.id));
    const groups = [];
    const seen = new Set();
    selected.forEach((l) => {
      const parent = l.isPartial ? loads.find((p) => !p.isPartial && p.loadNumber === l.parentLoadNumber) : l;
      const head = parent || l;
      if (seen.has(head.id)) return;
      const members = [head, ...loads.filter((c) => c.isPartial && c.parentLoadNumber === head.loadNumber)];
      members.forEach((m) => seen.add(m.id));
      groups.push(members);
    });
    // Even split: dispatchers with the fewest open loads receive first.
    const openCount = Object.fromEntries(dispatchers.map((d) => [d.user_id, loads.filter((l) => l.assignedTo === d.user_id && l.status !== 'delivered' && !l.isPartial).length]));
    const nextTarget = () => {
      if (bulkTarget !== 'even') return bulkTarget;
      const id = dispatchers.map((d) => d.user_id).sort((a, b) => openCount[a] - openCount[b])[0];
      openCount[id] += 1;
      return id;
    };
    const changed = {};
    const failed = [];
    const perDispatcher = {};
    for (const members of groups) {
      const target = nextTarget();
      const driver = drivers.find((d) => d.id === members[0].driverId);
      const body = { assigned_to: target, driver_id: driver && driver.dispatcherId === target ? driver.id : null };
      for (const load of members) {
        try {
          const [updated] = await table.update(load.id, body);
          if (updated) changed[load.id] = loadFromDb(updated); else failed.push(load.loadNumber);
        } catch { failed.push(load.loadNumber); }
      }
      perDispatcher[target] = (perDispatcher[target] || 0) + 1;
    }
    setLoads((current) => current.map((l) => changed[l.id] || l));
    const summary = Object.entries(perDispatcher).map(([id, count]) => `${staffName(employees, id)} (${count})`).join(', ');
    logActivity(`Assigned ${Object.keys(changed).length} load(s) to ${summary}`);
    setSelectedIds(new Set());
    setBulkTarget('');
    if (failed.length) setSaveError(`Could not assign: ${failed.join(', ')}`);
  };

  const claimLoad = async (load) => {
    try {
      const [updated] = await table.update(load.id, { assigned_to: userId });
      if (!updated) throw new Error('This load is no longer available.');
      setLoads((current) => current.map((item) => item.id === load.id ? loadFromDb(updated) : item));
    } catch (error) { setSaveError(error.message || 'Could not claim load.'); }
  };

  const showHistory = async (load) => {
    try {
      const rows = await apiTable('load_history', accessToken).list(`select=*&load_id=eq.${load.id}&order=created_at.desc&limit=50`);
      setHistory({ load, rows });
    } catch (error) { setSaveError(error.message || 'Could not load history.'); }
  };

  const exportExcel = () => {
    const header = ['Load #', 'Partial', 'Parent Load #', ...(isAdmin ? ['Dispatcher'] : []), 'Truck #', 'Driver', 'From', 'To', 'Status', 'Pickup', 'Delivery', 'Total'];
    const rows = sortedLoads.map((l) => {
      const d = driverById[l.driverId];
      return [
        l.loadNumber, l.isPartial ? 'Yes' : 'No', l.parentLoadNumber || '',
        ...(isAdmin ? [dispatcherLabel(l)] : []),
        d?.truckNumber || '', d ? `${d.firstName} ${d.lastName}` : '',
        l.from || '', l.to || '', statusLabel(l.status),
        fmtDateInput(l.pickupDate), fmtDateInput(l.deliveryDate), l.total,
      ];
    });
    const ws = safeSheet([header, ...rows]);
    ws['!cols'] = header.map(() => ({ wch: 14 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Loads');
    XLSX.writeFile(wb, `loads-${todayIso}.xlsx`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Loads</h1>
          <p className="subtitle">{role === 'dispatcher' ? 'Your assigned loads and the shared unassigned pool' : 'All booked loads'}</p>
        </div>
        <div className="loads-header-actions">
          <button className="btn-ghost" onClick={exportExcel}><Download size={14} /> Excel</button>
          <button className="btn-primary" onClick={openAdd}><Plus size={15} /> Add Load</button>
        </div>
      </header>

      {overdueCount > 0 && (
        <div className="overdue-banner">
          <AlertTriangle size={14} /> {overdueCount} load{overdueCount > 1 ? 's are' : ' is'} overdue — delivery date has passed and status isn't Delivered yet.
        </div>
      )}

      {saveError && (
        <div className="overdue-banner"><AlertTriangle size={14} /> {saveError}</div>
      )}

      <div className="loads-toolbar">
        {role === 'dispatcher' && <select className="period-select" value={scope} onChange={(e) => { setScope(e.target.value); setSelectedIds(new Set()); resetToPage1(); }}>
          <option value="mine">Assigned to me</option><option value="pool">Unassigned pool</option><option value="all">Mine + pool</option>
        </select>}
        {isAdmin && <select className="period-select" value={adminDispatcher} onChange={(e) => { setAdminDispatcher(e.target.value); setSelectedIds(new Set()); resetToPage1(); }}>
          <option value="all">All dispatchers</option>
          <option value="none">Unassigned</option>
          {activeDispatchers(employees).map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>)}
        </select>}
        <div className="search-box">
          <Search size={14} className="search-icon" />
          <input
            placeholder="Search by load #"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetToPage1(); }}
          />
        </div>
        <select className="period-select" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetToPage1(); }}>
          <option value="all">All statuses</option>
          {statusOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <select className="period-select" value={driverFilter} onChange={(e) => { setDriverFilter(e.target.value); resetToPage1(); }}>
          <option value="all">All drivers</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>)}
        </select>
      </div>

      {selectedIds.size > 0 && (
        <div className="bulk-bar">
          <span>{selectedIds.size} selected</span>
          <button className="btn-primary-sm" onClick={markSelectedDelivered}>Mark as Delivered</button>
          {isAdmin && <>
            <span className="bulk-sep" />
            <select className="period-select" value={bulkTarget} onChange={(e) => setBulkTarget(e.target.value)}>
              <option value="">Assign to dispatcher…</option>
              <option value="even">Evenly among all dispatchers</option>
              {activeDispatchers(employees).map((e) => <option key={e.user_id} value={e.user_id}>{e.full_name || e.email}</option>)}
            </select>
            <button className="btn-primary-sm" disabled={!bulkTarget} onClick={assignSelected}>Assign</button>
          </>}
          <button className="btn-ghost-sm" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
        </div>
      )}

      {sortedLoads.length === 0 ? (
        <div className="empty-state">
          {loads.length === 0 ? 'No loads yet. Add your first load to get started.' : 'No loads match your search or filter.'}
        </div>
      ) : (
        <>
          <div className={`loads-table ${isAdmin ? 'loads-table--admin' : ''}`}>
            <div className="loads-row loads-row--head">
              <span><input type="checkbox" checked={allPageSelected} onChange={toggleSelectAllPage} /></span>
              <span>N</span>
              <button className="loads-sort-btn" onClick={() => toggleSort('loadNumber')}>Load # <SortArrow field="loadNumber" /></button>
              {isAdmin && <button className="loads-sort-btn" onClick={() => toggleSort('dispatcher')}>Dispatcher <SortArrow field="dispatcher" /></button>}
              <button className="loads-sort-btn" onClick={() => toggleSort('truckNumber')}>Truck # <SortArrow field="truckNumber" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('from')}>From <SortArrow field="from" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('to')}>To <SortArrow field="to" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('status')}>Status <SortArrow field="status" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('pickupDate')}>Pickup <SortArrow field="pickupDate" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('deliveryDate')}>Delivery <SortArrow field="deliveryDate" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('total')}>Total <SortArrow field="total" /></button>
              <span></span>
            </div>

            {pageLoads.map((l, i) => (
              <div className={`loads-row ${isOverdue(l) ? 'loads-row--overdue' : ''}`} key={l.id}>
                <span><input type="checkbox" disabled={role === 'dispatcher' && !l.assignedTo} checked={selectedIds.has(l.id)} onChange={() => toggleSelect(l.id)} /></span>
                <span className="loads-n">{(safePage - 1) * PAGE_SIZE + i + 1}</span>
                <span className="loads-number-cell">
                  <button className="loads-sort-btn" onClick={() => showHistory(l)} title="View change history">{l.loadNumber}</button>
                  {!isAdmin && !l.assignedTo && <span className="parent-hint">Unassigned pool</span>}
                  {l.isPartial && (
                    <span className="parent-hint">
                      <CornerDownRight size={11} /> {l.parentLoadNumber || '—'}
                    </span>
                  )}
                </span>
                {isAdmin && <span className={`loads-ellipsis ${l.assignedTo ? '' : 'loads-muted'}`} title={dispatcherLabel(l)}>{dispatcherLabel(l)}</span>}
                <span>{driverById[l.driverId]?.truckNumber || (l.driverId ? '—' : <span className="needs-truck" title="Assign one of your trucks with the pencil">No truck</span>)}</span>
                <span className="loads-ellipsis">{l.from || '—'}</span>
                <span className="loads-ellipsis">{l.to || '—'}</span>
                <select
                  className={`status-inline-select status-inline-select--${l.status}`}
                  value={l.status}
                  disabled={role === 'dispatcher' && !l.assignedTo}
                  onChange={async (e) => {
                    const newStatus = e.target.value;
                    try {
                      const updated = await table.update(l.id, { status: newStatus });
                      if (!updated?.length) throw new Error('Load could not be updated. Refresh and try again.');
                      setLoads(loads.map((x) => (x.id === l.id ? { ...x, status: newStatus } : x)));
                      logActivity(`Marked load ${l.loadNumber} as ${statusLabel(newStatus)}`);
                    } catch (err) {
                      setSaveError(err.message || 'Could not update status.');
                    }
                  }}
                >
                  {statusOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <span>{fmtDateInput(l.pickupDate)}</span>
                <span>{fmtDateInput(l.deliveryDate)}</span>
                <span>{currency(l.total)}</span>

                {confirmDeleteId === l.id ? (
                  <div className="confirm-row confirm-row--table">
                    <button className="btn-ghost-sm" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                    <button className="btn-danger-sm" onClick={() => deleteLoad(l.id)}>Delete</button>
                  </div>
                ) : (
                  <div className="driver-plain-actions">
                    {role === 'dispatcher' && !l.assignedTo ?
                      <button className="btn-ghost-sm" onClick={() => claimLoad(l)}>Claim</button> : <>
                      <button className="icon-btn" disabled={l.isPartial}
                        title={l.isPartial ? 'Partial loads are transferred together with their parent load' : 'Transfer to another dispatcher'}
                        onClick={() => { setSaveError(''); setTransferring(l); }}><ArrowRightLeft size={13} /></button>
                      <button className="icon-btn" onClick={() => openEdit(l.id)}><Pencil size={13} /></button>
                      <button className="icon-btn" onClick={() => setConfirmDeleteId(l.id)}><Trash2 size={13} /></button></>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination-row">
              <button className="icon-btn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}><ChevronLeft size={16} /></button>
              <span className="pagination-label">Page {safePage} of {totalPages} · {sortedLoads.length} loads</span>
              <button className="icon-btn" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}><ChevronRight size={16} /></button>
            </div>
          )}
        </>
      )}

      {modalOpen && (
        <LoadModal
          initial={editingLoad}
          drivers={drivers}
          loads={loads}
          customCities={customCities}
          employees={employees}
          role={role}
          userId={userId}
          onAddCustomCity={addCustomCity}
          onCancel={closeModal}
          onSave={saveLoad}
        />
      )}
      {transferring && (
        <TransferModal
          load={transferring}
          drivers={drivers}
          loads={loads}
          employees={employees}
          role={role}
          userId={userId}
          onCancel={() => setTransferring(null)}
          onConfirm={(targetId, truckId) => transferLoad(transferring, targetId, truckId)}
        />
      )}
      {history && <div className="modal-overlay"><div className="modal modal--wide">
        <div className="modal-header"><h3>Load {history.load.loadNumber} · change history</h3><button className="icon-btn" onClick={() => setHistory(null)}><X size={16} /></button></div>
        <div className="modal-body">
          {history.rows.length === 0 ? <div className="empty-state">No changes recorded since audit was enabled.</div> : history.rows.map((entry) => {
            const actor = employees.find((e) => e.user_id === entry.actor_id);
            const before = entry.old_row || {};
            const after = entry.new_row || {};
            const fields = ['status', 'assigned_to', 'driver_id', 'from_city', 'to_city', 'pickup_date', 'delivery_date', 'total'];
            const changes = fields.filter((field) => before[field] !== after[field]).map((field) => `${field}: ${before[field] ?? '—'} → ${after[field] ?? '—'}`);
            return <div className="field-row" key={entry.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
              <strong>{entry.action} · {new Date(entry.created_at).toLocaleString()} · {actor?.full_name || 'System / former employee'}</strong>
              <span className="field-hint">{changes.join(' · ') || 'Other fields changed'}</span>
            </div>;
          })}
        </div>
      </div></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SALARY PAGE
// ---------------------------------------------------------------------------

function DayDetailModal({ driver, dayLabel, dayLoads, onClose }) {
  const total = dayLoads.reduce((sum, l) => sum + l.total, 0);

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{driver.firstName} {driver.lastName} — {dayLabel}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {dayLoads.length === 0 ? (
          <div className="empty-state">No loads for this day.</div>
        ) : (
          <div className="salary-detail-list">
            {dayLoads.map((l) => (
              <div className="salary-detail-row" key={l.id}>
                <div className="salary-detail-main">
                  <span className="salary-detail-load">{l.loadNumber}</span>
                  <span className="salary-detail-route">{l.from || '—'} → {l.to || '—'}</span>
                </div>
                <div className="salary-detail-nums">
                  <span>{l.isPartial ? 'Partial' : 'Full'}</span>
                  <span className="salary-detail-net">{currency(l.total)}</span>
                </div>
              </div>
            ))}
            <div className="salary-detail-total">
              <span>Total for the day</span>
              <span>{currency(total)}</span>
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Salary({ loads, drivers: allDrivers, role, employees }) {
  const [dispatcherFilter, setDispatcherFilter] = useState('all');
  const drivers = useMemo(() => allDrivers.filter((d) => matchesDispatcher(d, dispatcherFilter)), [allDrivers, dispatcherFilter]);
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [detail, setDetail] = useState(null);
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const weekStart = startOfWeek(weekAnchor);
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return {
        iso: isoDate(d),
        weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
        sub: d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }),
      };
    });
  }, [weekStart.getTime()]);

  const cellData = useMemo(() => {
    const map = {};
    loads.forEach((l) => {
      const key = `${l.driverId}|${l.pickupDate}`;
      if (!map[key]) map[key] = [];
      map[key].push(l);
    });
    return map;
  }, [loads]);

  const rangeLabel = `${days[0]?.weekday} ${days[0]?.sub} – ${days[6]?.weekday} ${days[6]?.sub}`;

  const shiftWeek = (delta) => {
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() + delta * 7);
    setWeekAnchor(d);
  };

  const detailDriver = detail ? drivers.find((d) => d.id === detail.driverId) : null;
  const detailLoads = detail ? (cellData[`${detail.driverId}|${detail.iso}`] || []) : [];
  const detailDayLabel = detail ? `${detail.weekday} ${detail.sub}` : '';

  const driverRows = useMemo(() => {
    const rows = drivers.map((driver) => {
      const rowTotal = days.reduce((sum, d) => {
        const cell = cellData[`${driver.id}|${d.iso}`] || [];
        return sum + cell.reduce((s, l) => s + l.total, 0);
      }, 0);
      return { driver, rowTotal };
    });
    if (sortField) {
      rows.sort((a, b) => {
        let av, bv;
        if (sortField === 'name') {
          av = `${a.driver.firstName} ${a.driver.lastName}`.toLowerCase();
          bv = `${b.driver.firstName} ${b.driver.lastName}`.toLowerCase();
        } else {
          av = a.rowTotal; bv = b.rowTotal;
        }
        if (av < bv) return sortDir === 'asc' ? -1 : 1;
        if (av > bv) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [drivers, days, cellData, sortField, sortDir]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };
  const SortArrow = ({ field }) => sortField === field ? <span className="sort-arrow">{sortDir === 'asc' ? '↑' : '↓'}</span> : null;

  const exportExcel = () => {
    const header = ['Truck #', 'Driver', ...(role === 'admin' ? ['Dispatcher'] : []), 'Weekly total', ...days.map((d) => `${d.weekday} ${d.sub}`)];
    const rows = drivers.map((driver) => {
      const dayValues = days.map((d) => {
        const cell = cellData[`${driver.id}|${d.iso}`] || [];
        return cell.reduce((s, l) => s + l.total, 0);
      });
      const rowTotal = dayValues.reduce((s, v) => s + v, 0);
      return [driver.truckNumber || '—', `${driver.firstName} ${driver.lastName}`, ...(role === 'admin' ? [staffName(employees, driver.dispatcherId)] : []), rowTotal, ...dayValues];
    });
    const ws = safeSheet([header, ...rows]);
    ws['!cols'] = [{ wch: 10 }, { wch: 22 }, ...(role === 'admin' ? [{ wch: 20 }] : []), { wch: 14 }, ...days.map(() => ({ wch: 12 }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Salary');
    XLSX.writeFile(wb, `salary-${days[0]?.iso}-to-${days[6]?.iso}.xlsx`);
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Salary</h1>
          <p className="subtitle">{role === 'admin' ? 'Weekly driver earnings, based on booked loads' : 'Weekly earnings of your trucks'}</p>
        </div>
        <div className="week-nav">
          {role === 'admin' && <DispatcherFilter employees={employees} value={dispatcherFilter} onChange={setDispatcherFilter} />}
          <button className="icon-btn" onClick={() => shiftWeek(-1)}><ChevronLeft size={16} /></button>
          <span className="week-nav-label">{rangeLabel}</span>
          <button className="icon-btn" onClick={() => shiftWeek(1)}><ChevronRight size={16} /></button>
          <button className="btn-ghost salary-export-btn" onClick={exportExcel}>
            <Download size={14} /> Excel
          </button>
        </div>
      </header>

      {drivers.length === 0 ? (
        <div className="empty-state">{role === 'admin' && allDrivers.length > 0 ? 'No drivers for this dispatcher.' : 'No drivers yet. Add drivers to see their weekly earnings here.'}</div>
      ) : (
        <div className="salary-table-wrap">
          <div className="salary-table">
            <div className="salary-row salary-row--head">
              <span>Truck #</span>
              <button className="loads-sort-btn" onClick={() => toggleSort('name')}>Driver <SortArrow field="name" /></button>
              <button className="loads-sort-btn" onClick={() => toggleSort('total')}>Weekly total <SortArrow field="total" /></button>
              {days.map((d) => (
                <span key={d.iso}>{d.weekday} <span className="salary-head-sub">{d.sub}</span></span>
              ))}
            </div>

            {driverRows.map(({ driver, rowTotal }) => {
              return (
                <div className="salary-row" key={driver.id}>
                  <span className="salary-truck">{driver.truckNumber || '—'}</span>
                  <span className="salary-driver-name">
                    {driver.firstName} {driver.lastName}
                    {role === 'admin' && <span className="salary-dispatcher">{staffName(employees, driver.dispatcherId) || 'No dispatcher'}</span>}
                  </span>
                  <span className="salary-total">{currency(rowTotal)}</span>
                  {days.map((d) => {
                    const cell = cellData[`${driver.id}|${d.iso}`] || [];
                    const dayTotal = cell.reduce((s, l) => s + l.total, 0);
                    const hasLoads = cell.length > 0;
                    const isMulti = cell.length >= 2;
                    return (
                      <button
                        key={d.iso}
                        className={`salary-cell ${hasLoads ? (isMulti ? 'salary-cell--multi' : 'salary-cell--active') : ''}`}
                        onClick={() => setDetail({ driverId: driver.id, iso: d.iso, weekday: d.weekday, sub: d.sub })}
                      >
                        {hasLoads ? currency(dayTotal) : <span className="salary-cell-empty">No loads</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {detail && (
        <DayDetailModal
          driver={detailDriver}
          dayLabel={detailDayLabel}
          dayLoads={detailLoads}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CALENDAR PAGE
// ---------------------------------------------------------------------------

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function buildMonthGrid(monthAnchor) {
  const first = startOfMonth(monthAnchor);
  const startOffset = (first.getDay() + 6) % 7; // Monday = 0
  const daysInMonth = endOfMonth(monthAnchor).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), d);
    cells.push({ date, iso: isoDate(date) });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function DayNotesModal({ dateLabel, notes, onAdd, onDelete, onClose, error }) {
  const [text, setText] = useState('');

  const handleAdd = () => {
    if (!text.trim()) return;
    onAdd(text.trim());
    setText('');
  };

  return (
    <div className="modal-overlay">
      <div className="modal modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{dateLabel}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {error && <span className="field-error">{error}</span>}

        {notes.length === 0 ? (
          <div className="empty-state">No notes for this day yet.</div>
        ) : (
          <div className="notes-list">
            {notes.map((n) => (
              <div className="notes-row" key={n.id}>
                <span>{n.text}</span>
                <button className="icon-btn" onClick={() => onDelete(n.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}

        <div className="notes-add-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a note…"
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
          />
          <button className="btn-primary-sm" onClick={handleAdd}>Add</button>
        </div>

        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Calendar({ calendarNotes, setCalendarNotes, logActivity, accessToken, userId }) {
  const [monthAnchor, setMonthAnchor] = useState(startOfMonth(new Date()));
  const [selectedIso, setSelectedIso] = useState(null);
  const [noteError, setNoteError] = useState('');

  const cells = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor.getTime()]);
  const monthLabel = monthAnchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayIso = isoDate(new Date());

  const shiftMonth = (delta) => {
    const d = new Date(monthAnchor);
    d.setMonth(d.getMonth() + delta);
    setMonthAnchor(startOfMonth(d));
  };

  const addNote = async (iso, text) => {
    setNoteError('');
    try {
      const [created] = await apiTable('calendar_notes', accessToken).insert({
        note_date: iso, note_text: text, created_by: userId || null,
      });
      const existing = calendarNotes[iso] || [];
      setCalendarNotes({ ...calendarNotes, [iso]: [...existing, { id: created.id, text: created.note_text }] });
      logActivity(`Added a calendar note on ${iso}`);
    } catch (e) {
      setNoteError(e.message || 'Could not save note.');
    }
  };
  const deleteNote = async (iso, id) => {
    setNoteError('');
    try {
      await apiTable('calendar_notes', accessToken).remove(id);
      const existing = calendarNotes[iso] || [];
      setCalendarNotes({ ...calendarNotes, [iso]: existing.filter((n) => n.id !== id) });
    } catch (e) {
      setNoteError(e.message || 'Could not delete note.');
    }
  };

  const selectedDate = selectedIso ? new Date(selectedIso) : null;
  const selectedLabel = selectedDate
    ? selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Calendar</h1>
          <p className="subtitle">Click a day to view or add notes</p>
        </div>
        <div className="week-nav">
          <button className="icon-btn" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
          <span className="week-nav-label">{monthLabel}</span>
          <button className="icon-btn" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
        </div>
      </header>

      <div className="cal-grid">
        {WEEKDAY_HEADERS.map((w) => <div className="cal-weekday" key={w}>{w}</div>)}
        {cells.map((cell, i) => {
          if (!cell) return <div className="cal-cell cal-cell--empty" key={`empty-${i}`} />;
          const notes = calendarNotes[cell.iso] || [];
          const isToday = cell.iso === todayIso;
          return (
            <button
              key={cell.iso}
              className={`cal-cell ${isToday ? 'cal-cell--today' : ''}`}
              onClick={() => setSelectedIso(cell.iso)}
            >
              <span className="cal-daynum">{cell.date.getDate()}</span>
              {notes.length > 0 && (
                <span className="cal-note-preview">
                  <span className="cal-note-dot" />
                  <span className="cal-note-text">{notes.length === 1 ? notes[0].text : `${notes.length} notes`}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedIso && (
        <DayNotesModal
          dateLabel={selectedLabel}
          notes={calendarNotes[selectedIso] || []}
          onAdd={(text) => addNote(selectedIso, text)}
          onDelete={(id) => deleteNote(selectedIso, id)}
          onClose={() => { setSelectedIso(null); setNoteError(''); }}
          error={noteError}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SETTINGS PAGE
// ---------------------------------------------------------------------------

function AccountSettings({ profile, accessToken, onUpdated, logActivity }) {
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url || '');
  const [email, setEmail] = useState(profile.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const emailChanged = email.trim().toLowerCase() !== (profile.email || '').toLowerCase();
  const avatarChanged = avatarUrl !== (profile.avatar_url || '');
  const needsCurrent = emailChanged || !!newPassword;
  const dirty = emailChanged || avatarChanged || !!newPassword;
  const initials = (profile.full_name || profile.email || '').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  const handleAvatar = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (file.size > 1024 * 1024) { setError('Image must be under 1 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setAvatarUrl(reader.result); setError(''); setMessage(''); };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    setError(''); setMessage('');
    if (newPassword && newPassword.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('New passwords do not match.'); return; }
    if (needsCurrent && !currentPassword) { setError('Enter your current password to change login or password.'); return; }
    const changes = {};
    if (avatarChanged) changes.avatar_url = avatarUrl;
    if (emailChanged) changes.email = email.trim();
    if (newPassword) changes.new_password = newPassword;
    if (needsCurrent) changes.current_password = currentPassword;
    setBusy(true);
    try {
      const result = await updateAccount(accessToken, changes);
      onUpdated(result?.profile || { ...profile, avatar_url: avatarUrl, email: email.trim().toLowerCase() });
      if (emailChanged) logActivity(`Changed login to ${email.trim().toLowerCase()}`);
      if (newPassword) logActivity('Changed password');
      if (avatarChanged) logActivity('Updated profile picture');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      setMessage(newPassword && profile.role !== 'admin'
        ? (PREVIEW ? 'Saved. The administrator has been sent your new password.' : 'Saved. The administrator has been notified that you changed your password.')
        : 'Saved.');
    } catch (e) {
      setError(e.message || 'Could not update account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-list">
      <h3>My account</h3>
      <div className="field-row">
        <label>Profile Picture</label>
        <div className="avatar-upload-row">
          {avatarUrl
            ? <img src={avatarUrl} alt="" className="avatar-preview" />
            : <div className="avatar-preview avatar-preview--empty">{initials}</div>}
          <label className="btn-ghost avatar-upload-btn">
            Upload image
            <input type="file" accept="image/*" onChange={handleAvatar} style={{ display: 'none' }} />
          </label>
          {avatarUrl && <button className="btn-ghost" onClick={() => { setAvatarUrl(''); setMessage(''); }}>Remove</button>}
        </div>
      </div>
      <div className="field-row">
        <label>Login (email)</label>
        <input type="email" value={email} autoComplete="username" onChange={(e) => { setEmail(e.target.value); setMessage(''); }} />
      </div>
      <div className="field-row">
        <label>New password</label>
        <input type="password" value={newPassword} autoComplete="new-password" placeholder="Leave empty to keep current"
          onChange={(e) => { setNewPassword(e.target.value); setMessage(''); }} />
      </div>
      {newPassword && <div className="field-row">
        <label>Confirm new password</label>
        <input type="password" value={confirmPassword} autoComplete="new-password" onChange={(e) => setConfirmPassword(e.target.value)} />
      </div>}
      {needsCurrent && <div className="field-row">
        <label>Current password</label>
        <input type="password" value={currentPassword} autoComplete="current-password" onChange={(e) => setCurrentPassword(e.target.value)} />
      </div>}
      {newPassword && profile.role !== 'admin' && (
        <span className="field-hint">Your new password will be sent to the administrator.</span>
      )}
      <div className="settings-save-row">
        <button className="btn-primary" disabled={busy || !dirty} onClick={handleSave}>{busy ? 'Saving…' : 'Save account'}</button>
        {message && <span className="settings-saved-msg">{message}</span>}
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}

// Local preview only: fills or removes sample dispatchers, drivers, loads and calendar notes.
function TestDataPanel({ accessToken, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const run = async (action) => {
    if (action === 'clear' && !window.confirm('Remove all test loads, drivers, notes and test dispatchers?')) return;
    setBusy(true); setMessage('');
    try {
      const result = await apiRequest('/dev/test-data', { method: 'POST', body: { action }, accessToken });
      setMessage(action === 'clear' ? 'Test data removed.'
        : `Added ${result.loads} loads, ${result.drivers} drivers, ${result.notes} notes. Test dispatchers: ${result.dispatchers.join(', ')} (password ${PREVIEW ? TEST_PASSWORD : 'TEST_DATA_PASSWORD from backend/.env'}).`);
      onChanged();
    } catch (e) { setMessage(e.message || 'Could not update test data.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="settings-list" style={{ marginTop: 24 }}>
      <h3>Test data ({PREVIEW ? 'local preview' : 'development'})</h3>
      <span className="field-hint">Adds sample dispatchers, trucks, loads (TEST-…) and calendar notes. “Fill” replaces earlier test data; your own records are not touched.</span>
      <div className="settings-save-row">
        <button className="btn-primary" disabled={busy} onClick={() => run('fill')}>Fill test data</button>
        <button className="btn-ghost" disabled={busy} onClick={() => run('clear')}>Remove test data</button>
      </div>
      {message && <span className="field-hint">{message}</span>}
    </div>
  );
}

function SettingsPage({ settings, setSettings, onSave, accessToken, profile, onProfileUpdated, logActivity, onDataChanged }) {
  const [draft, setDraft] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const update = (field) => (e) => { setDraft({ ...draft, [field]: e.target.value }); setSaved(false); };

  const handleSave = async () => {
    setError('');
    try {
      await apiTable('settings', accessToken).update(1, {
        full_pct: draft.fullPct,
        partial_pct: draft.partialPct,
        dispatcher_name: draft.dispatcherName,
        avatar_url: draft.avatarUrl,
        theme: draft.theme,
      });
      setSettings(draft);
      onSave && onSave();
      setSaved(true);
    } catch (e) {
      setError(e.message || 'Could not save settings.');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">{profile.role === 'admin' ? 'Your account and company-wide values' : 'Your account'}</p>
        </div>
      </header>

      <AccountSettings key={profile.user_id} profile={profile} accessToken={accessToken} onUpdated={onProfileUpdated} logActivity={logActivity} />

      {profile.role === 'admin' && <div className="settings-list" style={{ marginTop: 24 }}>
        <h3>Company</h3>
        <div className="field-row">
          <label>% for Full Loads</label>
          <input
            type="number" min="0" max="100" step="0.1"
            value={draft.fullPct}
            onChange={(e) => { setDraft({ ...draft, fullPct: parseFloat(e.target.value) || 0 }); setSaved(false); }}
          />
        </div>
        <div className="field-row">
          <label>% for Partial Loads</label>
          <input
            type="number" min="0" max="100" step="0.1"
            value={draft.partialPct}
            onChange={(e) => { setDraft({ ...draft, partialPct: parseFloat(e.target.value) || 0 }); setSaved(false); }}
          />
        </div>
        <div className="field-row">
          <label>Dispatcher Name to Show on Pages</label>
          <input type="text" value={draft.dispatcherName} onChange={update('dispatcherName')} />
        </div>

        <div className="field-row">
          <label>Theme</label>
          <div className="theme-toggle-row">
            <button
              className={`theme-option ${draft.theme !== 'light' ? 'theme-option--active' : ''}`}
              onClick={() => { setDraft({ ...draft, theme: 'dark' }); setSaved(false); }}
            >
              Dark
            </button>
            <button
              className={`theme-option ${draft.theme === 'light' ? 'theme-option--active' : ''}`}
              onClick={() => { setDraft({ ...draft, theme: 'light' }); setSaved(false); }}
            >
              Light
            </button>
          </div>
        </div>

        <div className="settings-save-row">
          <button className="btn-primary" onClick={handleSave}>Save changes</button>
          {saved && <span className="settings-saved-msg">Saved.</span>}
          {error && <span className="field-error">{error}</span>}
        </div>
      </div>}
      {profile.role === 'admin' && (PREVIEW || import.meta.env.DEV) && <TestDataPanel accessToken={accessToken} onChanged={onDataChanged} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOTIFICATION BELL
// ---------------------------------------------------------------------------

function timeAgo(date) {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function NotificationBell({ log }) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(0);
  const unread = Math.max(0, log.length - lastSeen);

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) setLastSeen(log.length);
  };

  return (
    <div className="bell-wrap" tabIndex={-1} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button className="bell-btn" onClick={toggleOpen}>
        <Bell size={17} strokeWidth={2} />
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-panel-title">Recent activity</div>
          {log.length === 0 ? (
            <div className="bell-empty">No activity yet.</div>
          ) : (
            log.map((entry) => (
              <div className="bell-entry" key={entry.id}>
                <div className="bell-entry-text">{entry.text}</div>
                <div className="bell-entry-meta">{entry.user} · {timeAgo(entry.time)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AUTH SCREEN
// ---------------------------------------------------------------------------

function CredentialNotices({ notices, accessToken, onChanged }) {
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState('');
  if (notices.length === 0) return null;
  const dismiss = async (id) => {
    setError('');
    try { await apiTable('admin_notices', accessToken).remove(id); onChanged(); }
    catch (e) { setError(e.message || 'Could not dismiss notice.'); }
  };
  return <div className="settings-list" style={{ marginBottom: 24 }}>
    <h3>Login & password changes</h3>
    {notices.map((n) => <div className="field-row" key={n.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
      <label>{n.full_name} · {new Date(n.created_at).toLocaleString()}</label>
      {n.kind === 'password_changed' && !n.new_password
        ? <div className="avatar-upload-row">
            <span>Changed the password for <b>{n.new_email}</b>. You can set a new one under Team → New password.</span>
            <button className="btn-ghost" onClick={() => dismiss(n.id)}>Dismiss</button>
          </div>
        : n.kind === 'password_changed'
        ? <div className="avatar-upload-row">
            <span>New password for <b>{n.new_email}</b>:</span>
            <code>{revealed[n.id] ? n.new_password : '••••••••'}</code>
            <button className="btn-ghost" onClick={() => setRevealed({ ...revealed, [n.id]: !revealed[n.id] })}>{revealed[n.id] ? 'Hide' : 'Show'}</button>
            <button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(n.new_password)}>Copy</button>
            <button className="btn-ghost" onClick={() => dismiss(n.id)}>Dismiss</button>
          </div>
        : <div className="avatar-upload-row">
            <span>Login changed: {n.old_email} → <b>{n.new_email}</b></span>
            <button className="btn-ghost" onClick={() => dismiss(n.id)}>Dismiss</button>
          </div>}
    </div>)}
    {error && <span className="field-error">{error}</span>}
  </div>;
}

function EmployeesPage({ employees, notices, settings, accessToken, onChanged }) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('dispatcher');
  const [password, setPassword] = useState('');
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const save = async (payload) => {
    setBusy(true); setMessage('');
    try {
      await apiRequest('/staff/manage', { method: 'POST', body: payload, accessToken });
      setMessage(payload.action === 'invite'
        ? `Account created. ${payload.email} can sign in with the temporary password.`
        : 'Employee updated.');
      if (payload.action === 'invite') { setEmail(''); setFullName(''); setPassword(''); }
      // Saved employees are re-read from the server; drop the local draft (and any typed password).
      else setDrafts((current) => { const next = { ...current }; delete next[payload.user_id]; return next; });
      onChanged();
    } catch (error) { setMessage(error.message || 'Could not save employee.'); }
    finally { setBusy(false); }
  };

  return <div className="page">
    <header className="page-header"><div><h1>Employees</h1><p className="subtitle">Invite staff and manage access</p></div></header>
    <CredentialNotices notices={notices} accessToken={accessToken} onChanged={onChanged} />
    <div className="settings-list">
      <h3>Invite employee</h3>
      <div className="field-row"><label>Full name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
      <div className="field-row"><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div className="field-row"><label>Role</label><select value={role} onChange={(e) => setRole(e.target.value)}><option value="dispatcher">Dispatcher</option><option value="admin">Administrator</option></select></div>
      <div className="field-row"><label>Temporary password</label><input type="password" value={password} autoComplete="new-password" placeholder="At least 8 characters" onChange={(e) => setPassword(e.target.value)} /></div>
      <button className="btn-primary" disabled={busy || !email || !fullName.trim() || password.length < 8}
        onClick={() => save({ action: 'invite', email: email.trim(), full_name: fullName.trim(), role, password })}>
        Create account
      </button>
      {message && <span className="field-hint">{message}</span>}
    </div>
    <div className="settings-list" style={{ marginTop: 24 }}>
      <h3>Team</h3>
      {employees.map((employee) => {
        const draft = drafts[employee.user_id] || employee;
        return <div className="field-row" key={employee.user_id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14 }}>
          <label>{employee.email}</label>
          <input value={draft.full_name} onChange={(e) => setDrafts({ ...drafts, [employee.user_id]: { ...draft, full_name: e.target.value } })} />
          <select value={draft.role} onChange={(e) => setDrafts({ ...drafts, [employee.user_id]: { ...draft, role: e.target.value } })}>
            <option value="dispatcher">Dispatcher</option><option value="admin">Administrator</option>
          </select>
          {draft.role === 'dispatcher' && <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ flex: 1 }}>% for Full Loads
              <input type="number" min="0" max="100" step="0.1" value={draft.full_pct ?? ''}
                placeholder={`Company: ${settings.fullPct}`}
                onChange={(e) => setDrafts({ ...drafts, [employee.user_id]: { ...draft, full_pct: e.target.value } })} />
            </label>
            <label style={{ flex: 1 }}>% for Partial Loads
              <input type="number" min="0" max="100" step="0.1" value={draft.partial_pct ?? ''}
                placeholder={`Company: ${settings.partialPct}`}
                onChange={(e) => setDrafts({ ...drafts, [employee.user_id]: { ...draft, partial_pct: e.target.value } })} />
            </label>
          </div>}
          {!PREVIEW && <input type="password" autoComplete="new-password" placeholder="New password (optional, at least 8 characters)" value={draft.new_password || ''}
            onChange={(e) => setDrafts({ ...drafts, [employee.user_id]: { ...draft, new_password: e.target.value } })} />}
          <label><input type="checkbox" checked={draft.is_active} onChange={(e) => setDrafts({ ...drafts, [employee.user_id]: { ...draft, is_active: e.target.checked } })} /> Active</label>
          <button className="btn-ghost" disabled={busy} onClick={() => save({ action: 'update', user_id: employee.user_id, full_name: draft.full_name, role: draft.role, is_active: draft.is_active,
            ...(draft.role === 'dispatcher' ? { full_pct: draft.full_pct ?? null, partial_pct: draft.partial_pct ?? null } : {}),
            ...(draft.new_password ? { new_password: draft.new_password } : {}) })}>Save</button>
        </div>;
      })}
    </div>
  </div>;
}

function AuthScreen({ onAuthenticated, accessError }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!email.trim() || !password) { setError('Enter email and password.'); return; }
    setLoading(true);
    try {
      const data = await authSignIn(email.trim(), password);
      onAuthenticated({ accessToken: data.access_token, refreshToken: data.refresh_token, email: data.user?.email || email.trim(), userId: data.user?.id });
    } catch (e) {
      setError(e.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand"><Truck size={20} strokeWidth={2.2} /> SDS UZ INC</div>
        <h2>Sign in</h2>

        <div className="field-row">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </div>
        <div className="field-row">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }} />
        </div>

        {error && <span className="field-error">{error}</span>}
        {accessError && <span className="field-error">{accessError}</span>}

        <button className="btn-primary auth-submit" disabled={loading} onClick={handleSubmit}>
          {loading ? 'Please wait…' : 'Sign in'}
        </button>
        <span className="field-hint">{PREVIEW
          ? 'Local preview: admin@sds.local / Admin2026!, dispatcher@sds.local / Dispatch2026!. Test dispatchers (aziz@, bekzod@, dilnoza@sds.local / Test2026!) appear after admin clicks Settings → Fill test data.'
          : import.meta.env.DEV
            ? 'Development: sign in with the seed accounts from backend/.env (SEED_ADMIN_EMAIL, SEED_DISPATCHER_EMAIL).'
            : 'Ask your administrator for an account.'}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// APP SHELL
// ---------------------------------------------------------------------------

export default function DispatchCRM() {
  const sessionKey = PREVIEW ? 'sds_preview_session' : 'sds_session';
  const [active, setActive] = useState('dashboard');
  const [navOpen, setNavOpen] = useState(false);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [profile, setProfile] = useState(null);
  const [profileChecked, setProfileChecked] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [syncTick, setSyncTick] = useState(0);
  const [employees, setEmployees] = useState([]);
  const [loads, setLoads] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [customCities, setCustomCities] = useState([]);
  const [calendarNotes, setCalendarNotes] = useState({});
  const [activityLog, setActivityLog] = useState([]);
  const [adminNotices, setAdminNotices] = useState([]);
  // Server data status: shown as a banner above every page.
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const reportLoadError = (what, e) => {
    console.error(`Failed to load ${what}`, e);
    setLoadError(`Could not load ${what}: ${e?.message || 'unknown error'}`);
  };
  const [settings, setSettings] = useState({
    fullPct: 2,
    partialPct: 3,
    dispatcherName: 'Morgan Reyes',
    avatarUrl: '',
    theme: 'dark',
  });

  // The browser keeps only who is signed in ({ email, userId }). The access token stays in
  // memory and the refresh token in an HttpOnly cookie that page scripts cannot read, so an
  // XSS bug could not steal a long-lived login. (The local preview has no server and keeps
  // its fake tokens in storage.)
  const persistSession = (sess) => {
    const stored = PREVIEW ? sess : { email: sess.email, userId: sess.userId };
    try { localStorage.setItem(sessionKey, JSON.stringify(stored)); } catch (e) { /* ignore */ }
  };

  useEffect(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(sessionKey)); } catch (e) { /* no saved session yet */ }
    if (!saved?.userId) { setSessionChecked(true); return; }
    if (PREVIEW) { setSession(saved); setSessionChecked(true); return; }
    // Restore the session from the refresh cookie.
    authRefresh()
      .then((data) => {
        const sess = { accessToken: data.access_token, email: data.user?.email || saved.email, userId: data.user?.id };
        sessionRef.current = sess;
        setSession(sess);
        persistSession(sess);
      })
      .catch((e) => {
        if (e?.status === 401 || e?.status === 403) try { localStorage.removeItem(sessionKey); } catch { /* ignore */ }
      })
      .finally(() => setSessionChecked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAuthenticated = (sess) => {
    setAccessError('');
    setProfileChecked(false);
    sessionRef.current = sess;
    setSession(sess);
    persistSession(sess);
  };

  const handleLogout = (revoke = true, clearStorage = true) => {
    if (revoke && session?.accessToken) authLogout(session.accessToken).catch(() => { /* session may already be gone */ });
    setProfile(null);
    setDataLoaded(false);
    setLoadError('');
    setProfileChecked(false);
    setLoads([]);
    setDrivers([]);
    setCalendarNotes({});
    setActivityLog([]);
    setAdminNotices([]);
    sessionRef.current = null;
    setSession(null);
    if (clearStorage) try { localStorage.removeItem(sessionKey); } catch (e) { /* ignore */ }
  };

  // Keep a ref to the latest session so the refresh interval below always uses the
  // current one without re-triggering itself every time the session changes.
  const sessionRef = useRef(session);
  const refreshPromiseRef = useRef(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const refreshSession = (sess) => {
    if (!sess?.userId) return Promise.resolve(null);
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const run = async () => {
      if (sessionRef.current?.userId !== sess.userId) return null;
      const data = await authRefresh(PREVIEW ? sess.refreshToken : undefined);
      // The cookie is shared by all tabs: if another tab signed in as someone else,
      // this tab must not silently switch users.
      if (data.user?.id && data.user.id !== sess.userId) {
        const error = new Error('Signed in as another user in another tab.');
        error.status = 401;
        throw error;
      }
      if (sessionRef.current?.userId !== sess.userId) return null;
      const next = { ...sessionRef.current, accessToken: data.access_token, ...(PREVIEW ? { refreshToken: data.refresh_token } : {}) };
      sessionRef.current = next;
      setSession(next);
      persistSession(next);
      return next;
    };
    const pending = (async () => {
      try {
        return await run(); // authRefresh() itself serialises refreshes across tabs
      } catch (e) {
        if ((e?.status === 401 || e?.status === 403) && sessionRef.current?.userId === sess.userId) handleLogout(false, false);
        return null;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = pending;
    return pending;
  };

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== sessionKey || !sessionRef.current) return;
      if (!event.newValue) { handleLogout(false, false); return; }
      try {
        const next = JSON.parse(event.newValue);
        if (next?.userId !== sessionRef.current.userId) handleLogout(false, false);
      } catch { /* Ignore malformed storage from another tab. */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [session]);

  // Refresh once immediately whenever a session becomes active (covers the
  // "left the tab closed for a while, token already expired" case), then
  // keep refreshing every 45 minutes so the 1-hour token never goes stale
  // during active use.
  useEffect(() => {
    if (!session) return;
    refreshSession(sessionRef.current);
    const interval = setInterval(() => {
      if (sessionRef.current) refreshSession(sessionRef.current);
    }, 45 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setProfileChecked(false);
    apiTable('staff_profiles', session.accessToken).list(`select=*&user_id=eq.${session.userId}`)
      .then((rows) => {
        if (cancelled) return;
        if (!rows[0]?.is_active) throw new Error('Your account is inactive or has not been approved by an administrator.');
        setProfile(rows[0]);
        setProfileChecked(true);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error?.status === 401 && sessionRef.current) {
          refreshSession(sessionRef.current);
          return;
        }
        setAccessError(error.message || 'Could not verify account access.');
        handleLogout();
      });
    return () => { cancelled = true; };
  }, [session?.userId, session?.accessToken]);

  useEffect(() => {
    if (!profile) return;
    const timer = setInterval(() => setSyncTick((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, [profile]);

  useEffect(() => {
    if (!session || !profile || syncTick === 0) return;
    apiTable('staff_profiles', session.accessToken).list(`select=*&user_id=eq.${session.userId}`)
      .then((rows) => {
        const current = rows[0];
        if (!current?.is_active) { setAccessError('Your account is inactive.'); handleLogout(); return; }
        if (current.role !== profile.role || current.full_name !== profile.full_name ||
          current.email !== profile.email || current.avatar_url !== profile.avatar_url) {
          setProfile(current);
          if (current.role !== 'admin' && active === 'employees') setActive('dashboard');
        }
      }).catch((error) => {
        if (error?.status === 401 && sessionRef.current) { refreshSession(sessionRef.current); return; }
        console.error('Could not refresh account access', error);
      });
  }, [syncTick]);

  useEffect(() => {
    if (!session || !profile) return;
    (async () => {
      try {
        const rows = await apiTable('drivers', session.accessToken).list('select=*&order=created_at.asc');
        setDrivers(rows.map(driverFromDb));
      } catch (e) {
        reportLoadError('drivers', e);
      }
    })();
  }, [session, profile, syncTick]);

  useEffect(() => {
    if (!session || !profile) return;
    (async () => {
      try {
        const rows = await apiTable('settings', session.accessToken).list('select=*&id=eq.1');
        const row = rows && rows[0];
        if (row) {
          setSettings({
            fullPct: row.full_pct,
            partialPct: row.partial_pct,
            dispatcherName: row.dispatcher_name,
            avatarUrl: row.avatar_url || '',
            theme: row.theme,
          });
        }
      } catch (e) {
        reportLoadError('settings', e);
      }
    })();
  }, [session, profile, syncTick]);

  useEffect(() => {
    if (!session || !profile) return;
    (async () => {
      try {
        const rows = await apiTable('loads', session.accessToken).list('select=*&order=created_at.desc'); // newest loads first
        setLoads(rows.map(loadFromDb));
        setDataLoaded(true);
        setLoadError('');
      } catch (e) {
        reportLoadError('loads', e);
      }
    })();
  }, [session, profile, syncTick]);

  useEffect(() => {
    if (!session || !profile) return;
    (async () => {
      try {
        const rows = await apiTable('calendar_notes', session.accessToken).list('select=*&order=created_at.asc');
        const grouped = {};
        rows.forEach((r) => {
          if (!grouped[r.note_date]) grouped[r.note_date] = [];
          grouped[r.note_date].push({ id: r.id, text: r.note_text });
        });
        setCalendarNotes(grouped);
      } catch (e) {
        reportLoadError('calendar notes', e);
      }
    })();
  }, [session, profile, syncTick]);

  useEffect(() => {
    if (!session || !profile) return;
    (async () => {
      try {
        const rows = await apiTable('custom_cities', session.accessToken).list('select=*&order=created_at.asc');
        setCustomCities(rows.map((r) => ({ city: r.city, state: r.state, zip: r.zip })));
      } catch (e) {
        reportLoadError('custom cities', e);
      }
    })();
  }, [session, profile, syncTick]);

  useEffect(() => {
    if (!session || !profile) return;
    (async () => {
      try {
        const rows = await apiTable('activity_log', session.accessToken).list('select=*&order=created_at.desc&limit=50');
        setActivityLog(rows.map((r) => ({ id: r.id, text: r.action_text, user: r.user_email, time: new Date(r.created_at) })));
      } catch (e) {
        reportLoadError('activity log', e);
      }
    })();
  }, [session, profile, syncTick]);

  useEffect(() => {
    if (!session || profile?.role !== 'admin') { setAdminNotices([]); return; }
    apiTable('admin_notices', session.accessToken).list('select=*&order=created_at.desc')
      .then(setAdminNotices)
      .catch((error) => reportLoadError('admin notices', error));
  }, [session, profile, syncTick]);

  const handleProfileUpdated = (next) => {
    setProfile(next);
    if (next.email && next.email !== session.email) {
      const nextSession = { ...session, email: next.email };
      setSession(nextSession);
      persistSession(nextSession);
    }
  };

  useEffect(() => {
    if (!session || !profile) return;
    apiTable('staff_profiles', session.accessToken).list('select=*&order=created_at.asc')
      .then(setEmployees)
      .catch((error) => reportLoadError('employees', error));
  }, [session, profile, syncTick]);

  const logActivity = (text) => {
    const user = session?.email || 'Admin';
    setActivityLog((prev) => [
      { id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, user, time: new Date() },
      ...prev,
    ].slice(0, 50));
    if (session) {
      apiTable('activity_log', session.accessToken)
        .insert({ action_text: text, user_email: user, user_id: session.userId })
        .catch((e) => console.error('Failed to persist activity log entry', e));
    }
  };

  const isLight = settings.theme === 'light';
  // Navy palette (dark) and slate palette (light). --green is the UI accent
  // (blue here); --success stays green for delivered status and money values.
  const themeVars = isLight
    ? { bg: '#F8FAFC', surface: '#F1F5F9', elevated: '#E2E8F0', border: '#CBD5E1', text: '#1E293B', muted: '#475569', scheme: 'light',
        accent: '#2563EB', accentRgb: '37,99,235', success: '#15803D', successRgb: '21,128,61',
        red: '#B91C1C', redRgb: '185,28,28', yellow: '#A16207', yellowRgb: '161,98,7' }
    : { bg: '#000000', surface: '#131C31', elevated: '#1E293B', border: '#283548', text: '#CBD5E1', muted: '#8B9BB3', scheme: 'dark',
        accent: '#60A5FA', accentRgb: '96,165,250', success: '#5FC58F', successRgb: '95,197,143',
        red: '#F08A84', redRgb: '240,138,132', yellow: '#E2C07A', yellowRgb: '226,192,122' };

  return (
    <div className="app-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');

        :root {
          --bg: ${themeVars.bg};
          --surface: ${themeVars.surface};
          --elevated: ${themeVars.elevated};
          --border: ${themeVars.border};
          --text: ${themeVars.text};
          --muted: ${themeVars.muted};
          --green: ${themeVars.accent};
          --green-soft: rgba(${themeVars.accentRgb},0.14);
          --green-hover: rgba(${themeVars.accentRgb},0.24);
          --success: ${themeVars.success};
          --success-soft: rgba(${themeVars.successRgb},0.14);
          --red: ${themeVars.red};
          --red-soft: rgba(${themeVars.redRgb},0.12);
          --red-hover: rgba(${themeVars.redRgb},0.22);
          --red-tint: rgba(${themeVars.redRgb},0.07);
          --yellow: ${themeVars.yellow};
          --yellow-soft: rgba(${themeVars.yellowRgb},0.14);
          --overlay: ${isLight ? 'rgba(15,23,42,0.35)' : 'rgba(2,6,23,0.65)'};
        }

        .app-root * { box-sizing: border-box; color-scheme: ${themeVars.scheme}; }
        .app-root {
          font-family: 'Inter', sans-serif;
          background: var(--bg);
          color: var(--text);
          display: flex;
          width: 100%;
          height: 100vh;
          min-height: 100vh;
          border-radius: 0;
          overflow: hidden;
          font-feature-settings: 'tnum' 1;
          line-height: 1.5;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        .app-root ::selection { background: var(--green-soft); }
        .app-root :focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }

        h1, h2, h3 { font-family: 'Space Grotesk', sans-serif; margin: 0; font-weight: 600; }

        /* Sidebar */
        .sidebar {
          width: 208px;
          flex-shrink: 0;
          background: var(--surface);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          padding: 20px 14px;
        }
        .brand {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--green);
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: 0.06em;
          padding: 0 8px 20px 8px;
        }
        nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 10px;
          background: transparent;
          border: none;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 14.5px;
          padding: 9px 10px;
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
        }
        .nav-item:hover { background: var(--elevated); color: var(--text); }
        .nav-item--active { background: var(--elevated); color: var(--text); }
        .nav-item--active svg { color: var(--green); }
        .nav-divider {
          height: 1px;
          background: var(--border);
          margin: 8px 6px;
        }

        .sidebar-footer {
          display: flex;
          align-items: center;
          gap: 9px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .dispatcher-badge {
          width: 30px; height: 30px;
          border-radius: 6px;
          background: var(--elevated);
          border: 1px solid var(--border);
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; font-weight: 600; color: var(--green);
          flex-shrink: 0;
        }
        .dispatcher-name { font-size: 13.5px; font-weight: 500; }
        .dispatcher-role { font-size: 12px; color: var(--muted); }
        .sidebar-footer-info { flex: 1; min-width: 0; overflow: hidden; }
        .logout-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          cursor: pointer;
          padding: 5px;
          border-radius: 5px;
          flex-shrink: 0;
          display: flex;
        }
        .logout-btn:hover { color: var(--red); background: var(--elevated); }

        /* Page */
        .page { flex: 1; padding: 26px 30px; overflow-y: auto; }

        /* Main area + topbar */
        .main-area { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .topbar {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          padding: 14px 30px 0 30px;
          flex-shrink: 0;
        }

        /* Notification bell */
        .bell-wrap { position: relative; }
        .bell-btn {
          position: relative;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          border-radius: 6px;
          padding: 7px;
          cursor: pointer;
          display: flex;
        }
        .bell-btn:hover { color: var(--text); border-color: var(--green); }
        .bell-badge {
          position: absolute;
          top: -5px; right: -5px;
          background: var(--green);
          color: var(--bg);
          font-size: 10.5px;
          font-weight: 700;
          min-width: 15px;
          height: 15px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 3px;
        }
        .bell-panel {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          width: 300px;
          max-height: 360px;
          overflow-y: auto;
          background: var(--elevated);
          border: 1px solid var(--border);
          border-radius: 8px;
          z-index: 70;
          padding: 8px;
        }
        .bell-panel-title { font-size: 13px; color: var(--muted); padding: 4px 8px 8px 8px; }
        .bell-empty { font-size: 13.5px; color: var(--muted); padding: 10px 8px; }
        .bell-entry { padding: 8px; border-radius: 6px; }
        .bell-entry:hover { background: var(--surface); }
        .bell-entry-text { font-size: 13.5px; color: var(--text); }
        .bell-entry-meta { font-size: 12px; color: var(--muted); margin-top: 2px; }

        /* Avatar (sidebar + settings) */
        .dispatcher-avatar { width: 30px; height: 30px; border-radius: 6px; object-fit: cover; flex-shrink: 0; }
        .avatar-upload-row { display: flex; align-items: center; gap: 10px; }
        .avatar-preview {
          width: 44px; height: 44px;
          border-radius: 8px;
          object-fit: cover;
          background: var(--elevated);
          border: 1px solid var(--border);
        }
        .avatar-preview--empty {
          display: flex; align-items: center; justify-content: center;
          font-size: 14px; font-weight: 600; color: var(--green);
        }
        .avatar-upload-btn { cursor: pointer; }

        /* Theme toggle */
        .theme-toggle-row { display: flex; gap: 8px; }
        .theme-option {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          padding: 7px 16px;
          border-radius: 6px;
          cursor: pointer;
        }
        .theme-option--active { background: var(--green-soft); border-color: var(--green); color: var(--green); }

        /* Settings save */
        .settings-save-row { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
        .settings-saved-msg { font-size: 13px; color: var(--success); }
        .page-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }
        .page-header h1 { font-size: 21px; }
        .subtitle { color: var(--muted); font-size: 14px; margin-top: 4px; }

        /* Period selector (top-right) */
        .period-selector {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }
        .range-label { font-size: 13px; color: var(--muted); white-space: nowrap; }
        .custom-range { display: flex; align-items: center; gap: 6px; }
        .custom-range input {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          padding: 6px 8px;
          border-radius: 6px;
        }
        .custom-range-sep { color: var(--muted); font-size: 12.5px; }
        .period-select {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          padding: 7px 10px;
          border-radius: 6px;
          cursor: pointer;
        }
        .period-select:hover { border-color: var(--green); }
        .period-select:focus { outline: none; border-color: var(--green); }
        /* Dashboard */
        .dash { display: flex; flex-direction: column; gap: 18px; }
        .dash-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
        .dash-title h1 { font-size: 24px; letter-spacing: -0.01em; }
        .dash-range { color: var(--muted); font-size: 13.5px; margin-top: 4px; }
        .dashboard-pdf-btn { display: flex; align-items: center; gap: 6px; }
        .dash-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-bottom: 18px; border-bottom: 1px solid var(--border); }
        .dash-filters .period-selector { flex-direction: row-reverse; }
        .dash-filters .range-label { display: none; }
        .driver-filter-row { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }

        /* Ledger: gross split into full and partial loads */
        .ledger { padding: 22px 24px 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
        .ledger-top { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-wrap: wrap; }
        .ledger-label { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
        .ledger-gross {
          font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 44px; line-height: 1;
          letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--text);
        }
        .ledger-earn { text-align: right; }
        .ledger-earn-value { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 26px; line-height: 1; color: var(--success); font-variant-numeric: tabular-nums; }
        .ledger-bar { display: flex; height: 12px; margin: 22px 0 16px; border-radius: 3px; overflow: hidden; background: var(--elevated); gap: 2px; }
        .ledger-bar span { display: block; height: 100%; }
        .ledger-bar-full { background: var(--green); }
        .ledger-bar-partial { background: var(--yellow); }
        .ledger-bar-empty { flex: 1; }
        .ledger-split { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
        .ledger-part + .ledger-part { border-left: 1px solid var(--border); padding-left: 24px; }
        .ledger-part-name { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 500; }
        .ledger-part-name span { color: var(--muted); font-weight: 400; margin-left: auto; font-variant-numeric: tabular-nums; }
        .ledger-part-value { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 20px; margin-top: 6px; font-variant-numeric: tabular-nums; }
        .ledger-part-fee { font-size: 13px; color: var(--muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
        .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
        .swatch--full { background: var(--green); }
        .swatch--partial { background: var(--yellow); }

        /* Panels */
        .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px 20px; }
        .panel-header { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 14px; }
        .panel-header h3 { font-size: 15px; }
        .panel-subtitle { font-size: 12.5px; color: var(--muted); }
        .dash-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 18px; }

        /* Driver ranking */
        .rank { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
        .rank-row { display: grid; grid-template-columns: minmax(90px, 150px) 1fr auto; align-items: center; gap: 12px; font-size: 13.5px; }
        .rank-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rank-track { height: 8px; background: var(--elevated); border-radius: 2px; overflow: hidden; }
        .rank-fill { display: block; height: 100%; background: var(--green); border-radius: 2px; }
        .rank-value { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-variant-numeric: tabular-nums; min-width: 84px; text-align: right; }

        /* Fleet status */
        .fleet-total { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 32px; line-height: 1; display: flex; align-items: baseline; gap: 8px; }
        .fleet-total span { font-family: 'Inter', sans-serif; font-weight: 400; font-size: 13.5px; color: var(--muted); }
        .fleet-bar { display: flex; flex-wrap: wrap; gap: 4px; margin: 16px 0; }
        .fleet-cell { width: 18px; height: 18px; border-radius: 3px; background: var(--elevated); border: 1px solid var(--border); }
        .fleet-cell--pickedup { background: var(--yellow); border-color: var(--yellow); }
        .fleet-cell--available { background: var(--green); border-color: var(--green); }
        .fleet-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; }
        .fleet-legend li { display: flex; align-items: center; gap: 8px; }
        .fleet-legend b { margin-left: auto; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-variant-numeric: tabular-nums; }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; background: var(--elevated); border: 1px solid var(--border); }
        .dot--pickedup { background: var(--yellow); border-color: var(--yellow); }
        .dot--available { background: var(--green); border-color: var(--green); }

        /* Trucks table */
        .trucks-table { display: flex; flex-direction: column; overflow-x: auto; margin: 0 -20px -18px; }
        .trucks-row {
          display: grid;
          grid-template-columns: 96px minmax(140px, 1.2fr) 130px minmax(170px, 1.3fr) 60px 110px;
          gap: 12px; align-items: center; min-width: 760px;
          padding: 11px 20px; border-top: 1px solid var(--border); font-size: 13.5px;
        }
        .trucks-row--admin { grid-template-columns: 96px minmax(140px, 1.2fr) 130px minmax(120px, 1fr) minmax(170px, 1.3fr) 60px 110px; min-width: 900px; }
        .trucks-row:not(.trucks-row--head):hover { background: var(--green-soft); }
        .trucks-row--head { color: var(--muted); font-size: 12.5px; padding-top: 9px; padding-bottom: 9px; background: var(--elevated); }
        .trucks-row .num { text-align: right; font-variant-numeric: tabular-nums; }
        .trucks-truck {
          display: inline-block; font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 13px;
          padding: 2px 8px; border: 1.5px solid var(--text); border-radius: 4px; letter-spacing: 0.02em;
        }
        .trucks-gross { font-family: 'Space Grotesk', sans-serif; font-weight: 600; }
        .trucks-muted { color: var(--muted); }
        .truck-status { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; white-space: nowrap; }
        .truck-status em { font-style: normal; color: var(--muted); }
        .truck-status--pickedup em { color: var(--yellow); }
        .empty-chart {
          min-height: 140px;
          display: flex;
          align-items: center;
          justify-content: center;
          text-align: center;
          color: var(--muted);
          font-size: 13.5px;
          padding: 0 16px;
        }

        @media (max-width: 900px) {
          .dash-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 600px) {
          .dash-head { align-items: flex-start; }
          .dash-filters { display: grid; grid-template-columns: 1fr 1fr; }
          .dash-filters > * { min-width: 0; width: 100%; }
          .dash-filters .period-selector { grid-column: 1 / -1; flex-direction: column; align-items: stretch; }
          .dash-filters .period-select { width: 100%; }
          .dash-filters .custom-range input { flex: 1; min-width: 0; }
          .ledger { padding: 18px 16px; }
          .ledger-top { flex-direction: column; align-items: flex-start; gap: 14px; }
          .rank-row { grid-template-columns: 1fr auto; row-gap: 6px; }
          .rank-track { grid-column: 1 / -1; grid-row: 2; }
          .ledger-gross { font-size: 34px; }
          .ledger-earn { text-align: left; }
          .ledger-split { grid-template-columns: 1fr; gap: 14px; }
          .ledger-part + .ledger-part { border-left: none; padding-left: 0; border-top: 1px solid var(--border); padding-top: 14px; }
          .trucks-table { margin: 0 -16px -18px; }
          .panel { padding: 16px; }
        }

        /* Placeholder */
        .placeholder { flex: 1; display: flex; align-items: center; justify-content: center; }
        .placeholder-inner { text-align: center; color: var(--muted); }
        .placeholder-inner h2 { color: var(--text); margin-bottom: 8px; }

        /* Buttons */
        .btn-primary {
          display: flex;
          align-items: center;
          gap: 6px;
          background: var(--green-soft);
          border: 1px solid var(--green);
          color: var(--green);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          font-weight: 500;
          padding: 8px 14px;
          border-radius: 6px;
          cursor: pointer;
        }
        .btn-primary:hover { background: var(--green-hover); }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-ghost {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          padding: 8px 14px;
          border-radius: 6px;
          cursor: pointer;
        }
        .btn-ghost:hover { color: var(--text); border-color: var(--text); }
        .icon-btn {
          background: transparent;
          border: none;
          color: var(--muted);
          cursor: pointer;
          padding: 5px;
          border-radius: 5px;
          display: flex;
          align-items: center;
        }
        .icon-btn:hover { background: var(--elevated); color: var(--text); }
        .needs-truck { color: var(--yellow); font-size: 12.5px; }
        .icon-btn:disabled { opacity: 0.35; cursor: not-allowed; background: transparent; color: var(--muted); }

        /* Empty state */
        .empty-state {
          color: var(--muted);
          font-size: 14px;
          padding: 20px 0;
        }

        /* Drivers plain list */
        .driver-plain-list { display: flex; flex-direction: column; gap: 2px; }
        .driver-plain-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 4px;
          border-bottom: 1px solid var(--border);
        }
        .driver-plain-row:last-child { border-bottom: none; }
        .driver-plain-info { display: flex; align-items: baseline; gap: 10px; }
        .driver-plain-name { font-size: 14.5px; }
        .driver-plain-type { font-size: 13px; color: var(--muted); }
        .driver-plain-actions { display: flex; gap: 2px; }

        .confirm-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13.5px;
          color: var(--muted);
        }
        .btn-ghost-sm, .btn-danger-sm {
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          padding: 4px 10px;
          border-radius: 5px;
          cursor: pointer;
        }
        .btn-ghost-sm {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .btn-ghost-sm:hover { color: var(--text); }
        .btn-danger-sm {
          background: var(--red-soft);
          border: 1px solid var(--red);
          color: var(--red);
        }
        .btn-danger-sm:hover { background: var(--red-hover); }

        /* Modal */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: var(--overlay);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
        }
        .modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          width: 360px;
          max-width: 90%;
          padding: 18px 20px 20px 20px;
        }
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
        }
        .modal-header h3 { font-size: 15px; }
        .modal-body { display: flex; flex-direction: column; gap: 12px; }
        .field-row { display: flex; flex-direction: column; gap: 5px; }
        .field-row label { font-size: 13px; color: var(--muted); }
        .field-row input, .field-row select {
          background: var(--elevated);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          padding: 8px 10px;
          border-radius: 6px;
        }
        .field-row input:focus, .field-row select:focus {
          outline: none;
          border-color: var(--green);
        }
        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
          margin-top: 16px;
        }

        /* Settings page (reuses .field-row styling from modal) */
        .settings-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
          max-width: 320px;
        }

        /* Loads toolbar */
        .loads-toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 16px;
        }
        .search-box {
          display: flex;
          align-items: center;
          gap: 7px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 7px 10px;
          flex: 1;
          max-width: 260px;
        }
        .search-icon { color: var(--muted); flex-shrink: 0; }
        .search-box input {
          background: transparent;
          border: none;
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          width: 100%;
        }
        .search-box input:focus { outline: none; }

        /* Loads table */
        .loads-table { display: flex; flex-direction: column; overflow-x: auto; }
        .loads-table > .loads-row { min-width: 1030px; }
        .loads-table--admin > .loads-row { min-width: 1130px; }
        .loads-row {
          display: grid;
          grid-template-columns: 20px 26px 100px 70px minmax(110px, 1fr) minmax(110px, 1fr) 110px 92px 92px 92px 94px;
          align-items: center;
          gap: 10px;
          padding: 10px 4px;
          border-bottom: 1px solid var(--border);
          font-size: 13.5px;
        }
        .loads-table--admin .loads-row {
          grid-template-columns: 20px 26px 100px minmax(110px, 0.8fr) 70px minmax(110px, 1fr) minmax(110px, 1fr) 110px 92px 92px 92px 94px;
        }
        .loads-muted { color: var(--muted); }
        .loads-row--head {
          color: var(--muted);
          font-size: 12.5px;
          border-bottom: 1px solid var(--border);
          padding-bottom: 8px;
        }
        .loads-row--overdue { background: var(--red-tint); border-left: 2px solid var(--red); padding-left: 2px; }
        .loads-sort-btn {
          background: none;
          border: none;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12.5px;
          cursor: pointer;
          padding: 0;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .loads-sort-btn:hover { color: var(--text); }
        .sort-arrow { color: var(--green); font-size: 11px; }
        .loads-header-actions { display: flex; gap: 8px; align-items: center; }
        .overdue-banner {
          display: flex;
          align-items: center;
          gap: 8px;
          background: var(--red-soft);
          border: 1px solid var(--red);
          color: var(--red);
          border-radius: 6px;
          padding: 10px 14px;
          font-size: 13.5px;
          margin-bottom: 14px;
        }
        .bulk-sep { width: 1px; height: 20px; background: var(--border); }
        .bulk-bar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 10px;
          background: var(--elevated);
          border: 1px solid var(--green);
          border-radius: 6px;
          padding: 8px 12px;
          font-size: 13.5px;
          margin-bottom: 12px;
        }
        .pagination-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding-top: 14px;
        }
        .pagination-label { font-size: 13px; color: var(--muted); }
        .loads-row:last-child { border-bottom: none; }
        .loads-n { color: var(--muted); }
        .loads-number-cell { display: flex; flex-direction: column; gap: 2px; }
        .loads-number-cell > .loads-sort-btn { color: var(--text); font-weight: 500; }
        .parent-hint {
          display: flex;
          align-items: center;
          gap: 3px;
          font-size: 11.5px;
          color: var(--muted);
        }
        .loads-ellipsis {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Field helper text */
        .field-error { font-size: 12px; color: var(--red); }
        .field-hint { font-size: 12px; color: var(--muted); }
        .truck-readonly {
          background: var(--elevated);
          border: 1px solid var(--border);
          color: var(--muted);
          font-size: 14px;
          padding: 8px 10px;
          border-radius: 6px;
        }

        /* Combobox (search-or-pick) */
        .combobox { position: relative; }
        .combobox input {
          width: 100%;
          background: var(--elevated);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          padding: 8px 10px;
          border-radius: 6px;
        }
        .combobox input:focus { outline: none; border-color: var(--green); }
        .combobox-list {
          position: absolute;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          background: var(--elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          max-height: 180px;
          overflow-y: auto;
          z-index: 60;
        }
        .combobox-option {
          padding: 8px 10px;
          font-size: 13.5px;
          cursor: pointer;
        }
        .combobox-option:hover { background: var(--surface); color: var(--green); }
        .combobox-option--action {
          border-top: 1px solid var(--border);
          color: var(--green);
          font-weight: 500;
        }
        .combobox-empty {
          padding: 8px 10px;
          font-size: 13px;
          color: var(--muted);
        }

        /* Inline "add a new city" mini-form (replaces the combobox while active) */
        .city-add-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: var(--elevated);
          border: 1px solid var(--green);
          border-radius: 6px;
          padding: 8px;
        }
        .city-add-form input, .city-add-form select {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          padding: 7px 9px;
          border-radius: 6px;
        }
        .city-add-actions {
          display: flex;
          justify-content: flex-end;
          gap: 6px;
        }
        .btn-primary-sm {
          background: var(--green-soft);
          border: 1px solid var(--green);
          color: var(--green);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          padding: 4px 10px;
          border-radius: 5px;
          cursor: pointer;
        }
        .btn-primary-sm:hover { background: var(--green-hover); }

        /* Inline status select in the loads table */
        .status-inline-select {
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          padding: 4px 6px;
          border-radius: 5px;
          cursor: pointer;
        }
        .status-inline-select:focus { outline: none; border-color: var(--green); }
        .status-inline-select--pickedup {
          background: var(--yellow-soft);
          border-color: var(--yellow);
          color: var(--yellow);
        }
        .status-inline-select--delivered {
          background: var(--success-soft);
          border-color: var(--success);
          color: var(--success);
        }

        /* Toggle switch */
        .toggle-row {
          display: flex;
          align-items: center;
          gap: 8px;
          background: none;
          border: none;
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          cursor: pointer;
          padding: 2px 0;
        }
        .toggle-track {
          width: 32px;
          height: 18px;
          border-radius: 10px;
          background: var(--border);
          position: relative;
          display: inline-block;
          transition: background 0.15s;
        }
        .toggle-track--on { background: var(--green); }
        .toggle-thumb {
          position: absolute;
          top: 2px; left: 2px;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: var(--text);
          transition: transform 0.15s;
        }
        .toggle-track--on .toggle-thumb { transform: translateX(14px); }

        /* Wide modal for Loads */
        .modal--wide { width: 420px; }

        .confirm-row--table {
          display: flex;
          gap: 6px;
        }

        /* Week navigator (Salary) */
        .week-nav {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .week-nav-label {
          font-size: 13.5px;
          color: var(--muted);
          white-space: nowrap;
          min-width: 150px;
          text-align: center;
        }
        .salary-export-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-left: 6px;
        }

        /* Salary table (spreadsheet-style, merged colored blocks for active days) */
        .salary-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .salary-table { display: flex; flex-direction: column; min-width: 820px; }
        .salary-row {
          display: grid;
          grid-template-columns: 90px 170px 100px repeat(7, minmax(84px, 1fr));
          align-items: stretch;
          gap: 0;
        }
        .salary-row > span, .salary-row > button {
          padding: 10px 12px;
          display: flex;
          align-items: center;
        }
        .salary-row--head {
          background: var(--elevated);
          color: var(--muted);
          font-size: 12.5px;
          font-weight: 500;
          border-bottom: 1px solid var(--border);
        }
        .salary-row--head > span:nth-child(3) { border-right: 1px solid var(--border); }
        .salary-head-sub { color: var(--muted); font-size: 11px; margin-left: 4px; }
        .salary-row:not(.salary-row--head) { border-bottom: 1px solid var(--border); }
        .salary-row:last-child { border-bottom: none; }
        .salary-truck { font-size: 13.5px; color: var(--muted); background: var(--surface); }
        .salary-driver-name { font-size: 14px; background: var(--surface); }
        .salary-dispatcher { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
        .salary-total {
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 14px;
          background: var(--surface);
          border-right: 1px solid var(--border);
        }
        .salary-cell {
          background: transparent;
          border: none;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 13.5px;
          cursor: pointer;
          text-align: left;
        }
        .salary-cell:hover { filter: brightness(1.15); }
        .salary-cell--active {
          background: var(--success-soft);
          color: var(--success);
          font-weight: 600;
        }
        .salary-cell--multi {
          background: var(--yellow-soft);
          color: var(--yellow);
          font-weight: 600;
        }
        .salary-cell-empty { color: var(--muted); font-size: 12px; font-weight: 400; }

        /* Day detail modal (Salary) */
        .salary-detail-list { display: flex; flex-direction: column; gap: 10px; }
        .salary-detail-row {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border);
        }
        .salary-detail-main { display: flex; gap: 10px; align-items: baseline; }
        .salary-detail-load { font-weight: 600; font-size: 14px; }
        .salary-detail-route { font-size: 13px; color: var(--muted); }
        .salary-detail-nums { display: flex; gap: 14px; font-size: 13px; color: var(--muted); }
        .salary-detail-net { color: var(--success); font-weight: 500; }
        .salary-detail-total {
          display: flex;
          justify-content: space-between;
          padding-top: 4px;
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 14px;
        }

        /* Calendar */
        .cal-grid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 6px;
        }
        .cal-weekday {
          text-align: left;
          font-size: 12.5px;
          color: var(--muted);
          padding: 0 4px 6px 4px;
        }
        .cal-cell {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          min-height: 84px;
          padding: 8px;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 6px;
          cursor: pointer;
          text-align: left;
          min-width: 0;
        }
        .cal-cell:hover { border-color: var(--green); }
        .cal-cell--empty { background: transparent; border: none; cursor: default; }
        .cal-cell--today { border-color: var(--green); }
        .cal-daynum { font-family: 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 600; color: var(--text); }
        .cal-cell--today .cal-daynum { color: var(--green); }
        .cal-note-preview {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--muted);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          width: 100%;
        }
        .cal-note-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cal-note-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--green);
          flex-shrink: 0;
        }

        /* Notes modal */
        .notes-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .notes-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
          padding: 8px 10px;
          background: var(--elevated);
          border-radius: 6px;
          font-size: 14px;
        }
        .notes-add-row { display: flex; gap: 8px; }
        .notes-add-row input {
          flex: 1;
          background: var(--elevated);
          border: 1px solid var(--border);
          color: var(--text);
          font-family: 'Inter', sans-serif;
          font-size: 14px;
          padding: 8px 10px;
          border-radius: 6px;
        }
        .notes-add-row input:focus { outline: none; border-color: var(--green); }

        /* Logout screen */
        .logout-screen {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .logout-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          text-align: center;
          color: var(--green);
          max-width: 280px;
        }
        .logout-card h2 { font-size: 17px; color: var(--text); margin-top: 6px; }
        .logout-card p { font-size: 13.5px; color: var(--muted); margin: 0 0 8px 0; }

        /* Auth screen */
        .auth-screen {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }
        .auth-card {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 300px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 26px 24px;
        }
        .auth-brand {
          display: flex;
          align-items: center;
          gap: 8px;
          color: var(--green);
          font-family: 'Space Grotesk', sans-serif;
          font-weight: 600;
          font-size: 14px;
          letter-spacing: 0.06em;
          margin-bottom: 4px;
        }
        .auth-card h2 { font-size: 17px; margin-bottom: 4px; }
        .auth-submit { justify-content: center; margin-top: 4px; }
        .auth-switch {
          background: none;
          border: none;
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 13px;
          cursor: pointer;
          text-align: center;
          padding: 4px 0 0 0;
        }
        .auth-switch:hover { color: var(--green); }

        /* Mobile navigation (hidden on wide screens) */
        .menu-btn, .sidebar-close, .topbar-brand, .sidebar-backdrop { display: none; }
        @media (max-width: 768px) {
          .app-root { height: 100dvh; min-height: 100dvh; }
          .sidebar {
            position: fixed; top: 0; left: 0; bottom: 0; z-index: 60; width: min(280px, 84vw);
            transform: translateX(-100%); transition: transform 0.22s ease; box-shadow: none;
          }
          .sidebar--open { transform: translateX(0); box-shadow: 0 0 40px rgba(0,0,0,0.35); }
          .sidebar-backdrop { display: block; position: fixed; inset: 0; z-index: 55; background: var(--overlay); opacity: 0; pointer-events: none; transition: opacity 0.22s ease; }
          .sidebar-backdrop--open { opacity: 1; pointer-events: auto; }
          .sidebar-close { display: flex; margin-left: auto; background: transparent; border: none; color: var(--muted); padding: 6px; border-radius: 6px; cursor: pointer; }
          .sidebar-close:hover { color: var(--text); background: var(--elevated); }
          .brand { padding-bottom: 16px; }
          .nav-item { padding: 11px 10px; font-size: 15px; }
          .topbar { justify-content: space-between; gap: 10px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--surface); }
          .menu-btn { display: flex; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px; cursor: pointer; }
          .topbar-brand { display: flex; align-items: center; gap: 7px; margin-right: auto; color: var(--green); font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 14px; letter-spacing: 0.06em; }
          .page { padding: 18px 16px 28px; }
          .page-header { flex-wrap: wrap; }
          .page-header > * { min-width: 0; }
          .loads-header-actions { flex-wrap: wrap; }
          .loads-toolbar { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
          .loads-toolbar > * { min-width: 0; width: 100%; }
          .loads-toolbar .search-box { grid-column: 1 / -1; max-width: none; order: -1; }
          .bulk-bar { flex-wrap: wrap; }
          .week-nav { flex-wrap: wrap; flex-shrink: 1; width: 100%; }
          .week-nav > .period-select { flex: 1 1 100%; }
          .week-nav-label { flex: 1; min-width: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sidebar, .sidebar-backdrop { transition: none; }
        }

      `}</style>

      {!sessionChecked ? (
        <div className="logout-screen"><span className="pagination-label">Loading…</span></div>
      ) : !session ? (
        <AuthScreen onAuthenticated={handleAuthenticated} accessError={accessError} />
      ) : !profileChecked || !profile ? (
        <div className="logout-screen"><span className="pagination-label">Checking account access…</span></div>
      ) : (
        <>
          <Sidebar open={navOpen} onClose={() => setNavOpen(false)} active={active} onSelect={setActive} dispatcherName={profile.full_name || profile.email} avatarUrl={profile.avatar_url || (profile.role === 'admin' ? settings.avatarUrl : '')} role={profile.role} onLogout={handleLogout} />
          <div className="main-area">
            <div className="topbar">
              <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-controls="app-sidebar" aria-expanded={navOpen}>
                <Menu size={20} />
              </button>
              <div className="topbar-brand"><Truck size={18} strokeWidth={2.2} /><span>SDS UZ INC</span></div>
              <NotificationBell log={activityLog} />
            </div>
            {loadError && <div className="field-error" role="alert" style={{ margin: '0 0 12px' }}>
              {loadError} <button className="btn-ghost" onClick={() => { setLoadError(''); setSyncTick((v) => v + 1); }}>Retry</button>
            </div>}
            {!dataLoaded && !loadError && <div className="field-hint" role="status" style={{ margin: '0 0 12px' }}>Loading data…</div>}
            {active === 'dashboard' && <Dashboard loads={loads} drivers={drivers} settings={settings} role={profile.role} employees={employees} />}
            {active === 'loads' && <Loads loads={loads} setLoads={setLoads} drivers={drivers} customCities={customCities} setCustomCities={setCustomCities} employees={employees} role={profile.role} userId={session.userId} logActivity={logActivity} accessToken={session.accessToken} />}
            {active === 'drivers' && <Drivers drivers={drivers} setDrivers={setDrivers} logActivity={logActivity} accessToken={session.accessToken} role={profile.role} userId={session.userId} employees={employees} />}
            {active === 'salary' && <Salary loads={loads} drivers={drivers} role={profile.role} employees={employees} />}
            {active === 'calendar' && <Calendar calendarNotes={calendarNotes} setCalendarNotes={setCalendarNotes} logActivity={logActivity} accessToken={session.accessToken} userId={session.userId} />}
            {active === 'settings' && <SettingsPage settings={settings} setSettings={setSettings} onSave={() => logActivity('Updated settings')} accessToken={session.accessToken} profile={profile} onProfileUpdated={handleProfileUpdated} logActivity={logActivity} onDataChanged={() => setSyncTick((value) => value + 1)} />}
            {active === 'employees' && profile.role === 'admin' && <EmployeesPage employees={employees} notices={adminNotices} settings={settings} accessToken={session.accessToken} onChanged={() => setSyncTick((value) => value + 1)} />}
            {active !== 'dashboard' && active !== 'loads' && active !== 'drivers' && active !== 'salary' && active !== 'calendar' && active !== 'settings' && active !== 'employees' && (
              <Placeholder label={navItems.find(n => n.id === active).label} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
