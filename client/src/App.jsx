import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';

import Navbar from './components/Navbar.jsx';
import OverviewTab from './components/OverviewTab.jsx';
import GroupsTab from './components/GroupsTab.jsx';
import DMsTab from './components/DMsTab.jsx';
import SendMessageTab from './components/SendMessageTab.jsx';
import LiveFeedTab from './components/LiveFeedTab.jsx';
import ExtractionsTab from './components/ExtractionsTab.jsx';
import SchemasTab from './components/SchemasTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import QrModal from './components/QrModal.jsx';
import OracleSyncTab from './components/OracleSyncTab.jsx';


const socket = io({ autoConnect: true });

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [connState, setConnState] = useState({ status: 'disconnected', qrDataUrl: null, user: null });
  const [groups, setGroups] = useState([]);
  const [dms, setDms] = useState([]);
  const [schemas, setSchemas] = useState([]);
  const [settings, setSettings] = useState({});
  const [stats, setStats] = useState({ totalMessages: 0, totalExtractions: 0, activeGroups: 0, activeDms: 0, mediaCount: 0 });
  const [liveMessages, setLiveMessages] = useState([]);
  const [liveFeed, setLiveFeed] = useState([]);
  const [logs, setLogs] = useState([]);
  const [showQrModal, setShowQrModal] = useState(false);
  const [oracleStatus, setOracleStatus] = useState({ configured: false, connected: false, suppliers: [], error: null });
  const [oracleEvents, setOracleEvents] = useState([]);
  const [oracleRuns, setOracleRuns] = useState([]);
  const [oracleCases, setOracleCases] = useState([]);

  useEffect(() => {
    socket.on('connection_status', (data) => {
      setConnState(data);
      if (data.status === 'connected') {
        setShowQrModal(false);
      }
    });

    socket.on('groups_updated', (data) => setGroups(data));
    socket.on('dms_updated', (data) => setDms(data));
    socket.on('schemas_updated', (data) => setSchemas(data));
    socket.on('settings_updated', (data) => setSettings(data));
    socket.on('stats_updated', (data) => setStats(data));

    socket.on('new_message', (message) => {
      setLiveMessages(previous => [message, ...previous.filter(item => item.wa_message_id !== message.wa_message_id)].slice(0, 100));
      fetchStats();
    });

    socket.on('extraction_result', (item) => {
      setLiveFeed(prev => [item, ...prev.slice(0, 49)]);
      fetchStats();
    });

    socket.on('oracle_sync_result', (item) => {
      setOracleEvents(previous => [item, ...previous.filter(event => event.id !== item.id)].slice(0, 100));
    });

    socket.on('oracle_run_result', (item) => {
      setOracleRuns(previous => [item, ...previous.filter(run => run.id !== item.id)].slice(0, 100));
    });

    socket.on('oracle_case_result', (item) => {
      if (!item) return;
      setOracleCases(previous => [item, ...previous.filter(caseItem => caseItem.id !== item.id)].slice(0, 100));
    });

    socket.on('oracle_syncs_updated', (items) => setOracleEvents(items));
    socket.on('oracle_cases_updated', (items) => setOracleCases(items));

    socket.on('log', (logObj) => {
      setLogs(prev => [...prev.slice(-199), logObj]);
    });

    // Initial REST fetches
    fetchInitialData();

    return () => {
      socket.off('connection_status');
      socket.off('groups_updated');
      socket.off('dms_updated');
      socket.off('schemas_updated');
      socket.off('settings_updated');
      socket.off('stats_updated');
      socket.off('new_message');
      socket.off('extraction_result');
      socket.off('oracle_sync_result');
      socket.off('oracle_run_result');
      socket.off('oracle_case_result');
      socket.off('oracle_syncs_updated');
      socket.off('oracle_cases_updated');
      socket.off('log');
    };
  }, []);

  const fetchInitialData = async () => {
    try {
      const [resStatus, resGroups, resDms, resSchemas, resSettings, resStats, resOracleStatus, resOracleEvents, resOracleRuns, resOracleCases] = await Promise.all([
        fetch('/api/status').then(r => r.json()),
        fetch('/api/groups').then(r => r.json()),
        fetch('/api/dms').then(r => r.json()),
        fetch('/api/schemas').then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch('/api/stats').then(r => r.json()),
        fetch('/api/oracle/status').then(r => r.json()),
        fetch('/api/oracle/syncs?limit=100').then(r => r.json()),
        fetch('/api/oracle/runs?limit=100').then(r => r.json()),
        fetch('/api/oracle/cases?limit=100').then(r => r.json())
      ]);
      setConnState(resStatus);
      setGroups(resGroups);
      setDms(resDms);
      setSchemas(resSchemas);
      setSettings(resSettings);
      setStats(resStats);
      setOracleStatus(resOracleStatus);
      setOracleEvents(resOracleEvents);
      setOracleRuns(resOracleRuns);
      setOracleCases(resOracleCases);
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
    if (connState.status !== 'qr_ready') {
      await fetch('/api/whatsapp/connect', { method: 'POST' });
    }
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

  const handleReplaceWhatsApp = async () => {
    const response = await fetch('/api/whatsapp/reset', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to replace the WhatsApp account');
    setShowQrModal(true);
    return data;
  };

  const handleLogout = async () => {
    await fetch('/api/whatsapp/logout', { method: 'POST' });
  };

  const handleSyncGroups = async () => {
    const res = await fetch('/api/groups/sync', { method: 'POST' });
    const data = await res.json();
    setGroups(data.groups || []);
  };

  const handleUpdateGroup = async (
    id,
    is_monitored,
    active_schema_id,
    oracle_sync_enabled = false,
    oracle_supplier_code = '',
    oracle_supplier_sender_ids = ''
  ) => {
    const res = await fetch(`/api/groups/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        is_monitored,
        active_schema_id,
        oracle_sync_enabled,
        oracle_supplier_code,
        oracle_supplier_sender_ids
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to update group');
    if (data.groups) setGroups(data.groups);
    fetchStats();
    return data;
  };

  const handleRequestGroupHistory = async (id) => {
    const response = await fetch(`/api/groups/${encodeURIComponent(id)}/history`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to request group history');
    return data;
  };

  const handleUpdateDm = async (id, is_monitored) => {
    const res = await fetch(`/api/dms/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_monitored })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to update DM monitoring');
    if (data.dms) setDms(data.dms);
    await fetchStats();
    return data;
  };

  const handleAddDm = async (phoneNumber, name) => {
    const res = await fetch('/api/dms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, name })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to add this DM');
    if (data.dms) setDms(data.dms);
    return data;
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
    if (!res.ok) throw new Error(data.error || 'Unable to save settings');
    return data;
  };

  const handleTestOracle = async () => {
    const response = await fetch('/api/oracle/test', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Oracle connection test failed');
    const statusResponse = await fetch('/api/oracle/status');
    setOracleStatus(await statusResponse.json());
    return data;
  };

  const handlePublishOracleEvent = async (id) => {
    const response = await fetch(`/api/oracle/syncs/${id}/publish`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to publish quotation');
    setOracleEvents(previous => previous.map(event => event.id === data.event.id ? data.event : event));
    return data;
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
            oracleSuppliers={oracleStatus.suppliers || []}
            onUpdateGroup={handleUpdateGroup}
            onSyncGroups={handleSyncGroups}
            onRequestHistory={handleRequestGroupHistory}
          />
        )}
        {activeTab === 'oracle_sync' && (
          <OracleSyncTab
            connState={connState}
            groups={groups}
            oracleStatus={oracleStatus}
            oracleEvents={oracleEvents}
            oracleRuns={oracleRuns}
            oracleCases={oracleCases}
            settings={settings}
            onConnect={handleConnect}
            onReplaceAccount={handleReplaceWhatsApp}
            onTestOracle={handleTestOracle}
            onSaveSettings={handleSaveSettings}
            onPublishEvent={handlePublishOracleEvent}
          />
        )}
        {activeTab === 'dms' && (
          <DMsTab dms={dms} onAddDm={handleAddDm} onUpdateDm={handleUpdateDm} />
        )}
        {activeTab === 'send_message' && (
          <SendMessageTab
            groups={groups}
            connState={connState}
          />
        )}
        {activeTab === 'live' && (
          <LiveFeedTab
            liveMessages={liveMessages}
            logs={logs}
            chats={[
              ...groups.filter(group => group.is_monitored).map(group => ({ ...group, chat_type: 'group' })),
              ...dms.filter(dm => dm.is_monitored).map(dm => ({ ...dm, chat_type: 'dm' }))
            ]}
          />
        )}
        {activeTab === 'extractions' && (
          <ExtractionsTab
            chats={[
              ...groups.map(group => ({ ...group, chat_type: 'group' })),
              ...dms.map(dm => ({ ...dm, chat_type: 'dm' }))
            ]}
          />
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
