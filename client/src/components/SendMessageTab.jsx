import React, { useState } from 'react';
import { Send, Phone, Users, CheckCircle, AlertCircle, MessageSquare, Clock, ArrowRight } from 'lucide-react';

export default function SendMessageTab({ groups, connState }) {
  const [recipientType, setRecipientType] = useState('phone'); // 'phone' | 'group'
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedGroupJid, setSelectedGroupJid] = useState(groups[0]?.id || '');
  const [message, setMessage] = useState('');
  const [resetSession, setResetSession] = useState(false);
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState(null);
  const [sentHistory, setSentHistory] = useState([]);

  const isConnected = connState?.status === 'connected';

  // Calculate target JID preview
  const getTargetJid = () => {
    if (recipientType === 'group') {
      return selectedGroupJid;
    }
    const clean = phoneNumber.replace(/[^0-9]/g, '');
    return clean ? `${clean}@s.whatsapp.net` : '';
  };

  const handleSend = async (e) => {
    e.preventDefault();
    setAlert(null);

    const recipient = recipientType === 'group' ? selectedGroupJid : phoneNumber.trim();

    if (!recipient) {
      setAlert({ type: 'error', text: recipientType === 'group' ? 'Please select a WhatsApp group chat.' : 'Please enter a target phone number.' });
      return;
    }

    if (!message.trim()) {
      setAlert({ type: 'error', text: 'Please enter a message to send.' });
      return;
    }

    setSending(true);

    try {
      const res = await fetch('/api/whatsapp/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient, message: message.trim(), resetSession })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      const recipientName = recipientType === 'group'
        ? (groups.find(g => g.id === selectedGroupJid)?.name || selectedGroupJid)
        : phoneNumber;

      setAlert({
        type: 'success',
        text: `Message successfully delivered to ${recipientName}!`
      });

      setSentHistory(prev => [
        {
          id: Date.now(),
          target: recipientName,
          jid: data.result?.jid || recipient,
          text: message.trim(),
          timestamp: new Date().toLocaleTimeString()
        },
        ...prev
      ]);

      setMessage('');
    } catch (err) {
      setAlert({ type: 'error', text: err.message });
    } finally {
      setSending(false);
    }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      
      {/* Header */}
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Send size={24} color="#25d366" /> Outbound WhatsApp Message Composer
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
            Send direct custom text messages to individual contacts or specific WhatsApp group chats.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={isConnected ? 'badge badge-success' : 'badge badge-danger'}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: isConnected ? '#25d366' : '#f43f5e' }}></span>
            {isConnected ? 'Client Ready' : 'WhatsApp Disconnected'}
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        
        {/* Main Composer Form */}
        <div className="glass-panel" style={{ padding: '24px' }}>
          <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            
            {/* Recipient Type Switcher */}
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
                Recipient Destination
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setRecipientType('phone')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: recipientType === 'phone' ? '1px solid #25d366' : '1px solid var(--border-color)',
                    background: recipientType === 'phone' ? 'rgba(37, 211, 102, 0.15)' : 'rgba(0,0,0,0.2)',
                    color: recipientType === 'phone' ? '#25d366' : 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Phone size={16} /> Direct Phone Number
                </button>

                <button
                  type="button"
                  onClick={() => setRecipientType('group')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justify: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: recipientType === 'group' ? '1px solid #25d366' : '1px solid var(--border-color)',
                    background: recipientType === 'group' ? 'rgba(37, 211, 102, 0.15)' : 'rgba(0,0,0,0.2)',
                    color: recipientType === 'group' ? '#25d366' : 'var(--text-muted)',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  <Users size={16} /> Group Chat
                </button>
              </div>
            </div>

            {/* Recipient Input */}
            {recipientType === 'phone' ? (
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
                  Target Phone Number (With Country Code)
                </label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="e.g. +1 555 123 4567 or 447123456789"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '4px', display: 'block' }}>
                  Include international country code without spaces or leading zeroes (e.g. 14155552671).
                </span>
              </div>
            ) : (
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block' }}>
                  Select Synced Group Chat
                </label>
                {groups.length === 0 ? (
                  <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    No synced groups available. Click "Sync Groups" in the top bar to pull your active WhatsApp group chats.
                  </div>
                ) : (
                  <select
                    className="input-field"
                    value={selectedGroupJid}
                    onChange={(e) => setSelectedGroupJid(e.target.value)}
                  >
                    {groups.map(g => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.id})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Target JID Badge */}
            {getTargetJid() && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', border: '1px dashed var(--border-color)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                <span>Target JID:</span>
                <code style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{getTargetJid()}</code>
              </div>
            )}

            {/* Message Area */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Message Content
                </label>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                  {message.length} chars
                </span>
              </div>
              <textarea
                className="input-field"
                rows={5}
                placeholder="Type your WhatsApp message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </div>

            {/* Reset E2EE Session Checkbox */}
            {recipientType === 'phone' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <input
                  type="checkbox"
                  checked={resetSession}
                  onChange={(e) => setResetSession(e.target.checked)}
                  style={{ width: '16px', height: '16px', accentColor: '#25d366', cursor: 'pointer' }}
                />
                <span>
                  <strong style={{ color: 'var(--text-main)' }}>Reset E2EE Session Key</strong> (Fixes "Waiting for this message" decryption errors)
                </span>
              </label>
            )}

            {/* Alert banner */}
            {alert && (
              <div
                style={{
                  padding: '12px 16px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  background: alert.type === 'error' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(37, 211, 102, 0.15)',
                  border: alert.type === 'error' ? '1px solid rgba(244, 63, 94, 0.3)' : '1px solid rgba(37, 211, 102, 0.3)',
                  color: alert.type === 'error' ? '#f87171' : '#4ade80'
                }}
              >
                {alert.type === 'error' ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
                <span>{alert.text}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || !isConnected}
              style={{ width: '100%', opacity: (!isConnected || sending) ? 0.6 : 1, cursor: (!isConnected || sending) ? 'not-allowed' : 'pointer' }}
            >
              {sending ? (
                'Transmitting Message...'
              ) : (
                <>
                  <Send size={16} /> Send WhatsApp Message
                </>
              )}
            </button>
          </form>
        </div>

        {/* Recent Session Outbound Activity Log */}
        <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
            <Clock size={18} color="var(--accent-purple)" /> Session Dispatch Log
          </h3>
          
          {sentHistory.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '30px 20px', color: 'var(--text-dim)', border: '1px dashed var(--border-color)', borderRadius: '12px' }}>
              <MessageSquare size={32} style={{ marginBottom: '10px', opacity: 0.4 }} />
              <p style={{ fontSize: '0.85rem' }}>No outbound messages sent in this session yet.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '450px', overflowY: 'auto', paddingRight: '4px' }}>
              {sentHistory.map(item => (
                <div key={item.id} style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ArrowRight size={14} color="#25d366" /> {item.target}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      {item.timestamp}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)', marginBottom: '8px' }}>
                    {item.jid}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', padding: '8px 10px', borderRadius: '6px', whiteSpace: 'pre-wrap' }}>
                    {item.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
