import React from 'react';
import { MessageSquare, Database, Users, Image as ImageIcon, Cpu, ArrowRight, ShieldCheck } from 'lucide-react';

export default function OverviewTab({ stats, connState, settings, recentExtractions, setActiveTab }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      
      {/* Connection Banner if not connected */}
      {connState.status !== 'connected' && (
        <div className="glass-panel" style={{ padding: '20px', background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h3 style={{ color: '#fbbf24', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={20} /> WhatsApp Session Not Connected
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Scan the QR code with your WhatsApp app (Linked Devices) to start listening to group chats in real-time.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setActiveTab('groups')}>
            Manage Groups <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
        <MetricCard
          title="Captured Messages"
          value={stats.totalMessages || 0}
          subtitle="Real-time group messages"
          icon={<MessageSquare size={24} color="#25d366" />}
          gradient="linear-gradient(135deg, rgba(37, 211, 102, 0.15), rgba(18, 140, 126, 0.05))"
        />
        <MetricCard
          title="LLM Extractions"
          value={stats.totalExtractions || 0}
          subtitle="Structured JSON records"
          icon={<Database size={24} color="#06b6d4" />}
          gradient="linear-gradient(135deg, rgba(6, 182, 212, 0.15), rgba(14, 116, 144, 0.05))"
        />
        <MetricCard
          title="Monitored Groups"
          value={stats.activeGroups || 0}
          subtitle="Active WhatsApp readers"
          icon={<Users size={24} color="#8b5cf6" />}
          gradient="linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(109, 40, 217, 0.05))"
        />
        <MetricCard
          title="Media & Documents"
          value={stats.mediaCount || 0}
          subtitle="Images & text docs processed"
          icon={<ImageIcon size={24} color="#f59e0b" />}
          gradient="linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(180, 83, 9, 0.05))"
        />
      </div>

      {/* Active LLM Engine Panel */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Cpu size={22} color="#8b5cf6" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Active LLM Pipeline Config</h3>
          </div>
          <button className="btn btn-secondary" onClick={() => setActiveTab('settings')}>
            Configure Providers
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Provider</span>
            <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '4px', textTransform: 'capitalize', color: '#25d366' }}>
              {settings.llm_provider || 'gemini'}
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Model</span>
            <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '4px', color: '#38bdf8' }}>
              {settings.llm_model || 'gemini-2.0-flash'}
            </div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Media OCR / Vision</span>
            <div style={{ fontSize: '1rem', fontWeight: 600, marginTop: '4px', color: settings.auto_download_media !== 'false' ? '#4ade80' : '#f87171' }}>
              {settings.auto_download_media !== 'false' ? 'Enabled (Multimodal)' : 'Disabled'}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Activity Feed Preview */}
      <div className="glass-panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Recent Live Extractions</h3>
          <button className="btn btn-secondary" onClick={() => setActiveTab('live')}>
            View Full Live Stream <ArrowRight size={16} />
          </button>
        </div>

        {recentExtractions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
            No extractions captured yet. Connect WhatsApp and send a message to a monitored group!
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentExtractions.slice(0, 5).map((ext, idx) => (
              <div key={idx} style={{ background: 'rgba(0,0,0,0.25)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 600, color: '#ffffff' }}>{ext.message?.sender_name || 'Group Member'}</span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>in {ext.message?.group_name || 'Group'}</span>
                    <span className="badge badge-info">{ext.schema_id}</span>
                  </div>
                  <p style={{ marginTop: '6px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    "{ext.message?.content}"
                  </p>
                </div>
                <div style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', background: 'rgba(0,0,0,0.4)', padding: '10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', maxWidth: '400px', width: '100%', overflowX: 'auto' }}>
                  <pre>{JSON.stringify(ext.extracted_data, null, 2)}</pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, gradient }) {
  return (
    <div className="glass-panel" style={{ padding: '20px', background: gradient }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{title}</span>
        <div style={{ padding: '10px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)' }}>{icon}</div>
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, marginTop: '12px', letterSpacing: '-0.03em' }}>{value}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>{subtitle}</div>
    </div>
  );
}
