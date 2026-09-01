import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  RefreshCw,
  Terminal
} from 'lucide-react';

const messageKey = (message) => message.wa_message_id || `stored-${message.id}`;

export default function LiveFeedTab({ liveMessages, logs, chats }) {
  const [storedMessages, setStoredMessages] = useState([]);
  const [selectedChat, setSelectedChat] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const logEndRef = useRef(null);

  const fetchMessages = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams({ limit: '1000' });
      if (selectedChat) params.set('groupId', selectedChat);
      const response = await fetch(`/api/messages?${params.toString()}`);
      if (!response.ok) throw new Error(`Message history returned ${response.status}`);
      const data = await response.json();
      setStoredMessages(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
    } catch (fetchError) {
      setError(fetchError.message || 'Unable to load stored messages.');
    } finally {
      if (!background) setLoading(false);
    }
  }, [selectedChat]);

  useEffect(() => {
    fetchMessages();
    const refreshTimer = setInterval(() => fetchMessages({ background: true }), 15000);
    return () => clearInterval(refreshTimer);
  }, [fetchMessages]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const messages = useMemo(() => {
    const matchingLiveMessages = selectedChat
      ? liveMessages.filter(message => message.group_id === selectedChat)
      : liveMessages;
    const merged = new Map();

    // Stored rows include extraction metadata. Add them first, then let a
    // socket event for the same WhatsApp message supply the freshest fields.
    storedMessages.forEach(message => merged.set(messageKey(message), message));
    matchingLiveMessages.forEach(message => {
      const key = messageKey(message);
      merged.set(key, { ...(merged.get(key) || {}), ...message, isLive: true });
    });

    return Array.from(merged.values())
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 1000);
  }, [liveMessages, selectedChat, storedMessages]);

  const groupChats = chats.filter(chat => chat.chat_type === 'group');
  const directChats = chats.filter(chat => chat.chat_type === 'dm');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', minHeight: '600px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '18px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <MessageSquare size={22} color="#25d366" />
              <h2 style={{ fontSize: '1.2rem', fontWeight: 600 }}>WhatsApp Messages</h2>
              <span className="badge badge-info" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                <Activity size={12} /> Live
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>
              Stored group history is loaded automatically. New messages appear here as they arrive.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <select
              className="input-field"
              style={{ width: 'auto', minWidth: '220px' }}
              value={selectedChat}
              onChange={(event) => setSelectedChat(event.target.value)}
              aria-label="Filter messages by chat"
            >
              <option value="">All monitored chats</option>
              {groupChats.length > 0 && (
                <optgroup label="Groups">
                  {groupChats.map(chat => <option key={chat.id} value={chat.id}>{chat.name}</option>)}
                </optgroup>
              )}
              {directChats.length > 0 && (
                <optgroup label="Direct Messages">
                  {directChats.map(chat => <option key={chat.id} value={chat.id}>{chat.name}</option>)}
                </optgroup>
              )}
            </select>
            <button className="btn btn-secondary" onClick={() => fetchMessages()} disabled={loading}>
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', borderBottom: '1px solid var(--border-color)', padding: '10px 2px', marginBottom: '14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <span>{loading ? 'Loading message history…' : `Showing ${messages.length} recent message${messages.length === 1 ? '' : 's'}`}</span>
          {lastUpdated && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <CheckCircle2 size={14} color="#25d366" /> Dashboard refreshed {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        {error && (
          <div style={{ padding: '12px', marginBottom: '12px', borderRadius: '8px', color: '#fca5a5', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1, maxHeight: 'calc(100vh - 360px)', minHeight: '420px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '6px' }}>
          {!loading && messages.length === 0 ? (
            <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--text-muted)' }}>
              <MessageSquare size={36} color="var(--text-dim)" style={{ marginBottom: '8px' }} />
              <p>No stored messages were found for this chat yet.</p>
              <p style={{ fontSize: '0.8rem', marginTop: '4px' }}>New messages will appear here automatically.</p>
            </div>
          ) : (
            messages.map(message => (
              <div key={messageKey(message)} style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${message.isLive ? 'rgba(37,211,102,0.55)' : 'var(--border-color)'}`, borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#ffffff' }}>{message.sender_name || 'Sender'}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      in {message.group_name || message.group_id}
                    </span>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '3px' }}>
                      {new Date(message.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {message.isLive && <span className="badge badge-success">New</span>}
                    <span className="badge badge-info">{message.chat_type === 'dm' ? 'DM' : 'Group'}</span>
                    <span className="badge badge-warning" style={{ textTransform: 'capitalize' }}>{message.source === 'web_history' ? 'History' : (message.source || 'Realtime')}</span>
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '10px 12px', borderRadius: '8px', fontSize: '0.9rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {message.media_path && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#38bdf8', marginBottom: '4px' }}>
                      {message.message_type === 'imageMessage' ? <ImageIcon size={14} /> : <FileText size={14} />}
                      Media attachment: {message.media_path}
                    </div>
                  )}
                  {message.content || <span style={{ color: 'var(--text-dim)' }}>[Message has no text content]</span>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <details className="glass-panel" style={{ padding: '18px 24px' }}>
        <summary style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 600 }}>
          <Terminal size={19} color="#06b6d4" /> System Console Logs
        </summary>
        <div style={{ marginTop: '14px', maxHeight: '300px', background: '#05070d', borderRadius: '12px', padding: '14px', border: '1px solid var(--border-color)', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: '1.6' }}>
          {logs.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>No browser-session logs yet.</span>
          ) : (
            logs.map((log, index) => (
              <div key={`${log.timestamp}-${index}`} style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>[{log.timestamp}]</span>
                <span style={{ color: log.message.includes('Error') || log.message.includes('❌') ? '#f87171' : log.message.includes('✅') ? '#4ade80' : '#d1d5db' }}>
                  {log.message}
                </span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </details>
    </div>
  );
}
