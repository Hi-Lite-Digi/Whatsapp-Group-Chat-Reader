import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Eye,
  Link2,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone
} from 'lucide-react';
import CaseEvidencePanel from './CaseEvidencePanel.jsx';

function statusBadge(status) {
  if (status === 'published') return 'badge badge-success';
  if (status === 'ready') return 'badge badge-warning';
  if (status === 'incomplete') return 'badge badge-info';
  if (status === 'failed' || status === 'ambiguous') return 'badge badge-danger';
  return 'badge badge-info';
}

function parsedJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function knownCaseSummary(caseItem) {
  const fields = parsedJson(caseItem.known_fields_json, {});
  const availabilityAssumed = (fields.availability_evidence || []).includes('price_quantity_assumption');
  const values = [
    ...(fields.sizes || []),
    ...(fields.brands || []),
    ...(fields.models || []),
    ...(fields.prices || []).map(price => `S$${Number(price).toFixed(2)}`),
    ...(fields.quantities || []).map(quantity => `${quantity} pc${Number(quantity) === 1 ? '' : 's'}`),
    ...(fields.availabilities || []).map(value => value === 'ready_stock'
      ? availabilityAssumed ? 'Ready stock assumed — verify' : 'Ready stock confirmed'
      : value)
  ];
  if (fields.requires_staff_verification === true) values.push('LLM-mapped — verify');
  return values.join(' · ') || 'Evidence collecting';
}

function caseAvailabilityAssumed(caseItem) {
  const fields = parsedJson(caseItem?.known_fields_json, {});
  return (fields.availability_evidence || []).includes('price_quantity_assumption');
}

function caseRequiresStaffVerification(caseItem) {
  const fields = parsedJson(caseItem?.known_fields_json, {});
  return fields.requires_staff_verification === true || caseAvailabilityAssumed(caseItem);
}

function listingLabel(status) {
  return {
    existing_with_stock: 'Existing listing with stock',
    existing_no_stock: 'Existing listing, no stock',
    new_listing: 'New listing'
  }[status] || status;
}

function listingActionLabel(action) {
  return {
    update_existing: 'Update existing Oracle record',
    create_new: 'Create new Oracle record'
  }[action] || 'Pending exact record check';
}

function missingEventFields(event) {
  const missing = [];
  if (!event.brand) missing.push('brand');
  if (!event.model) missing.push('model');
  if (!event.size) missing.push('size');
  if (!(Number(event.price) > 0)) missing.push('price');
  if (!(Number.isInteger(Number(event.stock_quantity)) && Number(event.stock_quantity) > 0)) missing.push('quantity');
  if (event.availability !== 'ready_stock') missing.push('confirmed availability');
  return missing;
}

export default function OracleSyncTab({
  connState,
  groups,
  oracleStatus,
  oracleEvents,
  oracleRuns,
  oracleCases = [],
  settings,
  onConnect,
  onReplaceAccount,
  onTestOracle,
  onSaveSettings,
  onPublishEvent
}) {
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [caseAudit, setCaseAudit] = useState(null);
  const [caseAuditLoading, setCaseAuditLoading] = useState(false);
  const [caseAuditError, setCaseAuditError] = useState('');
  const caseAuditRequestId = useRef(0);
  const connected = connState.status === 'connected';
  const mappedGroups = groups.filter(group => group.oracle_sync_enabled === 1);
  const autoPublish = settings.oracle_auto_publish === 'true';

  const run = async (key, action, successMessage) => {
    setBusy(key);
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy('');
    }
  };

  const replaceAccount = () => {
    const approved = window.confirm(
      'Replace the linked WhatsApp account? This removes the current local session and requires a fresh QR or pairing code. Group mappings remain stored but paused until the new account is connected.'
    );
    if (approved) run('replace', onReplaceAccount, 'The old session was cleared. Link the intended Mrrjestic listener account now.');
  };

  const toggleAutoPublish = async () => {
    if (!autoPublish) {
      const approved = window.confirm(
        'Enable automatic publishing? Only quotations with brand, model, size, price, quantity, and confirmed ready-stock availability will be written to Oracle without manual review.'
      );
      if (!approved) return;
    }
    await run(
      'auto',
      () => onSaveSettings({ ...settings, oracle_auto_publish: autoPublish ? 'false' : 'true' }),
      autoPublish ? 'Automatic publishing is off.' : 'Automatic publishing is on.'
    );
  };

  const loadCaseAudit = async caseId => {
    const requestId = ++caseAuditRequestId.current;
    setSelectedCaseId(caseId);
    setCaseAudit(current => current?.case?.id === caseId ? current : null);
    setCaseAuditLoading(true);
    setCaseAuditError('');
    try {
      const response = await fetch(`/api/oracle/cases/${caseId}/audit`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Unable to load the quotation evidence');
      if (requestId === caseAuditRequestId.current) setCaseAudit(data);
    } catch (error) {
      if (requestId === caseAuditRequestId.current) setCaseAuditError(error.message);
    } finally {
      if (requestId === caseAuditRequestId.current) setCaseAuditLoading(false);
    }
  };

  const closeCaseAudit = () => {
    caseAuditRequestId.current++;
    setSelectedCaseId(null);
    setCaseAudit(null);
    setCaseAuditError('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="glass-panel" style={{ padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '18px', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '9px' }}>
              <Link2 size={22} color="var(--accent-cyan)" /> Supplier Quotation Sync
            </h2>
            <p style={{ color: 'var(--text-muted)', marginTop: '5px', maxWidth: '720px', lineHeight: 1.55 }}>
              Prepare reviewable new-tyre quotation cases from supplier messages, retain the source transcript, match the exact Oracle product, and update or create only the record approved by MRR staff.
            </p>
          </div>
          <span className={autoPublish ? 'badge badge-warning' : 'badge badge-success'}>
            <ShieldCheck size={13} /> {autoPublish ? 'Automatic publishing on' : 'Review required'}
          </span>
        </div>
        <div style={{ marginTop: '16px', padding: '13px 15px', borderRadius: '12px', border: `1px solid ${connected ? 'rgba(34, 197, 94, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`, background: connected ? 'rgba(34, 197, 94, 0.08)' : 'rgba(245, 158, 11, 0.08)', color: connected ? '#4ade80' : '#fbbf24', display: 'flex', gap: '10px', lineHeight: 1.5 }}>
          {connected ? <CheckCircle size={19} style={{ flex: '0 0 auto', marginTop: '2px' }} /> : <AlertTriangle size={19} style={{ flex: '0 0 auto', marginTop: '2px' }} />}
          <span>{connected ? `The listener is connected and ${mappedGroups.length} supplier group${mappedGroups.length === 1 ? ' is' : 's are'} mapped for quotation processing.` : 'Link the intended Mrrjestic listener account before enabling supplier quotation processing.'}</span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: '20px' }}>
        <section className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}><Smartphone size={19} color="#25d366" /> Listener Account</h3>
          <div style={{ marginTop: '16px', padding: '14px', borderRadius: '12px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: connected ? '#25d366' : '#f59e0b' }} />
              <strong>{connected ? 'Listener account connected' : 'Account not connected'}</strong>
            </div>
            {connState.user && (
              <div style={{ color: 'var(--text-muted)', marginTop: '8px', fontSize: '0.83rem', overflowWrap: 'anywhere' }}>
                {connState.user.name || 'WhatsApp account'} · {connState.user.id || connState.user.lid}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }}>
            {!connected && <button className="btn btn-primary" onClick={onConnect}><MessageSquare size={16} /> Link account</button>}
            <button className="btn btn-danger" onClick={replaceAccount} disabled={busy === 'replace'}>
              {busy === 'replace' ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Replace account
            </button>
          </div>
        </section>

        <section className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}><Database size={19} color="var(--accent-cyan)" /> Oracle Connection</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px' }}>
            <div style={{ padding: '13px', borderRadius: '11px', background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Status</div>
              <div style={{ marginTop: '5px', color: oracleStatus.connected ? '#4ade80' : '#f87171', fontWeight: 600 }}>{oracleStatus.connected ? 'Connected' : 'Unavailable'}</div>
            </div>
            <div style={{ padding: '13px', borderRadius: '11px', background: 'rgba(255,255,255,0.04)' }}>
              <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase' }}>Suppliers</div>
              <div style={{ marginTop: '5px', fontWeight: 600 }}>{oracleStatus.suppliers?.length || 0}</div>
            </div>
          </div>
          {oracleStatus.error && <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '10px' }}>{oracleStatus.error}</p>}
          <button className="btn btn-secondary" style={{ marginTop: '14px' }} onClick={() => run('oracle', onTestOracle, 'Oracle connection verified.')} disabled={busy === 'oracle'}>
            {busy === 'oracle' ? <LoaderCircle size={16} className="spin" /> : <CheckCircle size={16} />} Test connection
          </button>
        </section>

        <section className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1rem' }}><ShieldCheck size={19} color="var(--accent-amber)" /> Publishing Control</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.83rem', lineHeight: 1.55, marginTop: '12px' }}>
            {mappedGroups.length} supplier group{mappedGroups.length === 1 ? '' : 's'} mapped. Keep manual review on until the real account and every supplier mapping have been validated.
          </p>
          <button className={autoPublish ? 'btn btn-danger' : 'btn btn-secondary'} style={{ width: '100%', marginTop: '16px' }} onClick={toggleAutoPublish} disabled={busy === 'auto'}>
            {autoPublish ? 'Disable Automatic Publishing' : 'Enable Automatic Publishing'}
          </button>
        </section>
      </div>

      {notice && <div className="glass-panel" style={{ padding: '13px 16px', color: notice.toLowerCase().includes('error') ? '#f87171' : 'var(--text-muted)' }}>{notice}</div>}

      <section className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1rem' }}>Quotation Case Register</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>Review the populated quotation fields first, then expand a case to verify the exact messages used. Later fragments can safely fill missing evidence.</p>
          </div>
          <span className="badge badge-info">{oracleCases.length} cases</span>
        </div>
        {oracleCases.length === 0 ? (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>No persistent quotation cases have been opened yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '980px' }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase', textAlign: 'left' }}>
                  {['Updated', 'Case', 'Supplier / Group', 'Quotation Fields', 'Missing', 'Messages', 'Status', 'Source'].map(label => <th key={label} style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {oracleCases.slice(0, 50).map(caseItem => {
                  const missing = parsedJson(caseItem.missing_fields_json, []);
                  return (
                    <tr key={caseItem.id} style={{ borderBottom: '1px solid var(--border-color)', verticalAlign: 'top', background: selectedCaseId === caseItem.id ? 'rgba(6, 182, 212, 0.06)' : 'transparent' }}>
                      <td style={{ padding: '13px 16px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(`${caseItem.updated_at}Z`).toLocaleString()}</td>
                      <td style={{ padding: '13px 16px', fontWeight: 700 }}>Q-{String(caseItem.id).padStart(4, '0')}</td>
                      <td style={{ padding: '13px 16px' }}><strong>{caseItem.supplier_code}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '4px' }}>{caseItem.group_name || caseItem.group_id}</div></td>
                      <td style={{ padding: '13px 16px', color: 'var(--text-muted)', maxWidth: '340px' }}>{knownCaseSummary(caseItem)}</td>
                      <td style={{ padding: '13px 16px', color: missing.length ? '#fbbf24' : '#4ade80' }}>{missing.length ? missing.join(', ') : 'Complete'}</td>
                      <td style={{ padding: '13px 16px' }}>{caseItem.message_count || 0}</td>
                      <td style={{ padding: '13px 16px' }}><span className={statusBadge(caseItem.status)}>{caseItem.status}</span>{caseItem.last_reason && <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', marginTop: '5px' }}>{caseItem.last_reason}</div>}</td>
                      <td style={{ padding: '13px 16px' }}><button className="btn btn-secondary" style={{ padding: '8px 11px', whiteSpace: 'nowrap' }} onClick={() => loadCaseAudit(caseItem.id)} disabled={caseAuditLoading && selectedCaseId === caseItem.id}><Eye size={14} /> Review messages</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {caseAuditError && selectedCaseId && <div style={{ padding: '15px 20px', borderTop: '1px solid var(--border-color)', color: '#f87171' }}>{caseAuditError}</div>}
        {selectedCaseId && !caseAuditError && (
          <CaseEvidencePanel
            audit={caseAudit}
            loading={caseAuditLoading}
            onClose={closeCaseAudit}
            onRefresh={() => loadCaseAudit(selectedCaseId)}
          />
        )}
      </section>

      <section className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1rem' }}>Quotation Review Queue</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>The LLM maps conversational fields using the supplier’s historical patterns. Contextual interpretations and price-plus-quantity availability assumptions remain traceable to messages and require MRR staff verification.</p>
          </div>
          <span className="badge badge-info">{oracleEvents.length} records</span>
        </div>
        {oracleEvents.length === 0 ? (
          <div style={{ padding: '42px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No realtime supplier quotations have been captured since this pipeline was enabled.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1120px' }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase', textAlign: 'left' }}>
                  {['Captured', 'Supplier / Group', 'Product', 'Per Piece', 'Quantity / Availability', 'Oracle Action', 'Status', 'Action'].map(label => <th key={label} style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {oracleEvents.map(event => {
                  const assumedAvailability = caseAvailabilityAssumed(
                    oracleCases.find(caseItem => caseItem.id === event.case_id)
                  );
                  const requiresStaffVerification = caseRequiresStaffVerification(
                    oracleCases.find(caseItem => caseItem.id === event.case_id)
                  );
                  return <tr key={event.id} style={{ borderBottom: '1px solid var(--border-color)', verticalAlign: 'top' }}>
                    <td style={{ padding: '15px 16px', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{new Date(`${event.created_at}Z`).toLocaleString()}</td>
                    <td style={{ padding: '15px 16px' }}><strong>{event.supplier_name || event.supplier_code}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '4px' }}>{event.group_name}{event.case_id ? ` · Q-${String(event.case_id).padStart(4, '0')}` : ''}</div></td>
                    <td style={{ padding: '15px 16px' }}><strong>{event.brand} {event.model}</strong><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>{event.size}{event.year_of_manufacture ? ` · ${event.year_of_manufacture}` : ''}</div></td>
                    <td style={{ padding: '15px 16px', fontWeight: 700, whiteSpace: 'nowrap' }}>S${Number(event.price).toFixed(2)}</td>
                    <td style={{ padding: '15px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      <strong style={{ color: event.availability === 'ready_stock' ? '#4ade80' : '#fbbf24' }}>{event.stock_quantity ? `${event.stock_quantity} pc${Number(event.stock_quantity) === 1 ? '' : 's'}` : 'Quantity missing'}</strong>
                      <div style={{ marginTop: '4px' }}>{event.availability === 'ready_stock'
                        ? assumedAvailability ? 'Ready stock assumed — verify messages' : 'Ready stock confirmed'
                        : 'Availability unconfirmed'}</div>
                    </td>
                    <td style={{ padding: '15px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{listingActionLabel(event.listing_action)}<div style={{ color: 'var(--text-dim)', marginTop: '4px' }}>{listingLabel(event.listing_status)}</div></td>
                    <td style={{ padding: '15px 16px' }}><span className={statusBadge(event.sync_status)}>{event.sync_status}</span>{event.error_message && <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '6px', maxWidth: '220px' }}>{event.error_message}</div>}</td>
                    <td style={{ padding: '15px 16px' }}>
                      {(event.sync_status === 'ready' || event.sync_status === 'failed') && missingEventFields(event).length === 0 && (
                        <button className="btn btn-primary" onClick={() => run(`publish-${event.id}`, () => onPublishEvent(event.id), 'Quotation published to Oracle.')} disabled={busy === `publish-${event.id}`}>
                          <Send size={14} /> {requiresStaffVerification ? 'Verify & publish' : 'Publish'}
                        </button>
                      )}
                      {missingEventFields(event).length > 0 && <div style={{ color: '#fbbf24', fontSize: '0.75rem', maxWidth: '180px' }}>Waiting for {missingEventFields(event).join(', ')}</div>}
                    </td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: '1rem' }}>Processing Audit</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>Every settled supplier reply is recorded, including messages rejected as incomplete or unrelated.</p>
          </div>
          <span className="badge badge-info">{oracleRuns.length} checks</span>
        </div>
        {oracleRuns.length === 0 ? (
          <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>No realtime supplier checks have run yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase', textAlign: 'left' }}>
                  {['Checked', 'Group', 'Case', 'Result', 'Reason', 'Source Messages', 'Quotes'].map(label => <th key={label} style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {oracleRuns.slice(0, 30).map(runItem => {
                  let sourceCount = 0;
                  try { sourceCount = JSON.parse(runItem.source_message_ids || '[]').length; } catch {}
                  return (
                    <tr key={runItem.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '13px 16px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(`${runItem.created_at}Z`).toLocaleString()}</td>
                      <td style={{ padding: '13px 16px' }}>{runItem.group_name || runItem.group_id}</td>
                      <td style={{ padding: '13px 16px', fontWeight: 700 }}>{runItem.case_id ? `Q-${String(runItem.case_id).padStart(4, '0')}` : '—'}</td>
                      <td style={{ padding: '13px 16px' }}><span className={runItem.status === 'completed' ? 'badge badge-success' : runItem.status === 'failed' ? 'badge badge-danger' : 'badge badge-info'}>{runItem.status}</span></td>
                      <td style={{ padding: '13px 16px', color: 'var(--text-muted)' }}>{runItem.reason || 'Quotation captured'}</td>
                      <td style={{ padding: '13px 16px' }}>{sourceCount}</td>
                      <td style={{ padding: '13px 16px', fontWeight: 700 }}>{runItem.event_count || 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
