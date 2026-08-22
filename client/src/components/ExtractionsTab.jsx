import React, { useState, useEffect } from 'react';
import { Database, Search, Download, Eye, FileText, Image as ImageIcon } from 'lucide-react';

export default function ExtractionsTab({ groups }) {
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchMessages();
  }, [selectedGroup, search]);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedGroup) params.append('groupId', selectedGroup);
      if (search) params.append('search', search);
      const res = await fetch(`/api/messages?${params.toString()}`);
      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error('Error fetching messages:', err);
    } finally {
      setLoading(false);
    }
  };

  const parseJSON = (str) => {
    if (!str) return null;
    try { return JSON.parse(str); } catch (e) { return str; }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* Header controls & Export */}
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Database size={22} color="#06b6d4" /> Extracted Database Explorer
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
            Search and export parsed WhatsApp group records stored in SQLite.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', minWidth: '240px' }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              className="input-field"
              placeholder="Search text or fields..."
              style={{ paddingLeft: '38px' }}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="input-field"
            style={{ width: 'auto' }}
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
          >
            <option value="">All Groups</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>

          <a href="/api/export?format=json" download className="btn btn-secondary">
            <Download size={16} /> Export JSON
          </a>
          <a href="/api/export?format=csv" download className="btn btn-primary">
            <Download size={16} /> Export CSV
          </a>
        </div>
      </div>

      {/* Main Table */}
      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 16px' }}>ID</th>
                <th style={{ padding: '14px 16px' }}>Group / Sender</th>
                <th style={{ padding: '14px 16px' }}>Type</th>
                <th style={{ padding: '14px 16px' }}>Content / Extracted Text</th>
                <th style={{ padding: '14px 16px' }}>Schema</th>
                <th style={{ padding: '14px 16px' }}>LLM Extraction</th>
                <th style={{ padding: '14px 16px' }}>Timestamp</th>
                <th style={{ padding: '14px 16px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {messages.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {loading ? 'Loading records...' : 'No extraction records found.'}
                  </td>
                </tr>
              ) : (
                messages.map(m => {
                  const extData = parseJSON(m.extracted_data);
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '14px 16px', fontWeight: 600 }}>#{m.id}</td>
                      <td style={{ padding: '14px 16px' }}>
                        <div style={{ fontWeight: 600, color: '#ffffff' }}>{m.sender_name || 'Sender'}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.group_name || m.group_id}</div>
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className="badge badge-info">{m.message_type.replace('Message', '')}</span>
                      </td>
                      <td style={{ padding: '14px 16px', maxWidth: '280px' }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.content}
                        </div>
                        {m.media_path && (
                          <span style={{ fontSize: '0.75rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                            <ImageIcon size={12} /> {m.media_path.split('/').pop()}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <span className="badge badge-warning">{m.schema_id || 'default'}</span>
                      </td>
                      <td style={{ padding: '14px 16px', maxWidth: '300px' }}>
                        {extData ? (
                          <div style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: '#4ade80', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {JSON.stringify(extData)}
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-dim)' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '14px 16px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </td>
                      <td style={{ padding: '14px 16px' }}>
                        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => setSelectedItem(m)}>
                          <Eye size={14} /> Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Inspection Drawer / Modal */}
      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content" style={{ maxWidth: '700px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>Message #{selectedItem.id} Details</h3>
              <button className="btn btn-secondary" style={{ padding: '4px 10px' }} onClick={() => setSelectedItem(null)}>✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflowY: 'auto' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Group & Sender</label>
                <div style={{ fontWeight: 600 }}>{selectedItem.sender_name} ({selectedItem.sender_id}) in {selectedItem.group_name}</div>
              </div>

              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Raw Message Content</label>
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '4px' }}>
                  {selectedItem.content}
                </div>
              </div>

              {selectedItem.extracted_text && (
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Document Extracted Text (OCR/PDF)</label>
                  <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '4px', fontSize: '0.85rem' }}>
                    {selectedItem.extracted_text}
                  </div>
                </div>
              )}

              {selectedItem.media_path && (
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Media File</label>
                  <div style={{ marginTop: '4px' }}>
                    <a href={`/${selectedItem.media_path}`} target="_blank" rel="noreferrer" className="btn btn-secondary">
                      <FileText size={16} /> Open Media File ({selectedItem.media_path.split('/').pop()})
                    </a>
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.75rem', color: '#4ade80', textTransform: 'uppercase', fontWeight: 600 }}>LLM Extracted JSON Result</label>
                <div style={{ background: '#05070d', padding: '14px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)', marginTop: '4px' }}>
                  <pre style={{ color: '#4ade80' }}>
                    {JSON.stringify(parseJSON(selectedItem.extracted_data), null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
