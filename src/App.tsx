import { useState, useEffect } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

export default function App() {
  const [games, setGames] = useState<any[]>([]);
  const [protonList, setProtonList] = useState<any[]>([]);
  const [protonRoot, setProtonRoot] = useState("");
  const [status, setStatus] = useState('Core Ready');
  const [gameStates, setGameStates] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    name: '', proton_path: '', exe_path: '', prefix_path: '', use_ace: false
  });

  useEffect(() => {
    const init = async () => {
      const config: any = await invoke('load_config');
      if (config.proton_root) {
        setProtonRoot(config.proton_root);
        const folders: any = await invoke('scan_manual_proton', { basePath: config.proton_root });
        setProtonList(folders);
      }
      setGames(config.games || []);
    };
    init();

    const unlisten = listen('game-status', (event: any) => {
      const [name, newState] = event.payload;
      setGameStates(prev => ({ ...prev, [name]: newState }));
    });

    return () => { unlisten.then(f => f()); };
  }, []);

  const selectProtonRoot = async () => {
    const selected = await open({ directory: true });
    if (selected) {
      setProtonRoot(selected as string);
      const folders: any = await invoke('scan_manual_proton', { basePath: selected });
      setProtonList(folders);
      await invoke('save_config', { config: { proton_root: selected, games } });
    }
  };

  const pickFile = async (key: string, isFolder = false) => {
    const selected = await open({ directory: isFolder });
    if (selected) setForm(prev => ({ ...prev, [key]: selected }));
  };

  const addGame = async () => {
    if (!form.name || !form.exe_path || !form.prefix_path || !form.proton_path) return setStatus("⚠️ Incomplete!");
    const newGames = [...games, { ...form, id: Date.now() }];
    setGames(newGames);
    await invoke('save_config', { config: { proton_root: protonRoot, games: newGames } });
    setForm({ ...form, name: '', exe_path: '', prefix_path: '' });
    setStatus("✅ Added to library");
  };

  const handleLaunch = async (game: any) => {
    setGameStates(prev => ({ ...prev, [game.name]: "LAUNCHING" }));
    try {
      await invoke('run_game', { game });
      setGameStates(prev => ({ ...prev, [game.name]: "RUNNING" }));
    } catch (e) {
      setGameStates(prev => ({ ...prev, [game.name]: "READY" }));
      setStatus(`❌ Error: ${e}`);
    }
  };

  const uninstallGame = async (id: number) => {
    const updated = games.filter(g => g.id !== id);
    setGames(updated);
    await invoke('save_config', { config: { proton_root: protonRoot, games: updated } });
    setStatus("🗑️ Entry removed");
  };

  return (
    <div style={styles.container}>
      {/* GLOBAL RESET STYLE */}
      <style>{`
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #334155; borderRadius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #475569; }
        select { appearance: none; -webkit-appearance: none; }
        option { background-color: #0f172a !important; color: white !important; }
      `}</style>

      <header style={styles.header}>
        <div style={styles.logoRow}>
          <div style={styles.logoBadge}>C</div>
          <h2 style={{ margin: 0, letterSpacing: '1px', fontSize: '1.2rem' }}>CORE <span style={{ color: '#60a5fa' }}>RUNNER</span></h2>
        </div>
        <div style={styles.statusBox}>
          <div style={{ ...styles.dot, background: Object.values(gameStates).includes("RUNNING") ? '#10b981' : '#60a5fa' }} />
          <span style={{fontSize: '0.8rem'}}>{status}</span>
        </div>
      </header>

      <div style={styles.main}>
        <aside style={styles.sidebar}>
          <div style={styles.card}>
             <p style={styles.label}>ENVIRONMENT</p>
             <button onClick={selectProtonRoot} style={styles.btnSecondary}>
                {protonRoot ? `📁 ROOT DETECTED` : "Select Proton Root"}
             </button>
          </div>

          <div style={styles.card}>
            <p style={styles.label}>NEW ENTRY</p>
            <div style={styles.formStack}>
              <input 
                placeholder="Game Title" 
                value={form.name} 
                onInput={e => setForm({ ...form, name: (e.target as any).value })} 
                style={styles.input} 
              />
              
              <div style={styles.selectWrapper}>
                <select 
                  onChange={e => setForm({ ...form, proton_path: (e.target as any).value })} 
                  value={form.proton_path} 
                  style={styles.select}
                >
                  <option value="">Select Proton Version</option>
                  {protonList.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
                </select>
                <div style={styles.selectArrow}>▼</div>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => pickFile('exe_path')} style={styles.btnPicker}>{form.exe_path ? "EXE ✓" : "EXE"}</button>
                  <button onClick={() => pickFile('prefix_path', true)} style={styles.btnPicker}>{form.prefix_path ? "PRFX ✓" : "PFX"}</button>
              </div>

              <label style={styles.checkboxRow}>
                <input type="checkbox" checked={form.use_ace} onChange={e => setForm({ ...form, use_ace: (e.target as any).checked })} />
                <span>Enable ACE Anticheat</span>
              </label>

              <button onClick={addGame} style={styles.btnAdd}>SAVE CONFIG</button>
            </div>
          </div>
        </aside>

        <section style={styles.content}>
          <div style={{...styles.card, height: '100%', overflowY: 'auto'}}>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0 15px' }}>GAME LIBRARY</th>
                  <th>STATUS</th>
                  <th>CONTROLS</th>
                </tr>
              </thead>
              <tbody>
                {games.map(g => {
                  const currentState = gameStates[g.name] || "READY";
                  return (
                    <tr key={g.id} style={styles.tableRow}>
                      <td style={{ padding: '15px' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{g.name}</div>
                        <div style={{ fontSize: '0.6rem', color: '#475569', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {g.prefix_path}
                        </div>
                      </td>
                      <td>
                        <div style={{
                           padding: '4px 10px', 
                           borderRadius: '6px', 
                           fontSize: '0.6rem', 
                           display: 'inline-block',
                           background: currentState === "RUNNING" ? "#10b98122" : "#33415544",
                           color: currentState === "RUNNING" ? "#10b981" : currentState === "LAUNCHING" ? "#f59e0b" : "#94a3b8"
                        }}>
                          {currentState}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {currentState === "READY" ? (
                            <button onClick={() => handleLaunch(g)} style={styles.btnLaunch}>LAUNCH</button>
                          ) : currentState === "LAUNCHING" ? (
                            <button disabled style={{ ...styles.btnLaunch, opacity: 0.5 }}>WAIT</button>
                          ) : (
                            <button onClick={() => invoke('kill_game', { name: g.name })} style={styles.btnStop}>STOP</button>
                          )}
                          <button onClick={() => invoke('run_winetricks', { prefixPath: g.prefix_path })} style={styles.btnConfig}>CFG</button>
                          <button onClick={() => uninstallGame(g.id)} style={styles.btnUninstall}>×</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

const styles: any = {
  container: { background: '#020617', color: '#f8fafc', height: '100vh', width: '100vw', fontFamily: 'Inter, system-ui, sans-serif', overflow: 'hidden' },
  header: { display: 'flex', justifyContent: 'space-between', padding: '15px 30px', background: '#0f172a', borderBottom: '1px solid #1e293b' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  logoBadge: { background: '#2563eb', padding: '2px 10px', borderRadius: '4px', fontWeight: 'bold', fontSize: '0.9rem' },
  statusBox: { display: 'flex', alignItems: 'center', gap: '8px', background: '#1e293b', padding: '4px 12px', borderRadius: '20px', border: '1px solid #334155' },
  dot: { width: '6px', height: '6px', borderRadius: '50%' },
  main: { display: 'flex', gap: '20px', padding: '20px', height: 'calc(100vh - 65px)' },
  sidebar: { width: '300px', display: 'flex', flexDirection: 'column', gap: '15px' },
  content: { flex: 1, height: '100%' },
  card: { background: '#1e293b44', padding: '18px', borderRadius: '12px', border: '1px solid #334155' },
  formStack: { display: 'flex', flexDirection: 'column', gap: '10px' },
  
  // FIXED INPUT & SELECT
  input: { 
    width: '100%', padding: '10px 14px', background: '#0f172a', 
    border: '1px solid #334155', color: '#fff', borderRadius: '8px', 
    outline: 'none', fontSize: '0.85rem' 
  },
  selectWrapper: { position: 'relative', width: '100%' },
  select: { 
    width: '100%', padding: '10px 14px', background: '#0f172a', 
    border: '1px solid #334155', color: '#fff', borderRadius: '8px', 
    outline: 'none', cursor: 'pointer', fontSize: '0.85rem',
  },
  selectArrow: { 
    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', 
    fontSize: '0.6rem', color: '#64748b', pointerEvents: 'none' 
  },
  
  label: { fontSize: '0.6rem', color: '#64748b', fontWeight: '800', marginBottom: '8px', letterSpacing: '0.5px' },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer', userSelect: 'none' },
  btnAdd: { padding: '12px', background: '#2563eb', border: 'none', color: '#fff', fontWeight: 'bold', borderRadius: '8px', cursor: 'pointer', marginTop: '5px' },
  btnSecondary: { width: '100%', padding: '10px', background: '#334155', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem' },
  btnPicker: { flex: 1, padding: '8px', background: 'transparent', border: '1px dashed #475569', color: '#94a3b8', borderRadius: '8px', cursor: 'pointer', fontSize: '0.7rem' },
  
  // TABLE ACTIONS
  tableRow: { background: '#1e293b22' },
  btnLaunch: { background: '#10b981', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.7rem' },
  btnStop: { background: '#ef4444', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.7rem' },
  btnConfig: { background: '#475569', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.7rem' },
  btnUninstall: { background: 'transparent', color: '#ef4444', border: 'none', fontSize: '1rem', cursor: 'pointer', padding: '0 5px' }
};