import React from 'react';
import { MessageSquare, LayoutDashboard, Users, MessageCircle, Activity, Database, FileCode, Settings, QrCode, RefreshCw, LogOut, Send, ArrowRightLeft } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, connState, onConnect, onLogout, onSyncGroups }) {
  const isConnected = connState.status === 'connected';
  const isQrReady = connState.status === 'qr_ready';

  return (
    <header style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(11, 15, 25, 0.8)', backdropFilter: 'blur(12px)', sticky: 'top', position: 'sticky', top: 0, zIndex: 50 }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: 'linear-gradient(135deg, #25d366 0%, #128c7e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(37, 211, 102, 0.4)' }}>
            <MessageSquare size={24} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', background: 'linear-gradient(to right, #ffffff, #9ca3af)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              WhatsApp Chat Reader
            </h1>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Selected Groups &amp; Direct Messages</span>
          </div>
        </div>

        {/* Status Indicator & Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', borderRadius: '20px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: isConnected ? '#25d366' : isQrReady ? '#f59e0b' : '#f43f5e', boxShadow: isConnected ? '0 0 10px #25d366' : 'none' }}></span>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, textTransform: 'capitalize' }}>
              {connState.status.replace('_', ' ')}
            </span>
          </div>

          {isQrReady && (
            <button className="btn btn-primary" onClick={onConnect}>
              <QrCode size={16} /> Scan QR Code
            </button>
          )}

          {!isConnected && !isQrReady && (
            <button className="btn btn-primary" onClick={onConnect}>
              <RefreshCw size={16} /> Connect WhatsApp
            </button>
          )}

          {isConnected && (
            <>
              <button className="btn btn-secondary" title="Sync Groups" onClick={onSyncGroups}>
                <RefreshCw size={16} /> Sync
              </button>
              <button className="btn btn-danger" title="Disconnect" onClick={onLogout}>
                <LogOut size={16} /> Logout
              </button>
            </>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 24px', display: 'flex', gap: '8px', overflowX: 'auto' }}>
        <TabButton id="overview" label="Overview" icon={<LayoutDashboard size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="groups" label="Monitored Groups" icon={<Users size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="oracle_sync" label="Quotation Sync" icon={<ArrowRightLeft size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="dms" label="Selected DMs" icon={<MessageCircle size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="send_message" label="Send Message" icon={<Send size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="live" label="Messages" icon={<Activity size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="extractions" label="Extraction Audit" icon={<Database size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="schemas" label="Extraction Schemas" icon={<FileCode size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
        <TabButton id="settings" label="LLM Settings" icon={<Settings size={18} />} activeTab={activeTab} setActiveTab={setActiveTab} />
      </div>
    </header>
  );
}


function TabButton({ id, label, icon, activeTab, setActiveTab }) {
  const active = activeTab === id;
  return (
    <button
      onClick={() => setActiveTab(id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '12px 16px',
        border: 'none',
        background: 'transparent',
        color: active ? '#25d366' : 'var(--text-muted)',
        borderBottom: active ? '2px solid #25d366' : '2px solid transparent',
        fontWeight: active ? 600 : 500,
        fontSize: '0.9rem',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        transition: 'all 0.2s'
      }}
    >
      {icon}
      {label}
    </button>
  );
}
