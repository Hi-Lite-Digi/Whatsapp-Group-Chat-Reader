import React, { useState } from 'react';
import { Users, Search, RefreshCw, CheckCircle, XCircle, FileCode } from 'lucide-react';

export default function GroupsTab({ groups, schemas, onUpdateGroup, onSyncGroups }) {
  const [search, setSearch] = useState('');

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
            return (
              <div key={group.id} className="glass-panel" style={{ padding: '20px', borderColor: isMonitored ? 'rgba(37, 211, 102, 0.4)' : 'var(--border-color)' }}>
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
                  
                  {/* Schema selector */}
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <FileCode size={14} /> Extraction Schema
                    </label>
                    <select
                      className="input-field"
                      value={group.active_schema_id || 'default'}
                      onChange={(e) => onUpdateGroup(group.id, isMonitored, e.target.value)}
                    >
                      {schemas.map(s => (
                        <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                      ))}
                    </select>
                  </div>

                  {/* Toggle button */}
                  <button
                    className={isMonitored ? 'btn btn-danger' : 'btn btn-primary'}
                    style={{ width: '100%' }}
                    onClick={() => onUpdateGroup(group.id, !isMonitored, group.active_schema_id)}
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
