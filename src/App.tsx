import { useState, useEffect } from 'preact/hooks';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export default function App() {
  const [games, setGames] = useState<any[]>([]);
  const [protonList, setProtonList] = useState<any[]>([]);
  const [protonRoot, setProtonRoot] = useState("");
  const [status, setStatus] = useState('System Ready');

  const [form, setForm] = useState({
    name: '',
    proton_path: '',
    exe_path: '',
    prefix_path: ''
  });

  useEffect(() => {
    const startup = async () => {
      try {
        const config: any = await invoke('load_config');
        if (config.proton_root) {
          setProtonRoot(config.proton_root);
          const folders: any = await invoke('scan_manual_proton', { basePath: config.proton_root });
          setProtonList(folders);
        }
        setGames(config.games || []);
      } catch (e) {
        console.error("Failed to load config", e);
      }
    };
    startup();
  }, []);

  const syncConfig = async (updatedGames: any[], updatedRoot: string) => {
    try {
      await invoke('save_config', { config: { proton_root: updatedRoot, games: updatedGames } });
    } catch (e) {
      setStatus(`Save failed: ${e}`);
    }
  };

  const selectProtonFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      setProtonRoot(selected);
      try {
        const folders: any = await invoke('scan_manual_proton', { basePath: selected });
        setProtonList(folders);
        await syncConfig(games, selected);
        setStatus(`Found ${folders.length} Proton versions`);
      } catch (err) {
        setStatus(`Scan failed: ${err}`);
      }
    }
  };

  const pickFileOrFolder = async (key: string, isFolder = false) => {
    const selected = await open({ directory: isFolder, multiple: false });
    if (selected && typeof selected === 'string') {
      setForm(prev => ({ ...prev, [key]: selected }));
    }
  };

  const addGame = async () => {
    if (!form.name || !form.exe_path || !form.proton_path || !form.prefix_path) {
      return setStatus("Error: Complete all fields!");
    }
    const newGames = [...games, { ...form, id: Date.now() }];
    setGames(newGames);
    await syncConfig(newGames, protonRoot);
    setForm({ ...form, name: '', exe_path: '', proton_path: form.proton_path, prefix_path: '' });
    setStatus("Game added successfully");
  };

  const deleteGame = async (id: number) => {
    const updated = games.filter(g => g.id !== id);
    setGames(updated);
    await syncConfig(updated, protonRoot);
    setStatus("Game removed");
  };

  const handleWinetricks = async (prefix: string) => {
    try {
      setStatus("Launching Winetricks...");
      const res = await invoke('run_winetricks', { prefixPath: prefix });
      setStatus(res as string);
    } catch (err) {
      setStatus(`Error: ${err}`);
    }
  };

  return (
    <div style={containerStyle}>
      {/* Background Decor */}
      <div style={blobDecor1}></div>
      <div style={blobDecor2}></div>

      <header style={headerStyle}>
        <div style={logoWrapper}>
          <div style={logoIcon}>G</div>
          <h1 style={logoText}>CORE <span style={{ color: '#60a5fa' }}>RUNNER</span></h1>
        </div>
        <div style={statusWrapper}>
          <div style={pulseDot}></div>
          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>{status}</span>
        </div>
      </header>

      <main style={mainLayout}>
        {/* SIDEBAR */}
        <aside style={sidebarStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitle}>Proton Collection</h3>
            <button onClick={selectProtonFolder} style={btnSecondary}>
              {protonRoot ? `📁 ${protonRoot.split('/').pop()}` : "Select Master Folder"}
            </button>
            <p style={helperText}>Choose the folder where you store all Proton versions.</p>
          </div>

          <div style={cardStyle}>
            <h3 style={sectionTitle}>New Entry</h3>
            <div style={stack}>
              <input
                placeholder="Game Name"
                value={form.name}
                onInput={e => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
                style={inputStyle}
              />

              <select
                onChange={e => setForm({ ...form, proton_path: (e.target as HTMLSelectElement).value })}
                style={selectStyle}
                value={form.proton_path}
              >
                <option value="">Proton Version</option>
                {protonList.map(p => (
                  <option key={p.path} value={p.path}>{p.name}</option>
                ))}
              </select>

              <div style={row}>
                <button onClick={() => pickFileOrFolder('exe_path')} style={btnPicker}>
                  {form.exe_path ? "EXE ✓" : "EXE File"}
                </button>
                <button onClick={() => pickFileOrFolder('prefix_path', true)} style={btnPicker}>
                  {form.prefix_path ? "Prefix ✓" : "Prefix Dir"}
                </button>
              </div>

              <button onClick={addGame} style={btnAdd}>+ ADD TO LIBRARY</button>
            </div>
          </div>
        </aside>

        {/* CONTENT */}
        <section style={contentStyle}>
          <div style={cardStyle}>
            <h3 style={sectionTitle}>Game Library</h3>
            <div style={tableWrapper}>
              <table style={tableStyle}>
                <thead>
                  <tr style={thRowStyle}>
                    <th style={thStyle}>TITLE & PATH</th>
                    <th style={thStyle}>RUNNER</th>
                    <th style={thStyle}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map((g) => (
                    <tr key={g.id} style={trStyle} className="game-row">
                      <td style={tdStyle}>
                        <div style={gameTitle}>{g.name}</div>
                        <div style={gamePath}>{g.prefix_path}</div>
                      </td>
                      <td style={tdStyle}>
                        <span style={versionTag}>{g.proton_path.split('/').slice(-2, -1)}</span>
                      </td>
                      <td style={tdStyle}>
                        <div style={actionGroup}>
                          <button onClick={() => invoke('run_game', { game: g })} style={btnLaunch}>LAUNCH</button>
                          <button onClick={() => handleWinetricks(g.prefix_path)} style={btnConfig}>CONFIG</button>
                          <button onClick={() => invoke('kill_game', { name: g.name })} style={btnStop}>STOP</button>
                          <button onClick={() => deleteGame(g.id)} style={btnDelete}>×</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {games.length === 0 && <div style={emptyState}>Your library is empty. Add a game from the sidebar.</div>}
            </div>
          </div>
        </section>
      </main>

      {/* Global CSS for Animations */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(96, 165, 250, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(96, 165, 250, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(96, 165, 250, 0); }
        }
        .game-row { transition: all 0.2s ease-in-out; }
        .game-row:hover { background: rgba(255,255,255,0.03) !important; transform: translateX(5px); }
        button { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1) !important; }
        button:hover { filter: brightness(1.2); transform: translateY(-1px); }
        button:active { transform: translateY(0px); }
      `}</style>
    </div>
  );
}

// --- MODERN STYLES ---
const containerStyle: any = { 
  background: '#020617', 
  color: '#f8fafc', 
  minHeight: '100vh', 
  fontFamily: 'Inter, system-ui, sans-serif',
  position: 'relative',
  overflow: 'hidden'
};

const blobDecor1: any = {
  position: 'absolute', top: '-10%', left: '-5%', width: '400px', height: '400px',
  background: 'radial-gradient(circle, rgba(37, 99, 235, 0.15) 0%, rgba(0,0,0,0) 70%)',
  zIndex: 0, pointerEvents: 'none'
};

const blobDecor2: any = {
  position: 'absolute', bottom: '10%', right: '-5%', width: '500px', height: '500px',
  background: 'radial-gradient(circle, rgba(96, 165, 250, 0.1) 0%, rgba(0,0,0,0) 70%)',
  zIndex: 0, pointerEvents: 'none'
};

const headerStyle: any = { 
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
  padding: '20px 40px', background: 'rgba(15, 23, 42, 0.8)', 
  backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(255,255,255,0.05)',
  position: 'sticky', top: 0, zIndex: 10
};

const logoWrapper: any = { display: 'flex', alignItems: 'center', gap: '12px' };
const logoIcon: any = { 
  background: 'linear-gradient(135deg, #2563eb, #60a5fa)', width: '32px', height: '32px', 
  borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 'bold', fontSize: '1.2rem', boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
};
const logoText: any = { margin: 0, fontSize: '1.2rem', fontWeight: 800, letterSpacing: '2px' };

const statusWrapper: any = { 
  display: 'flex', alignItems: 'center', gap: '10px', 
  background: 'rgba(255,255,255,0.03)', padding: '6px 16px', borderRadius: '30px',
  border: '1px solid rgba(255,255,255,0.05)'
};
const pulseDot: any = { 
  width: '8px', height: '8px', background: '#60a5fa', borderRadius: '50%',
  animation: 'pulse 2s infinite'
};

const mainLayout: any = { display: 'flex', gap: '30px', padding: '30px', maxWidth: '1600px', margin: '0 auto', zIndex: 1, position: 'relative' };
const sidebarStyle: any = { flex: '0 0 320px', display: 'flex', flexDirection: 'column', gap: '24px' };
const contentStyle: any = { flex: '1' };

const cardStyle: any = { 
  background: 'rgba(30, 41, 59, 0.4)', padding: '24px', borderRadius: '20px', 
  border: '1px solid rgba(255,255,255,0.05)', backdropFilter: 'blur(5px)',
  boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
};

const sectionTitle: any = { marginTop: 0, marginBottom: '20px', fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '1px' };
const stack: any = { display: 'flex', flexDirection: 'column', gap: '12px' };
const row: any = { display: 'flex', gap: '10px' };

const inputStyle: any = { 
  padding: '12px 16px', background: 'rgba(15, 23, 42, 0.5)', border: '1px solid rgba(255,255,255,0.1)', 
  color: '#fff', borderRadius: '12px', outline: 'none', transition: 'border 0.3s'
};
const selectStyle: any = { ...inputStyle, cursor: 'pointer', appearance: 'none' };

const btnAdd: any = { 
  padding: '14px', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', 
  color: '#fff', border: 'none', borderRadius: '12px', fontWeight: 700, 
  cursor: 'pointer', marginTop: '10px', boxShadow: '0 4px 15px rgba(37, 99, 235, 0.2)'
};

const btnSecondary: any = { 
  width: '100%', padding: '12px', background: 'rgba(255,255,255,0.05)', 
  color: '#fff', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', borderRadius: '12px'
};

const btnPicker: any = { 
  flex: 1, padding: '10px', background: 'transparent', color: '#60a5fa', 
  border: '1px dashed #60a5fa', cursor: 'pointer', borderRadius: '12px', fontSize: '0.8rem'
};

const helperText: any = { fontSize: '0.7rem', color: '#64748b', marginTop: '10px', textAlign: 'center' };

const tableWrapper: any = { overflowX: 'auto' };
const tableStyle: any = { width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' };
const thRowStyle: any = { textAlign: 'left', background: 'transparent' };
const thStyle: any = { padding: '10px 20px', color: '#475569', fontSize: '0.7rem', fontWeight: 700 };

const trStyle: any = { background: 'rgba(255,255,255,0.02)', borderRadius: '15px' };
const tdStyle: any = { padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.02)' };

const gameTitle: any = { fontWeight: 600, fontSize: '1rem', color: '#f1f5f9' };
const gamePath: any = { fontSize: '0.65rem', color: '#64748b', marginTop: '4px', fontStyle: 'italic' };
const versionTag: any = { 
  background: 'rgba(96, 165, 250, 0.1)', padding: '4px 10px', borderRadius: '8px', 
  fontSize: '0.65rem', border: '1px solid rgba(96, 165, 250, 0.2)', color: '#60a5fa' 
};

const actionGroup: any = { display: 'flex', gap: '8px', alignItems: 'center' };
const btnLaunch: any = { background: '#10b981', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.75rem' };
const btnConfig: any = { background: '#475569', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.75rem' };
const btnStop: any = { background: '#ef4444', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '0.75rem' };
const btnDelete: any = { background: 'transparent', color: '#64748b', border: 'none', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '5px' };

const emptyState: any = { textAlign: 'center', padding: '60px', color: '#475569', fontSize: '0.9rem' };