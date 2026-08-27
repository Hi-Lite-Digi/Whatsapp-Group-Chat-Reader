import React, { useState } from 'react';
import { Users, Search, RefreshCw, CheckCircle, XCircle, FileCode, Database, History } from 'lucide-react';

export default function GroupsTab({ groups, schemas, oracleSuppliers = [], onUpdateGroup, onSyncGroups, onRequestHistory }) {
  const [search, setSearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState({});

  const filteredGroups = groups.filter(g =>
    (g.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (g.id || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header controls */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={22} color="#25d366" /> WhatsApp Group Chat Manager
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
            Select which WhatsApp groups to monitor and assign extraction schemas.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1', maxWidth: '500px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              className="input-field"
              placeholder="Search groups..."
              style={{ paddingLeft: '38px' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={onSyncGroups}>
            <RefreshCw size={16} /> Sync Groups
          </button>
        </div>
      </div>

      {/* Group Cards Grid */}
      {filteredGroups.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          No groups found. Connect WhatsApp or click "Sync Groups" to fetch your participating WhatsApp group chats.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '20px' }}>
          {filteredGroups.map(group => {
            const isMonitored = group.is_monitored === 1;
            const oracleSyncEnabled = group.oracle_sync_enabled === 1;
            const supplierCode = group.oracle_supplier_code || '';
            const supplierSenderIds = group.oracle_supplier_sender_ids || '';
            const messageCount = Number(group.message_count || 0);
            const firstMessage = group.first_message_at ? new Date(group.first_message_at).toLocaleString() : null;
            const lastMessage = group.last_message_at ? new Date(group.last_message_at).toLocaleString() : null;
            return (
              <div key={group.id} className="glass-panel" style={{ padding: '20px', borderColor: oracleSyncEnabled ? 'rgba(6, 182, 212, 0.5)' : isMonitored ? 'rgba(37, 211, 102, 0.4)' : 'var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ffffff' }}>{group.name}</h3>
                    <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
                      {group.id}
                    </span>
                  </div>
                  <span className={isMonitored ? 'badge badge-success' : 'badge badge-danger'}>
                    {isMonitored ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    {isMonitored ? 'Monitored' : 'Paused'}
                  </span>
                </div>

                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(37, 211, 102, 0.06)', border: '1px solid rgba(37, 211, 102, 0.18)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <History size={14} /> Stored history
                      </span>
                      <strong style={{ color: '#ffffff' }}>{messageCount} message{messageCount === 1 ? '' : 's'}</strong>
                    </div>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', lineHeight: 1.45, marginTop: '7px' }}>
                      {messageCount > 0
                        ? `${firstMessage} to ${lastMessage}`
                        : 'No history has been supplied by WhatsApp for this linked account yet.'}
                    </p>
                    {isMonitored && (
                      <button
                        className="btn btn-secondary"
                        style={{ width: '100%', marginTop: '10px' }}
                        onClick={async () => {
                          const result = await onRequestHistory(group.id);
                          setHistoryStatus(previous => ({ ...previous, [group.id]: result.message }));
                        }}
                      >
                        <History size={14} /> Request Older History
                      </button>
                    )}
                    {historyStatus[group.id] && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.45, marginTop: '8px' }}>
                        {historyStatus[group.id]}
                      </p>
                    )}
                  </div>
                  
                  {/* Schema selector */}
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <FileCode size={14} /> Extraction Schema
                    </label>
                    <select
                      className="input-field"
                      value={group.active_schema_id || 'default'}
                      onChange={(e) => onUpdateGroup(group.id, isMonitored, e.target.value, oracleSyncEnabled, supplierCode, supplierSenderIds)}
                    >
                      {schemas.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(6, 182, 212, 0.07)', border: '1px solid rgba(6, 182, 212, 0.18)' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <Database size={14} /> Oracle supplier mapping
                    </label>
                    <select
                      className="input-field"
                      value={supplierCode}
                      onChange={(event) => onUpdateGroup(group.id, isMonitored, group.active_schema_id, oracleSyncEnabled && Boolean(event.target.value), event.target.value, supplierSenderIds)}
                    >
                      <option value="">Select supplier for this group</option>
                      {oracleSuppliers.map(supplier => (
                        <option key={supplier.id || supplier.code} value={supplier.code}>{supplier.name} ({supplier.code})</option>
                      ))}
                    </select>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', margin: '10px 0 6px' }}>
                      Supplier sender IDs
                    </label>
                    <input
                      className="input-field"
                      key={`${group.id}:${supplierSenderIds}`}
                      defaultValue={supplierSenderIds}
                      placeholder="6587540420@s.whatsapp.net, 12345@lid"
                      onBlur={(event) => onUpdateGroup(
                        group.id,
                        isMonitored,
                        group.active_schema_id,
                        oracleSyncEnabled,
                        supplierCode,
                        event.target.value
                      )}
                    />
                    <button
                      className={oracleSyncEnabled ? 'btn btn-danger' : 'btn btn-secondary'}
                      style={{ width: '100%', marginTop: '10px' }}
                      disabled={!oracleSyncEnabled && (!supplierCode || !supplierSenderIds.trim())}
                      onClick={() => onUpdateGroup(group.id, oracleSyncEnabled ? isMonitored : true, group.active_schema_id, !oracleSyncEnabled, supplierCode, supplierSenderIds)}
                    >
                      {oracleSyncEnabled ? 'Pause Quotation Sync' : 'Enable Quotation Sync'}
                    </button>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', lineHeight: 1.45, marginTop: '8px' }}>
                      Off by default. Only settled, complete tyre quotations sent by these supplier identities enter the Oracle review queue.
                    </p>
                  </div>

                  {/* Toggle button */}
                  <button
                    className={isMonitored ? 'btn btn-danger' : 'btn btn-primary'}
                    style={{ width: '100%' }}
                    onClick={() => onUpdateGroup(group.id, !isMonitored, group.active_schema_id, !isMonitored && oracleSyncEnabled, supplierCode, supplierSenderIds)}
                  >
                    {isMonitored ? 'Disable Monitoring' : 'Enable Real-time Monitoring'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
