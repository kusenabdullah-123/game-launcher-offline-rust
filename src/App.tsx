import { useState, useEffect } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

const EMPTY_FORM = {
  name: '', proton_path: '', exe_path: '', prefix_path: '',
  use_ace: false, use_ntsync: true, use_antilag: true,
};

export default function App() {
  const [games,       setGames]       = useState<any[]>([]);
  const [protonList,  setProtonList]  = useState<any[]>([]);
  const [protonRoot,  setProtonRoot]  = useState('');
  const [status,      setStatus]      = useState('Core Ready');
  const [statusOk,    setStatusOk]    = useState(true);
  const [gameStates,  setGameStates]  = useState<Record<string, string>>({});
  const [useGameMode, setUseGameMode] = useState(true);
  const [editingId,   setEditingId]   = useState<number | null>(null);
  const [form,        setForm]        = useState({ ...EMPTY_FORM });

  // ─── Init & Listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const config: any = await invoke('load_config');
      setProtonRoot(config.proton_root || '');
      setGames(config.games || []);
      if (config.proton_root) {
        const list: any = await invoke('scan_manual_proton', { basePath: config.proton_root });
        setProtonList(list);
      }
    })();

    // Event game tutup dari Rust
    const unlisten = listen('game-status', (e: any) => {
      const [name, st] = e.payload;
      setGameStates(p => ({ ...p, [name]: st }));
      if (st === 'READY') setStatus(`${name} closed`);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // ─── Helpers ───────────────────────────────────────────────────────────────
  const setOk  = (msg: string) => { setStatus(msg); setStatusOk(true); };
  const setErr = (msg: string) => { setStatus(msg); setStatusOk(false); };

  const scanProton = async () => {
    if (!protonRoot) return setErr('Isi Proton Root dulu');
    try {
      const list: any = await invoke('scan_manual_proton', { basePath: protonRoot });
      await invoke('save_config', { config: { proton_root: protonRoot, games } });
      setProtonList(list);
      setOk(`${list.length} versi Proton ditemukan`);
    } catch (e) {
      setErr(`Scan gagal: ${e}`);
    }
  };

  const startEdit = (game: any) => {
    setEditingId(game.id);
    setForm({
      name: game.name, proton_path: game.proton_path,
      exe_path: game.exe_path, prefix_path: game.prefix_path,
      use_ace: game.use_ace, use_ntsync: game.use_ntsync, use_antilag: game.use_antilag,
    });
    setOk(`Editing: ${game.name}`);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setOk('Ready');
  };

  const saveOrUpdate = async () => {
    if (!form.name || !form.exe_path || !form.proton_path)
      return setErr('⚠ Isi Title, EXE, dan Proton');

    const updated = editingId
      ? games.map(g => g.id === editingId ? { ...form, id: editingId } : g)
      : [...games, { ...form, id: Date.now() }];

    setGames(updated);
    await invoke('save_config', { config: { proton_root: protonRoot, games: updated } });
    setOk(editingId ? '✓ Game diupdate' : '✓ Game disimpan');
    cancelEdit();
  };

  // ─── Launch / Stop ─────────────────────────────────────────────────────────
  const handleLaunch = async (game: any) => {
    setGameStates(p => ({ ...p, [game.name]: 'LAUNCHING' }));
    setOk(`Launching ${game.name}...`);
    try {
      // await penting → error dari Rust akan tertangkap di catch
      await invoke('run_game', { game, useGamemode: useGameMode });
      setGameStates(p => ({ ...p, [game.name]: 'RUNNING' }));
      setOk(`🎮 Playing ${game.name}`);
    } catch (e: any) {
      setGameStates(p => ({ ...p, [game.name]: 'READY' }));
      setErr(`✗ Launch gagal: ${e}`);
    }
  };

  const handleStop = async (game: any) => {
    setGameStates(p => ({ ...p, [game.name]: 'READY' }));
    setOk(`Stopping ${game.name}...`);
    await invoke('kill_game', { name: game.name, prefixPath: game.prefix_path });
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={S.container}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; border:none; outline:none; }
        body { overflow:hidden; background:#020617; font-family:'Inter',sans-serif; color:#f8fafc; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:#3b82f622; border-radius:10px; }
        select { appearance:none; -webkit-appearance:none; background:#020617!important; color:#fff!important; }
        option { background:#0f172a; color:#fff; }
        button { transition: filter .15s; }
        button:hover { filter: brightness(1.15); }
        input, select { font-family: inherit; }
      `}</style>

      {/* ── Header ── */}
      <header style={S.header}>
        <div style={S.brand}>
          <div style={S.logo} />
          <h1 style={S.brandText}>CORE<span style={{color:'#60a5fa'}}>RUNNER</span></h1>
        </div>
        <div style={S.headerRight}>
          <div
            onClick={() => setUseGameMode(v => !v)}
            style={{...S.toggle, borderColor: useGameMode ? '#60a5fa' : '#334155'}}
          >
            <span style={{color: useGameMode ? '#60a5fa' : '#475569'}}>
              ⚡ GAMEMODE {useGameMode ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style={{...S.statusBadge, borderColor: statusOk ? '#334155' : '#7f1d1d', color: statusOk ? '#60a5fa' : '#fca5a5'}}>
            {status}
          </div>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={S.layout}>

        {/* ── Sidebar ── */}
        <aside style={S.sidebar}>

          {/* Proton Root Card */}
          <div style={S.card}>
            <p style={S.label}>PROTON ROOT DIR</p>
            <div style={S.row}>
              <input
                value={protonRoot}
                onInput={e => setProtonRoot(e.currentTarget.value)}
                placeholder="/home/user/Games/Proton"
                style={{...S.input, marginBottom:0, flex:1}}
              />
              <button onClick={scanProton} style={S.btnSec}>SCAN</button>
            </div>
            {protonList.length > 0 && (
              <div style={{marginTop:'8px', fontSize:'0.6rem', color:'#475569'}}>
                {protonList.length} versi: {protonList.map(p => p.name).join(', ')}
              </div>
            )}
          </div>

          {/* Game Form Card */}
          <div style={{...S.card, flex: 1}}>
            <p style={S.label}>{editingId ? '✏ EDIT GAME' : '＋ NEW GAME'}</p>

            <input
              placeholder="Game Title"
              value={form.name}
              onInput={e => setForm(f => ({...f, name: e.currentTarget.value}))}
              style={S.input}
            />

            <div style={{position:'relative', marginBottom:'10px'}}>
              <select
                value={form.proton_path}
                onChange={e => setForm(f => ({...f, proton_path: e.currentTarget.value}))}
                style={{...S.input, marginBottom:0}}
              >
                <option value="">— Pilih Proton —</option>
                {protonList.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
              </select>
              <span style={S.selectArrow}>▾</span>
            </div>

            <div style={S.row}>
              <button
                onClick={async () => { const r = await open(); if (r) setForm(f => ({...f, exe_path: r as string})); }}
                style={{...S.btnPick, color: form.exe_path ? '#10b981' : '#475569'}}
              >
                {form.exe_path ? '✓ EXE' : '📁 EXE'}
              </button>
              <button
                onClick={async () => { const r = await open({directory:true}); if (r) setForm(f => ({...f, prefix_path: r as string})); }}
                style={{...S.btnPick, color: form.prefix_path ? '#10b981' : '#475569'}}
              >
                {form.prefix_path ? '✓ PFX' : '📁 PFX'}
              </button>
            </div>

            <div style={S.checkStack}>
              <label style={S.checkRow}>
                <input type="checkbox" checked={form.use_ntsync}   onChange={e => setForm(f => ({...f, use_ntsync:   e.currentTarget.checked}))} />
                NTSync (kernel threading)
              </label>
              <label style={S.checkRow}>
                <input type="checkbox" checked={form.use_antilag}  onChange={e => setForm(f => ({...f, use_antilag:  e.currentTarget.checked}))} />
                AMD Anti-Lag+
              </label>
              <label style={S.checkRow}>
                <input type="checkbox" checked={form.use_ace}      onChange={e => setForm(f => ({...f, use_ace:      e.currentTarget.checked}))} />
                ACE / Online Fix
              </label>
            </div>

            <div style={S.row}>
              <button onClick={saveOrUpdate} style={{...S.btnPri, flex:2}}>
                {editingId ? 'UPDATE' : 'SAVE'}
              </button>
              {editingId && (
                <button onClick={cancelEdit} style={{...S.btnSec, flex:1}}>CANCEL</button>
              )}
            </div>
          </div>
        </aside>

        {/* ── Game List ── */}
        <main style={S.main}>
          <div style={S.tableCard}>
            <table style={{width:'100%', borderCollapse:'collapse'}}>
              <thead>
                <tr style={S.thead}>
                  <th style={{paddingLeft:'20px', textAlign:'left'}}>GAME</th>
                  <th style={{textAlign:'left'}}>MODE</th>
                  <th style={{paddingRight:'20px', textAlign:'right'}}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {games.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{textAlign:'center', padding:'50px', color:'#334155', fontSize:'0.8rem'}}>
                      Belum ada game. Tambah di sidebar kiri.
                    </td>
                  </tr>
                )}
                {games.map(g => {
                  const st = gameStates[g.name] || 'READY';
                  const isRunning  = st === 'RUNNING';
                  const isLaunching = st === 'LAUNCHING';
                  return (
                    <tr key={g.id} style={S.tr}>
                      <td style={{padding:'14px 20px'}}>
                        <div style={{fontWeight:'800', fontSize:'0.9rem'}}>{g.name}</div>
                        <div style={{
                          fontSize: '0.6rem', fontWeight: '600',
                          color: isRunning ? '#10b981' : isLaunching ? '#f59e0b' : '#334155',
                        }}>
                          {isLaunching ? '⏳ LAUNCHING' : isRunning ? '🎮 RUNNING' : '● READY'}
                        </div>
                      </td>
                      <td>
                        <div style={{display:'flex', gap:'4px', flexWrap:'wrap'}}>
                          {g.use_ace      && <span style={{...S.badge, color:'#f43f5e'}}>ACE</span>}
                          {g.use_ntsync   && <span style={S.badge}>NTS</span>}
                          {g.use_antilag  && <span style={{...S.badge, color:'#f59e0b'}}>LAG+</span>}
                        </div>
                      </td>
                      <td style={{paddingRight:'20px'}}>
                        <div style={{display:'flex', gap:'6px', justifyContent:'flex-end'}}>
                          {isRunning || isLaunching
                            ? <button onClick={() => handleStop(g)} style={S.btnStop}>■ STOP</button>
                            : <button onClick={() => handleLaunch(g)} style={S.btnLaunch}>▶ LAUNCH</button>
                          }
                          <button onClick={() => startEdit(g)} style={S.btnOpt}>EDIT</button>
                          <button
                            onClick={() => invoke('run_winetricks', { prefixPath: g.prefix_path })}
                            style={S.btnOpt}
                            title="Buka Winetricks"
                          >CFG</button>
                          <button
                            onClick={async () => {
                              const updated = games.filter(x => x.id !== g.id);
                              setGames(updated);
                              await invoke('save_config', { config: { proton_root: protonRoot, games: updated } });
                            }}
                            style={S.btnDel}
                            title="Hapus game"
                          >×</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S: any = {
  container:   { background:'#020617', color:'#f8fafc', height:'100vh', width:'100vw', userSelect:'none' },
  header:      { height:'60px', display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 24px', background:'rgba(15,23,42,0.9)', borderBottom:'1px solid #1e293b' },
  brand:       { display:'flex', alignItems:'center', gap:'10px' },
  logo:        { width:'10px', height:'22px', background:'#3b82f6', borderRadius:'3px', boxShadow:'0 0 12px #3b82f6' },
  brandText:   { fontSize:'1.1rem', fontWeight:'900', letterSpacing:'2px' },
  headerRight: { display:'flex', gap:'12px', alignItems:'center' },
  toggle:      { padding:'4px 12px', border:'1px solid', borderRadius:'20px', fontSize:'0.7rem', fontWeight:'700', cursor:'pointer' },
  statusBadge: { background:'#0f172a', padding:'4px 14px', borderRadius:'20px', fontSize:'0.68rem', border:'1px solid', transition:'color .3s, border-color .3s' },
  layout:      { display:'flex', height:'calc(100vh - 60px)', padding:'16px', gap:'16px' },
  sidebar:     { width:'300px', display:'flex', flexDirection:'column', gap:'12px', overflowY:'auto' },
  main:        { flex:1, overflowY:'auto' },
  card:        { background:'rgba(15,23,42,0.5)', border:'1px solid #1e293b', borderRadius:'14px', padding:'16px' },
  tableCard:   { background:'rgba(15,23,42,0.4)', border:'1px solid #1e293b', borderRadius:'18px', overflow:'hidden' },
  label:       { fontSize:'0.58rem', fontWeight:'900', color:'#475569', marginBottom:'10px', letterSpacing:'1.5px', display:'block' },
  input:       { width:'100%', padding:'10px 12px', background:'#020617', borderRadius:'8px', border:'1px solid #1e293b', color:'#f8fafc', fontSize:'0.8rem' },
  selectArrow: { position:'absolute', right:'12px', top:'50%', transform:'translateY(-50%)', fontSize:'0.6rem', color:'#475569', pointerEvents:'none' },
  row:         { display:'flex', gap:'8px', marginBottom:'10px' },
  btnPick:     { flex:1, padding:'10px', background:'none', border:'1px dashed #1e293b', borderRadius:'8px', fontSize:'0.7rem', cursor:'pointer', fontWeight:'600' },
  btnPri:      { padding:'12px', background:'#2563eb', color:'#fff', borderRadius:'8px', fontWeight:'800', cursor:'pointer', fontSize:'0.8rem' },
  btnSec:      { padding:'10px 14px', background:'#1e293b', color:'#94a3b8', borderRadius:'8px', fontSize:'0.7rem', cursor:'pointer', fontWeight:'600' },
  checkStack:  { display:'flex', flexDirection:'column', gap:'8px', marginBottom:'14px' },
  checkRow:    { display:'flex', alignItems:'center', gap:'8px', fontSize:'0.72rem', color:'#64748b', cursor:'pointer' },
  badge:       { background:'#1e293b', padding:'2px 6px', borderRadius:'4px', fontSize:'0.55rem', color:'#60a5fa', fontWeight:'800' },
  thead:       { background:'#0f172a44', height:'42px', color:'#334155', fontSize:'0.62rem', letterSpacing:'1px' },
  tr:          { borderBottom:'1px solid #0f172a' },
  btnLaunch:   { background:'#059669', color:'#fff', padding:'7px 16px', borderRadius:'7px', fontWeight:'700', cursor:'pointer', fontSize:'0.7rem' },
  btnStop:     { background:'#dc2626', color:'#fff', padding:'7px 16px', borderRadius:'7px', fontWeight:'700', cursor:'pointer', fontSize:'0.7rem' },
  btnOpt:      { background:'#1e293b', color:'#94a3b8', padding:'7px 10px', borderRadius:'7px', cursor:'pointer', fontSize:'0.7rem' },
  btnDel:      { background:'none', color:'#334155', cursor:'pointer', fontSize:'1.1rem', padding:'0 4px' },
};