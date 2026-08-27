import React, { useState } from 'react';
import { CheckCircle, Clock3, MessageCircle, Search, ShieldCheck, XCircle } from 'lucide-react';

export default function DMsTab({ dms, onAddDm, onUpdateDm }) {
  const [search, setSearch] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [contactName, setContactName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const query = search.trim().toLowerCase();
  const filteredDms = dms.filter(dm =>
    !query || [dm.name, dm.phone_jid, dm.lid_jid, dm.id]
      .some(value => (value || '').toLowerCase().includes(query))
  );

  const toggleMonitoring = async (dm) => {
    setBusyId(dm.id);
    setError('');
    try {
      await onUpdateDm(dm.id, dm.is_monitored !== 1);
    } catch (requestError) {
      setError(requestError.message || 'Unable to update this direct message.');
    } finally {
      setBusyId(null);
    }
  };

  const addDm = async (event) => {
    event.preventDefault();
    setAdding(true);
    setError('');
    try {
      await onAddDm(phoneNumber, contactName);
      setPhoneNumber('');
      setContactName('');
    } catch (requestError) {
      setError(requestError.message || 'Unable to add this direct message.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="glass-panel" style={{ padding: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <MessageCircle size={22} color="#25d366" /> Selected Direct Messages
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
            Choose individual conversations to store. Every DM starts paused.
          </p>
        </div>

        <div style={{ position: 'relative', flex: '1', maxWidth: '420px', minWidth: '240px' }}>
          <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="search"
            className="input-field"
            aria-label="Search direct messages"
            placeholder="Search names or WhatsApp IDs..."
            style={{ paddingLeft: '38px' }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <form className="glass-panel" onSubmit={addDm} style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 240px' }}>
          <label htmlFor="dm-phone" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Add by phone number
          </label>
          <input
            id="dm-phone"
            type="tel"
            className="input-field"
            placeholder="Country code + number, e.g. 6581234567"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            required
          />
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="dm-name" style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
            Label (optional)
          </label>
          <input
            id="dm-name"
            type="text"
            className="input-field"
            placeholder="Contact name"
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={adding || !phoneNumber.trim()}>
          {adding ? 'Checking...' : 'Add DM'}
        </button>
      </form>

      <div className="glass-panel" style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: '12px', background: 'rgba(6, 182, 212, 0.08)', borderColor: 'rgba(6, 182, 212, 0.3)' }}>
        <ShieldCheck size={20} color="#22d3ee" style={{ flex: '0 0 auto', marginTop: '1px' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.55 }}>
          Paused DMs are not written to SQLite and live messages are discarded. During a WhatsApp history sync, a capped copy may be held in memory so enabling a DM can import available history; that temporary buffer disappears when the app restarts or logs out.
        </p>
      </div>

      {error && (
        <div role="alert" className="glass-panel" style={{ padding: '12px 16px', color: '#f87171', background: 'rgba(244, 63, 94, 0.1)', borderColor: 'rgba(244, 63, 94, 0.3)' }}>
          {error}
        </div>
      )}

      {filteredDms.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
          {dms.length === 0
            ? 'No DMs have been discovered in this linked-device session. Add one by phone number, wait for a new DM, or re-link once to receive a fresh chat/history sync.'
            : 'No direct messages match your search.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
          {filteredDms.map(dm => {
            const isMonitored = dm.is_monitored === 1;
            const jid = dm.phone_jid || dm.lid_jid || dm.id;
            return (
              <div key={dm.id} className="glass-panel" style={{ padding: '20px', borderColor: isMonitored ? 'rgba(37, 211, 102, 0.4)' : 'var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {dm.name || 'Unknown contact'}
                    </h3>
                    <span title={jid} style={{ display: 'block', fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {jid}
                    </span>
                  </div>
                  <span className={isMonitored ? 'badge badge-success' : 'badge badge-danger'}>
                    {isMonitored ? <CheckCircle size={12} /> : <XCircle size={12} />}
                    {isMonitored ? 'Selected' : 'Paused'}
                  </span>
                </div>

                <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <span>{Number(dm.message_count || 0).toLocaleString()} stored messages</span>
                    {dm.last_message_at && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <Clock3 size={13} /> {new Date(dm.last_message_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={isMonitored ? 'btn btn-danger' : 'btn btn-primary'}
                    style={{ width: '100%' }}
                    aria-pressed={isMonitored}
                    disabled={busyId === dm.id}
                    onClick={() => toggleMonitoring(dm)}
                  >
                    {busyId === dm.id
                      ? 'Updating...'
                      : isMonitored ? 'Stop Reading This DM' : 'Read This DM'}
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
