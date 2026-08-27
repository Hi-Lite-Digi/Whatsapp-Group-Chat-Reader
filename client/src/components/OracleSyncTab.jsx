import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Link2,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone
} from 'lucide-react';

function statusBadge(status) {
  if (status === 'published') return 'badge badge-success';
  if (status === 'ready') return 'badge badge-warning';
  if (status === 'failed') return 'badge badge-danger';
  return 'badge badge-info';
}

function listingLabel(status) {
  return {
    existing_with_stock: 'Existing listing with stock',
    existing_no_stock: 'Existing listing, no stock',
    new_listing: 'New listing'
  }[status] || status;
}

export default function OracleSyncTab({
  connState,
  groups,
  oracleStatus,
  oracleEvents,
  oracleRuns,
  settings,
  onConnect,
  onReplaceAccount,
  onTestOracle,
  onSaveSettings,
  onPublishEvent
}) {
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
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
        'Enable automatic publishing? Complete quotations from mapped groups will be written to Oracle without manual review.'
      );
      if (!approved) return;
    }
    await run(
      'auto',
      () => onSaveSettings({ ...settings, oracle_auto_publish: autoPublish ? 'false' : 'true' }),
      autoPublish ? 'Automatic publishing is off.' : 'Automatic publishing is on.'
    );
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
              Listen to selected supplier groups, extract complete new-tyre quotations, match them to Oracle, and publish approved per-piece prices.
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
            <h3 style={{ fontSize: '1rem' }}>Quotation Review Queue</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>Deduplicated supplier prices captured from mapped groups.</p>
          </div>
          <span className="badge badge-info">{oracleEvents.length} records</span>
        </div>
        {oracleEvents.length === 0 ? (
          <div style={{ padding: '42px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            No realtime supplier quotations have been captured since this pipeline was enabled.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '920px' }}>
              <thead>
                <tr style={{ color: 'var(--text-dim)', fontSize: '0.72rem', textTransform: 'uppercase', textAlign: 'left' }}>
                  {['Captured', 'Supplier / Group', 'Product', 'Per Piece', 'Oracle Match', 'Status', 'Action'].map(label => <th key={label} style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {oracleEvents.map(event => (
                  <tr key={event.id} style={{ borderBottom: '1px solid var(--border-color)', verticalAlign: 'top' }}>
                    <td style={{ padding: '15px 16px', color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{new Date(`${event.created_at}Z`).toLocaleString()}</td>
                    <td style={{ padding: '15px 16px' }}><strong>{event.supplier_name || event.supplier_code}</strong><div style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: '4px' }}>{event.group_name}</div></td>
                    <td style={{ padding: '15px 16px' }}><strong>{event.brand} {event.model}</strong><div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>{event.size}{event.year_of_manufacture ? ` · ${event.year_of_manufacture}` : ''}</div></td>
                    <td style={{ padding: '15px 16px', fontWeight: 700, whiteSpace: 'nowrap' }}>S${Number(event.price).toFixed(2)}</td>
                    <td style={{ padding: '15px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{listingLabel(event.listing_status)}</td>
                    <td style={{ padding: '15px 16px' }}><span className={statusBadge(event.sync_status)}>{event.sync_status}</span>{event.error_message && <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '6px', maxWidth: '220px' }}>{event.error_message}</div>}</td>
                    <td style={{ padding: '15px 16px' }}>
                      {(event.sync_status === 'ready' || event.sync_status === 'failed') && (
                        <button className="btn btn-primary" onClick={() => run(`publish-${event.id}`, () => onPublishEvent(event.id), 'Quotation published to Oracle.')} disabled={busy === `publish-${event.id}`}>
                          <Send size={14} /> Publish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
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
                  {['Checked', 'Group', 'Result', 'Reason', 'Source Messages', 'Quotes'].map(label => <th key={label} style={{ padding: '13px 16px', borderBottom: '1px solid var(--border-color)' }}>{label}</th>)}
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
