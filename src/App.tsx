// src/App.tsx
import { useState, useEffect } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

// Default state form
const EMPTY_FORM = {
  name: '', proton_path: '', exe_path: '', prefix_path: '',
  use_ace: false, use_ntsync: true, use_antilag: true, custom_env: '', launch_args: '',
};

// ─── Sub Components ──────────────────────────────────────────────────────────

// Dot indicator: hijau = ok, merah = error, abu = loading
const Dot = ({ ok, label }: { ok?: boolean; label: string }) => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
  }}>
    <div style={{
      width: '8px', height: '8px', borderRadius: '50%',
      background: ok === undefined ? '#334155' : ok ? '#10b981' : '#ef4444',
      boxShadow: ok ? '0 0 6px #10b981aa' : ok === false ? '0 0 6px #ef4444aa' : 'none',
      transition: 'background 0.3s, box-shadow 0.3s',
    }} />
    <span style={{ fontSize: '0.45rem', color: '#475569', fontWeight: '700', letterSpacing: '0.5px' }}>
      {label}
    </span>
  </div>
);

// Baris detail di health panel
const HealthRow = ({ label, ok, detail }: { label: string; ok?: boolean; detail: string }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 0', borderBottom: '1px solid #1e293b',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{
        width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
        background: ok === undefined ? '#334155' : ok ? '#10b981' : '#ef4444',
      }} />
      <span style={{ fontSize: '0.75rem', color: '#cbd5e1', fontWeight: '600' }}>{label}</span>
    </div>
    <span style={{
      fontSize: '0.65rem', color: ok ? '#64748b' : '#7f1d1d',
      maxWidth: '180px', textAlign: 'right', wordBreak: 'break-all',
    }}>
      {detail}
    </span>
  </div>
);

export default function App() {
  const [games, setGames] = useState<any[]>([]);
  const [protonList, setProtonList] = useState<any[]>([]);
  const [protonRoot, setProtonRoot] = useState('');
  
  // UI States
  const [status, setStatus] = useState('UMU Core Ready');
  const [statusOk, setStatusOk] = useState(true);
  const [gameStates, setGameStates] = useState<Record<string, string>>({});
  const [useGameMode, setUseGameMode] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [health, setHealth] = useState<{
    umu_ok: boolean; gamemode_ok: boolean;
    ntsync_ok: boolean; vulkan_ok: boolean;
    umu_version: string;
  } | null>(null);
  
  // Form State
  const [form, setForm] = useState({ ...EMPTY_FORM });

  // ─── Init & Listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      // Load Config saat startup
      const config: any = await invoke('load_config');
      setProtonRoot(config.proton_root || '');
      setGames(config.games || []);
      
      // Scan proton jika root sudah tersimpan
      if (config.proton_root) {
        try {
          const list: any = await invoke('scan_manual_proton', { basePath: config.proton_root });
          setProtonList(list);
        } catch (e) { console.error(e); }
      }

      // Health check saat startup (non-blocking)
      try {
        const h: any = await invoke('check_system_health');
        setHealth(h);
      } catch (e) { console.error('Health check failed:', e); }
    })();

    // Listener: Menerima sinyal dari Rust saat game mati sendiri
    const unlisten = listen('game-status', (e: any) => {
      const [name, st] = e.payload;
      setGameStates(p => ({ ...p, [name]: st }));
      if (st === 'READY') setStatus(`${name} process ended.`);
    });

    return () => { unlisten.then(f => f()); };
  }, []);

  // ─── Actions ───────────────────────────────────────────────────────────────
  
  const setMsg = (msg: string, isOk = true) => { setStatus(msg); setStatusOk(isOk); };

  const scanProton = async () => {
    if (!protonRoot) return setMsg('Set Proton Root first!', false);
    try {
      const list: any = await invoke('scan_manual_proton', { basePath: protonRoot });
      setProtonList(list);
      // Auto save root saat scan berhasil
      await invoke('save_config', { config: { proton_root: protonRoot, games } });
      setMsg(`Found ${list.length} Proton versions`);
    } catch (e) {
      setMsg(`Scan failed: ${e}`, false);
    }
  };

  const startEdit = (game: any) => {
    setEditingId(game.id);
    setForm({
      name: game.name, proton_path: game.proton_path,
      exe_path: game.exe_path, prefix_path: game.prefix_path,
      use_ace: game.use_ace, use_ntsync: game.use_ntsync, use_antilag: game.use_antilag,
      custom_env: game.custom_env || '', launch_args: game.launch_args || '',
    });
    setMsg(`Editing ${game.name}`);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setMsg('Ready');
  };

  const saveOrUpdate = async () => {
    if (!form.name || !form.exe_path || !form.proton_path) 
      return setMsg('Missing fields (Name/EXE/Proton)', false);

    const updated = editingId
      ? games.map(g => g.id === editingId ? { ...form, id: editingId } : g)
      : [...games, { ...form, id: Date.now() }];

    setGames(updated);
    await invoke('save_config', { config: { proton_root: protonRoot, games: updated } });
    setMsg(editingId ? 'Game updated' : 'Game saved');
    cancelEdit();
  };

  const handleLaunch = async (game: any) => {
    setGameStates(p => ({ ...p, [game.name]: 'LAUNCHING' }));
    setMsg(`Initializing UMU for ${game.name}...`);
    try {
      await invoke('run_game', { game, useGamemode: useGameMode });
      setGameStates(p => ({ ...p, [game.name]: 'RUNNING' }));
      setMsg(`Running ${game.name}`);
    } catch (e: any) {
      setGameStates(p => ({ ...p, [game.name]: 'READY' }));
      setMsg(`Launch Error: ${e}`, false);
    }
  };

  const handleStop = async (game: any) => {
    setGameStates(p => ({ ...p, [game.name]: 'READY' })); // Optimistic update
    setMsg(`Killing process for ${game.name}...`, false);
    await invoke('kill_game', { name: game.name, prefixPath: game.prefix_path });
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.container}>
      <style>{`
        * { box-sizing:border-box; margin:0; padding:0; border:none; outline:none; font-family:'Inter', sans-serif; }
        body { background:#020617; overflow:hidden; color:#f8fafc; }
        ::-webkit-scrollbar { width:5px; }
        ::-webkit-scrollbar-thumb { background:#334155; border-radius:10px; }
        button { transition: all 0.2s; }
        button:hover { filter: brightness(1.1); transform: translateY(-1px); }
        button:active { transform: translateY(0); }
        select { appearance: none; -webkit-appearance: none; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <header style={S.header}>
        <div style={S.brand}>
          <div style={S.logo} />
          <h1 style={S.brandText}>CORE<span style={{color:'#60a5fa'}}>RUNNER</span></h1>
        </div>
        <div style={S.headerRight}>

          {/* ── Health Dots ── */}
          <div
            onClick={() => setShowHealth(v => !v)}
            style={S.healthDots}
            title="System Health — klik untuk detail"
          >
            <Dot ok={health?.umu_ok}      label="UMU" />
            <Dot ok={health?.gamemode_ok} label="GM"  />
            <Dot ok={health?.ntsync_ok}   label="NTS" />
            <Dot ok={health?.vulkan_ok}   label="VLK" />
          </div>

          {/* ── GameMode Toggle ── */}
          <div onClick={() => setUseGameMode(v => !v)} style={{...S.toggle, borderColor: useGameMode ? '#3b82f6' : '#334155'}}>
            <span style={{color: useGameMode ? '#60a5fa' : '#475569'}}>⚡ GAMEMODE {useGameMode ? 'ON' : 'OFF'}</span>
          </div>

          {/* ── Status Badge ── */}
          <div style={{...S.statusBadge, color: statusOk ? '#10b981' : '#ef4444', borderColor: statusOk ? '#052e16' : '#450a0a'}}>
            {status}
          </div>
        </div>
      </header>

      {/* ── Health Panel Dropdown ── */}
      {showHealth && (
        <div style={S.healthPanel}>
          <div style={S.healthTitle}>🩺 SYSTEM HEALTH</div>

          <HealthRow
            label="umu-launcher"
            ok={health?.umu_ok}
            detail={health?.umu_version || 'not found'}
          />
          <HealthRow
            label="GameMode"
            ok={health?.gamemode_ok}
            detail={health?.gamemode_ok ? 'gamemoderun ready' : 'not installed'}
          />
          <HealthRow
            label="NTSync"
            ok={health?.ntsync_ok}
            detail={health?.ntsync_ok ? '/dev/ntsync active' : 'kernel module not loaded'}
          />
          <HealthRow
            label="Vulkan / GPU"
            ok={health?.vulkan_ok}
            detail={health?.vulkan_ok ? 'vulkaninfo OK' : 'vulkaninfo not found'}
          />

          <button
            onClick={async () => {
              setHealth(null);
              const h: any = await invoke('check_system_health');
              setHealth(h);
            }}
            style={S.healthRefresh}
          >
            ↻ Refresh
          </button>
        </div>
      )}

      <div style={S.layout}>
        {/* Sidebar */}
        <aside style={S.sidebar}>
          {/* Config Box */}
          <div style={S.card}>
            <p style={S.label}>PROTON DIRECTORY</p>
            <div style={S.row}>
              <input 
                value={protonRoot} 
                onInput={e => setProtonRoot(e.currentTarget.value)}
                placeholder="/home/user/Games/Proton"
                style={{...S.input, marginBottom:0, flex:1}} 
              />
              <button onClick={scanProton} style={{...S.btnSec, flexShrink:0}}>SCAN</button>
            </div>
            {protonList.length > 0 && <div style={S.subText}>{protonList.length} versions found</div>}
          </div>

          {/* Edit Box */}
          <div style={{...S.card, flex:1, display:'flex', flexDirection:'column'}}>
            <p style={S.label}>{editingId ? 'EDITING GAME' : 'ADD NEW GAME'}</p>
            
            <input 
              placeholder="Game Title" 
              value={form.name} 
              onInput={e => setForm({...form, name: e.currentTarget.value})} 
              style={S.input} 
            />

            <div style={{position:'relative', marginBottom:'10px'}}>
              <select 
                value={form.proton_path} 
                onChange={e => setForm({...form, proton_path: e.currentTarget.value})} 
                style={{...S.input, marginBottom:0, cursor:'pointer'}}
              >
                <option value="">Select Proton Version</option>
                {protonList.map(p => <option key={p.path} value={p.path} style={{background:'#0f172a'}}>{p.name}</option>)}
              </select>
              <div style={S.arrow}>▼</div>
            </div>

            <div style={S.row}>
              <button 
                onClick={async () => { const r = await open(); if(r) setForm({...form, exe_path: r as string}); }} 
                style={{...S.btnPick, color: form.exe_path ? '#10b981' : '#64748b'}}
              >
                {form.exe_path ? 'EXE OK' : 'SELECT EXE'}
              </button>
              <button 
                onClick={async () => { const r = await open({directory:true}); if(r) setForm({...form, prefix_path: r as string}); }} 
                style={{...S.btnPick, color: form.prefix_path ? '#10b981' : '#64748b'}}
              >
                {form.prefix_path ? 'PFX OK' : 'SELECT PFX'}
              </button>
            </div>

            <div style={S.checkStack}>
              <label style={S.checkRow} title="Aktifkan kernel threading (butuh kernel support)">
                <input type="checkbox" checked={form.use_ntsync} onChange={e => setForm({...form, use_ntsync: e.currentTarget.checked})} /> 
                Enable NTSync
              </label>
              <label style={S.checkRow}>
                <input type="checkbox" checked={form.use_antilag} onChange={e => setForm({...form, use_antilag: e.currentTarget.checked})} /> 
                AMD Anti-Lag+
              </label>
              <label style={S.checkRow}>
                <input type="checkbox" checked={form.use_ace} onChange={e => setForm({...form, use_ace: e.currentTarget.checked})} /> 
                ACE Online Fix
              </label>
            </div>

            <input 
              placeholder="Launch Args (e.g. -SkipBuildPatchPrereq)" 
              value={form.launch_args} 
              onInput={e => setForm({...form, launch_args: e.currentTarget.value})} 
              style={{...S.input, marginBottom:'8px'}} 
              title="Argumen untuk di-pass ke EXE, contoh: -windowed atau -SkipBuildPatchPrereq"
            />

            <textarea 
              placeholder="Custom Env (satu per baris)\nWINEDLLOVERRIDES=vcruntime140=n,b" 
              value={form.custom_env} 
              onInput={e => setForm({...form, custom_env: e.currentTarget.value})} 
              style={{...S.input, minHeight:'60px', resize:'vertical', fontSize:'0.75rem', fontFamily:'monospace'}}
              title="Gunakan untuk force load DLL c++ jika game bermasalah, misal: WINEDLLOVERRIDES=vcruntime140=n,b"
            />

            <div style={{marginTop:'auto', display:'flex', gap:'8px'}}>
              <button onClick={saveOrUpdate} style={{...S.btnPri, flex:2}}>{editingId ? 'UPDATE' : 'SAVE GAME'}</button>
              {editingId && <button onClick={cancelEdit} style={{...S.btnSec, flex:1}}>CANCEL</button>}
            </div>
          </div>
        </aside>

        {/* Main List */}
        <main style={S.main}>
          <div style={S.tableCard}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr style={S.thead}>
                  <th style={{paddingLeft:'24px', textAlign:'left'}}>GAME LIBRARY</th>
                  <th style={{width:'120px'}}>FLAGS</th>
                  <th style={{textAlign:'right', paddingRight:'24px'}}>CONTROLS</th>
                </tr>
              </thead>
              <tbody>
                {games.length === 0 && (
                  <tr><td colSpan={3} style={{padding:'40px', textAlign:'center', color:'#475569'}}>Library is empty. Add a game from the sidebar.</td></tr>
                )}
                {games.map(g => {
                  const state = gameStates[g.name] || 'READY';
                  return (
                    <tr key={g.id} style={S.tr}>
                      <td style={{padding: '16px 24px'}}>
                        <div style={{fontWeight:'800', fontSize:'0.95rem', letterSpacing:'0.5px'}}>{g.name}</div>
                        <div style={{
                          fontSize:'0.65rem', fontWeight:'bold', marginTop:'4px',
                          color: state === 'RUNNING' ? '#10b981' : state === 'LAUNCHING' ? '#f59e0b' : '#475569'
                        }}>
                          {state === 'LAUNCHING' ? '⚡ INITIALIZING UMU...' : state === 'RUNNING' ? '🎮 PLAYING' : '● READY TO LAUNCH'}
                        </div>
                      </td>
                      <td>
                        <div style={{display:'flex', gap:'4px', justifyContent:'center'}}>
                          {g.use_ntsync && <span style={S.badge}>NTS</span>}
                          {g.use_ace && <span style={{...S.badge, color:'#f43f5e'}}>ACE</span>}
                        </div>
                      </td>
                      <td style={{textAlign:'right', paddingRight:'24px'}}>
                        <div style={{display:'flex', gap:'8px', justifyContent:'flex-end'}}>
                          {state === 'RUNNING' || state === 'LAUNCHING' ? 
                            <button onClick={() => handleStop(g)} style={S.btnStop}>STOP</button> :
                            <button onClick={() => handleLaunch(g)} style={S.btnLaunch}>PLAY</button>
                          }
                          <button onClick={() => startEdit(g)} style={S.btnOpt}>EDIT</button>
                          <button onClick={() => invoke('run_winetricks', {prefixPath: g.prefix_path})} style={S.btnOpt} title="Config Wine">CFG</button>
                          <button onClick={async () => {
                            const exe = await open({ filters: [{ name: 'Executable', extensions: ['exe', 'msi', 'bat'] }] });
                            if(exe) {
                              const fileName = (exe as string).split(/[\\/]/).pop();
                              setMsg(`Running ${fileName}...`);
                              try {
                                await invoke('run_exe_in_prefix', { game: g, customExe: exe as string, useGamemode: useGameMode });
                                setMsg(`Started: ${fileName}`);
                              } catch(e) {
                                setMsg(`Failed to run exe: ${e}`, false);
                              }
                            }
                          }} style={S.btnOpt} title="Run EXE inside prefix (Installer/DLC/Mods)">EXE</button>
                          <button onClick={async () => {
                            const updated = games.filter(x => x.id !== g.id);
                            setGames(updated);
                            await invoke('save_config', { config: { proton_root: protonRoot, games: updated } });
                          }} style={S.btnDel}>×</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const S: any = {
  container: { height:'100vh', width:'100vw', display:'flex', flexDirection:'column' },
  header: { height:'64px', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 24px', background:'rgba(15, 23, 42, 0.95)', borderBottom:'1px solid #1e293b', position:'relative' },
  brand: { display:'flex', alignItems:'center', gap:'12px' },
  logo: { width:'14px', height:'24px', background:'#3b82f6', borderRadius:'3px', boxShadow:'0 0 15px #3b82f6' },
  brandText: { fontSize:'1.25rem', fontWeight:'900', letterSpacing:'1px' },
  headerRight: { display:'flex', gap:'16px', alignItems:'center' },
  toggle: { padding:'5px 12px', border:'1px solid', borderRadius:'6px', fontSize:'0.7rem', fontWeight:'700', cursor:'pointer' },
  statusBadge: { background:'#020617', padding:'5px 12px', borderRadius:'6px', fontSize:'0.7rem', fontWeight:'600', border:'1px solid' },
  layout: { display:'flex', flex:1, padding:'20px', gap:'20px', overflow:'hidden' },
  sidebar: { width:'320px', display:'flex', flexDirection:'column', gap:'16px' },
  main: { flex:1, overflowY:'auto' },
  card: { background:'rgba(30, 41, 59, 0.5)', border:'1px solid #334155', borderRadius:'12px', padding:'20px' },
  tableCard: { background:'rgba(15, 23, 42, 0.6)', border:'1px solid #334155', borderRadius:'16px', overflow:'hidden' },
  label: { fontSize:'0.65rem', fontWeight:'800', color:'#94a3b8', marginBottom:'12px', letterSpacing:'1px' },
  subText: { fontSize:'0.65rem', color:'#64748b', marginTop:'6px', textAlign:'right' },
  input: { width:'100%', padding:'12px', background:'#020617', borderRadius:'8px', border:'1px solid #334155', color:'#f1f5f9', marginBottom:'12px', fontSize:'0.85rem' },
  row: { display:'flex', gap:'8px' },
  arrow: { position:'absolute', right:'12px', top:'14px', fontSize:'0.65rem', color:'#64748b', pointerEvents:'none' },
  btnPick: { flex:1, padding:'10px', background:'#0f172a', border:'1px dashed #334155', borderRadius:'8px', fontSize:'0.75rem', fontWeight:'600', cursor:'pointer' },
  btnPri: { padding:'12px', background:'#2563eb', color:'#fff', borderRadius:'8px', fontWeight:'700', cursor:'pointer', fontSize:'0.85rem', boxShadow:'0 4px 12px rgba(37,99,235,0.3)' },
  btnSec: { padding:'10px', background:'#334155', color:'#f8fafc', borderRadius:'8px', fontSize:'0.75rem', fontWeight:'600', cursor:'pointer' },
  checkStack: { display:'flex', flexDirection:'column', gap:'10px', marginBottom:'20px', marginTop:'5px' },
  checkRow: { display:'flex', alignItems:'center', gap:'10px', fontSize:'0.8rem', color:'#cbd5e1', cursor:'pointer' },
  thead: { background:'#1e293b', height:'48px', color:'#94a3b8', fontSize:'0.7rem', textTransform:'uppercase', letterSpacing:'0.5px' },
  tr: { borderBottom:'1px solid #1e293b' },
  badge: { background:'#1e293b', padding:'3px 8px', borderRadius:'4px', fontSize:'0.6rem', color:'#60a5fa', fontWeight:'800', border:'1px solid #334155' },
  btnLaunch: { background:'#059669', color:'#fff', padding:'8px 20px', borderRadius:'6px', fontWeight:'700', cursor:'pointer', fontSize:'0.75rem', boxShadow:'0 0 10px rgba(5,150,105,0.2)' },
  btnStop: { background:'#dc2626', color:'#fff', padding:'8px 20px', borderRadius:'6px', fontWeight:'700', cursor:'pointer', fontSize:'0.75rem' },
  btnOpt: { background:'#334155', color:'#fff', padding:'8px 12px', borderRadius:'6px', cursor:'pointer', fontSize:'0.75rem', fontWeight:'600' },
  btnDel:         { background:'transparent', color:'#64748b', fontSize:'1.2rem', cursor:'pointer', padding:'0 8px' },

  // ── Health ────────────────────────────────────────────────────────────────
  healthDots:    { display:'flex', gap:'10px', alignItems:'flex-end', cursor:'pointer',
                   padding:'6px 12px', border:'1px solid #1e293b', borderRadius:'8px',
                   background:'rgba(15,23,42,0.8)' },
  healthPanel:   { position:'absolute', top:'68px', right:'24px', zIndex:999,
                   background:'#0f172a', border:'1px solid #334155', borderRadius:'14px',
                   padding:'20px', minWidth:'300px', boxShadow:'0 8px 40px rgba(0,0,0,0.6)',
                   animation:'fadeIn 0.15s ease' },
  healthTitle:   { fontSize:'0.6rem', fontWeight:'900', color:'#475569',
                   letterSpacing:'1.5px', marginBottom:'12px' },
  healthRefresh: { marginTop:'14px', width:'100%', padding:'8px',
                   background:'#1e293b', color:'#64748b', borderRadius:'8px',
                   fontSize:'0.72rem', cursor:'pointer', fontWeight:'600' },
};