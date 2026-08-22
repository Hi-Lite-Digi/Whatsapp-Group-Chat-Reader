import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

import Navbar from './components/Navbar.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import GroupsTab from './components/GroupsTab.jsx';
import SendMessageTab from './components/SendMessageTab.jsx';
import LiveFeedTab from './components/LiveFeedTab.jsx';
import ExtractionsTab from './components/ExtractionsTab.jsx';
import SchemasTab from './components/SchemasTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import QrModal from './components/QrModal.jsx';


const socket = io({ autoConnect: true });

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [connState, setConnState] = useState({ status: 'disconnected', qrDataUrl: null, user: null });
  const [groups, setGroups] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [settings, setSettings] = useState({});
  const [stats, setStats] = useState({ totalMessages: 0, totalExtractions: 0, activeGroups: 0, mediaCount: 0 });
  const [liveFeed, setLiveFeed] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showQrModal, setShowQrModal] = useState(false);

  useEffect(() => {
    socket.on('connection_status', (data) => {
      setConnState(data);
      if (data.status === 'connected') {
        setShowQrModal(false);
      }
    });

    socket.on('groups_updated', (data) => setGroups(data));
    socket.on('schemas_updated', (data) => setSchemas(data));
    socket.on('settings_updated', (data) => setSettings(data));
    socket.on('stats_updated', (data) => setStats(data));

    socket.on('extraction_result', (item) => {
      setLiveFeed(prev => [item, ...prev.slice(0, 49)]);
      fetchStats();
    });

    socket.on('log', (logObj) => {
      setLogs(prev => [...prev.slice(-199), logObj]);
    });

    // Initial REST fetches
    fetchInitialData();

    return () => {
      socket.off('connection_status');
      socket.off('groups_updated');
      socket.off('schemas_updated');
      socket.off('settings_updated');
      socket.off('stats_updated');
      socket.off('extraction_result');
      socket.off('log');
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const [resStatus, resGroups, resSchemas, resSettings, resStats] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/groups').then(r => r.json()),
        fetch('/api/schemas').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/stats').then(r => r.json())
      ]);
      setConnState(resStatus);
      setGroups(resGroups);
      setSchemas(resSchemas);
      setSettings(resSettings);
      setStats(resStats);
    } catch (err) {
      console.error('Error fetching initial dashboard data:', err);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch (e) {}
  };

  const handleConnect = async () => {
    setShowQrModal(true);
    await fetch('/api/whatsapp/connect', { method: 'POST' });
  };

  const handleRequestPairingCode = async (phoneNumber) => {
    try {
      const res = await fetch('/api/whatsapp/pairing-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber })
      });
      const data = await res.json();
      if (data.code) {
        setConnState(prev => ({ ...prev, pairingCode: data.code }));
      }
    } catch (err) {
      console.error('Error requesting pairing code:', err);
    }
  };

  const handleResetWhatsApp = async () => {
    await fetch('/api/whatsapp/reset', { method: 'POST' });
  };

  const handleLogout = async () => {
    await fetch('/api/whatsapp/logout', { method: 'POST' });
  };

  const handleSyncGroups = async () => {
    const res = await fetch('/api/groups/sync', { method: 'POST' });
    const data = await res.json();
    setGroups(data.groups || []);
  };

  const handleUpdateGroup = async (id, is_monitored, active_schema_id) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_monitored, active_schema_id })
    });
    const data = await res.json();
    if (data.groups) setGroups(data.groups);
    fetchStats();
  };

  const handleSaveSchema = async (schemaObj) => {
    const res = await fetch('/api/schemas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schemaObj)
    });
    const data = await res.json();
    if (data.schemas) setSchemas(data.schemas);
  };

  const handleDeleteSchema = async (id) => {
    const res = await fetch(`/api/schemas/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.schemas) setSchemas(data.schemas);
  };

  const handleSaveSettings = async (newSettings) => {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newSettings)
    });
    const data = await res.json();
    if (data.settings) setSettings(data.settings);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        connState={connState}
        onConnect={handleConnect}
        onLogout={handleLogout}
        onSyncGroups={handleSyncGroups}
      />

      <main style={{ flex: 1, maxWidth: '1400px', width: '100%', margin: '0 auto', padding: '24px' }}>
        {activeTab === 'overview' && (
          <OverviewTab
            stats={stats}
            connState={connState}
            settings={settings}
            recentExtractions={liveFeed}
            setActiveTab={setActiveTab}
          />
        )}
        {activeTab === 'groups' && (
          <GroupsTab
            groups={groups}
            schemas={schemas}
            onUpdateGroup={handleUpdateGroup}
            onSyncGroups={handleSyncGroups}
          />
        )}
        {activeTab === 'send_message' && (
          <SendMessageTab
            groups={groups}
            connState={connState}
          />
        )}
        {activeTab === 'live' && (
          <LiveFeedTab liveFeed={liveFeed} logs={logs} />
        )}
        {activeTab === 'extractions' && (
          <ExtractionsTab groups={groups} />
        )}
        {activeTab === 'schemas' && (
          <SchemasTab
            schemas={schemas}
            onSaveSchema={handleSaveSchema}
            onDeleteSchema={handleDeleteSchema}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab settings={settings} onSaveSettings={handleSaveSettings} />
        )}
      </main>

      {showQrModal && (
        <QrModal
          qrDataUrl={connState.qrDataUrl}
          onClose={() => setShowQrModal(false)}
          onReset={handleResetWhatsApp}
          onRequestPairingCode={handleRequestPairingCode}
          pairingCode={connState.pairingCode}
        />
      )}
    </div>
  );
}
