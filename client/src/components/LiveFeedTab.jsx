import React, { useRef, useEffect } from 'react';
import { Activity, Terminal, MessageSquare, Cpu, Image as ImageIcon, FileText } from 'lucide-react';

export default function LiveFeedTab({ liveFeed, logs }) {
  const logEndRef = useRef(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
      
      {/* Left Column: Live Extractions Feed */}
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: '500px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Activity size={22} color="#25d366" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Real-Time LLM Extractions Stream</h2>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '6px' }}>
          {liveFeed.length === 0 ? (
            <div style={{ textAlign: 'center', margin: 'auto', color: 'var(--text-muted)' }}>
              <MessageSquare size={36} color="var(--text-dim)" style={{ marginBottom: '8px' }} />
              <p>Waiting for incoming group chat messages...</p>
            </div>
          ) : (
            liveFeed.map((item, idx) => (
              <div key={idx} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#ffffff' }}>{item.message?.sender_name || 'Sender'}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '8px' }}>
                      in {item.message?.group_name || item.group_id}
                    </span>
                  </div>
                  <span className={item.extraction_status === 'success' ? 'badge badge-success' : 'badge badge-danger'}>
                    <Cpu size={12} /> {item.llm_provider}/{item.llm_model}
                  </span>
                </div>

                {/* Raw message text or media badge */}
                <div style={{ background: 'rgba(255,255,255,0.04)', padding: '10px 12px', borderRadius: '8px', fontSize: '0.88rem', marginBottom: '12px' }}>
                  {item.message?.media_path && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#38bdf8', marginBottom: '4px' }}>
                      {item.message?.message_type === 'imageMessage' ? <ImageIcon size={14} /> : <FileText size={14} />}
                      Media Attachment: {item.message?.media_path}
                    </div>
                  )}
                  "{item.message?.content}"
                </div>

                {/* Extracted JSON */}
                {item.extracted_data && (
                  <div style={{ background: '#090d16', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.82rem', fontFamily: 'var(--font-mono)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px' }}>
                      Schema: {item.schema_id}
                    </div>
                    <pre style={{ color: '#4ade80', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {JSON.stringify(item.extracted_data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Column: Console Log Output */}
      <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 220px)', minHeight: '500px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <Terminal size={22} color="#06b6d4" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>System Console Logs</h2>
        </div>

        <div style={{ flex: 1, background: '#05070d', borderRadius: '12px', padding: '14px', border: '1px solid var(--border-color)', overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', lineHeight: '1.6' }}>
          {logs.length === 0 ? (
            <span style={{ color: 'var(--text-dim)' }}>System initializing...</span>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px' }}>
                <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>[{log.timestamp}]</span>
                <span style={{ color: log.message.includes('Error') || log.message.includes('❌') ? '#f87171' : log.message.includes('✅') ? '#4ade80' : '#d1d5db' }}>
                  {log.message}
                </span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}
