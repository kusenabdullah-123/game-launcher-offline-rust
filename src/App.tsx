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
  const [useGameMode, setUseGameMode] = useState(true);

  // ID untuk melacak mode edit
  const [editingId, setEditingId] = useState<number | null>(null);

  const [form, setForm] = useState({
    name: '', proton_path: '', exe_path: '', prefix_path: '',
    use_ace: false, use_ntsync: true, use_antilag: true
  });

  useEffect(() => {
    const init = async () => {
      const config: any = await invoke('load_config');
      setProtonRoot(config.proton_root);
      if (config.proton_root) setProtonList(await invoke('scan_manual_proton', { basePath: config.proton_root }));
      setGames(config.games);
    };
    init();

    const unlisten = listen('game-status', (e: any) => {
      const [name, state] = e.payload;
      setGameStates(p => ({ ...p, [name]: state }));
    });
    return () => { unlisten.then(f => f()); };
  }, []);

  // Fungsi untuk melempar data ke form
  const startEdit = (game: any) => {
    setEditingId(game.id);
    setForm({
      name: game.name,
      proton_path: game.proton_path,
      exe_path: game.exe_path,
      prefix_path: game.prefix_path,
      use_ace: game.use_ace,
      use_ntsync: game.use_ntsync,
      use_antilag: game.use_antilag
    });
    setStatus(`Editing: ${game.name}`);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: '', proton_path: '', exe_path: '', prefix_path: '', use_ace: false, use_ntsync: true, use_antilag: true });
    setStatus("Ready");
  };

  const saveOrUpdateGame = async () => {
    if (!form.name || !form.exe_path || !form.proton_path) return setStatus("⚠️ Check Data");

    let updatedGames;
    if (editingId) {
      // UPDATE: Cari game berdasarkan ID dan ganti datanya
      updatedGames = games.map(g => g.id === editingId ? { ...form, id: editingId } : g);
      setStatus("✅ Game Updated");
    } else {
      // ADD NEW: Tambah ke list
      updatedGames = [...games, { ...form, id: Date.now() }];
      setStatus("✅ Game Added");
    }

    setGames(updatedGames);
    await invoke('save_config', { config: { proton_root: protonRoot, games: updatedGames } });
    cancelEdit(); // Reset form & ID
  };

  return (
    <div style={styles.container}>
      <style>{`
        :root { background: #020617; }
        * { box-sizing: border-box; margin: 0; padding: 0; outline: none; border: none; }
        body { overflow: hidden; background: #020617; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #3b82f644; border-radius: 10px; }
        select { appearance: none; -webkit-appearance: none; background: #0f172a !important; color: white !important; }
        option { background: #0f172a; color: white; padding: 10px; }
      `}</style>

      <header style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.logo}></div>
          <h1 style={styles.brandText}>CORE<span style={{ color: '#60a5fa' }}>RUNNER</span></h1>
        </div>
        <div style={styles.headerRight}>
          <div onClick={() => setUseGameMode(!useGameMode)} style={{ ...styles.gmToggle, borderColor: useGameMode ? '#60a5fa' : '#334155' }}>
            <span style={{ color: useGameMode ? '#60a5fa' : '#64748b' }}>⚡ GAMEMODE {useGameMode ? 'ON' : 'OFF'}</span>
          </div>
          <div style={styles.statusBadge}>{status}</div>
        </div>
      </header>

      <div style={styles.layout}>
        <aside style={styles.sidebar}>
          <div style={styles.card}>
            <p style={styles.label}>{editingId ? "EDITING MODE" : "NEW ENTRY"}</p>
            <input placeholder="Game Title" value={form.name} onInput={e => setForm({ ...form, name: e.currentTarget.value })} style={styles.input} />

            <div style={styles.selectContainer}>
              <select onChange={e => setForm({ ...form, proton_path: e.currentTarget.value })} value={form.proton_path} style={styles.input}>
                <option value="">Select Proton Version</option>
                {protonList.map(p => <option key={p.path} value={p.path}>{p.name}</option>)}
              </select>
              <div style={styles.arrow}>▼</div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
              <button onClick={async () => {
                const r = await open();
                if (r) setForm({ ...form, exe_path: r as string })
              }} style={styles.btnPick}>{form.exe_path ? 'EXE ✓' : 'EXE'}</button>

              <button onClick={async () => {
                const r = await open({ directory: true });
                if (r) setForm({ ...form, prefix_path: r as string })
              }} style={styles.btnPick}>{form.prefix_path ? 'PFX ✓' : 'PFX'}</button>
            </div>

            <p style={styles.label}>OPTIMIZATIONS</p>
            <div style={styles.checkStack}>
              <label style={styles.checkRow}><input type="checkbox" checked={form.use_ntsync} onChange={e => setForm({ ...form, use_ntsync: e.currentTarget.checked })} /> NTSync</label>
              <label style={styles.checkRow}><input type="checkbox" checked={form.use_antilag} onChange={e => setForm({ ...form, use_antilag: e.currentTarget.checked })} /> AMD Anti-Lag</label>
              <label style={styles.checkRow}><input type="checkbox" checked={form.use_ace} onChange={e => setForm({ ...form, use_ace: e.currentTarget.checked })} /> Online / ACE</label>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={saveOrUpdateGame} style={{ ...styles.btnPri, flex: 2 }}>
                {editingId ? "UPDATE GAME" : "SAVE TO CONFIG"}
              </button>
              {editingId && <button onClick={cancelEdit} style={{ ...styles.btnSec, flex: 1 }}>CANCEL</button>}
            </div>
          </div>
        </aside>

        <main style={styles.main}>
          <div style={styles.tableCard}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={styles.th}>
                  <th style={{ paddingLeft: '20px' }}>TITLE</th>
                  <th>SECURITY</th>
                  <th style={{ textAlign: 'right', paddingRight: '20px' }}>CONTROL</th>
                </tr>
              </thead>
              <tbody>
                {games.map(g => (
                  <tr key={g.id} style={styles.tr}>
                    <td style={{ padding: '15px 20px' }}>
                      <div style={{ fontWeight: '800', fontSize: '0.9rem' }}>{g.name}</div>
                      <div style={{ fontSize: '0.6rem', color: '#475569' }}>{gameStates[g.name] || 'READY'}</div>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.65rem', color: g.use_ace ? '#f43f5e' : '#10b981', fontWeight: 'bold' }}>
                        {g.use_ace ? '🛡️ ONLINE' : '🎮 OFFLINE'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', paddingRight: '20px' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        {gameStates[g.name] === 'RUNNING' ?
                          <button onClick={() => invoke('kill_game', { name: g.name })} style={styles.btnStop}>STOP</button> :
                          <button onClick={() => {
                            setGameStates(p => ({ ...p, [g.name]: 'LAUNCHING' }));
                            invoke('run_game', { game: g, useGamemode: useGameMode });
                            setGameStates(p => ({ ...p, [g.name]: 'RUNNING' }));
                          }} style={styles.btnLaunch}>LAUNCH</button>
                        }
                        <button onClick={() => startEdit(g)} style={styles.btnOpt}>EDIT</button>
                        <button onClick={() => invoke('run_winetricks', { prefixPath: g.prefix_path })} style={styles.btnOpt}>CFG</button>
                        <button onClick={async () => {
                          const updated = games.filter(x => x.id !== g.id);
                          setGames(updated);
                          await invoke('save_config', { config: { proton_root: protonRoot, games: updated } });
                        }} style={styles.btnDel}>×</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}

const styles: any = {
  container: { background: '#020617', color: '#f8fafc', height: '100vh', width: '100vw', userSelect: 'none', border: 'none' },
  header: { height: '70px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 30px', background: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid #1e293b' },
  brand: { display: 'flex', alignItems: 'center', gap: '12px' },
  logo: { width: '12px', height: '25px', background: '#3b82f6', borderRadius: '3px', boxShadow: '0 0 15px #3b82f6' },
  brandText: { fontSize: '1.2rem', fontWeight: '900', letterSpacing: '2px' },
  headerRight: { display: 'flex', gap: '15px', alignItems: 'center' },
  gmToggle: { padding: '5px 12px', border: '1px solid', borderRadius: '20px', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer', transition: '0.2s' },
  statusBadge: { background: '#1e293b', padding: '5px 15px', borderRadius: '20px', fontSize: '0.7rem', color: '#60a5fa', border: '1px solid #334155' },
  layout: { display: 'flex', height: 'calc(100vh - 70px)', padding: '20px' },
  sidebar: { width: '320px', display: 'flex', flexDirection: 'column', gap: '15px', paddingRight: '10px' },
  main: { flex: 1, overflowY: 'auto' },
  card: { background: 'rgba(15, 23, 42, 0.4)', border: '1px solid #1e293b', borderRadius: '15px', padding: '18px' },
  tableCard: { background: 'rgba(15, 23, 42, 0.4)', border: '1px solid #1e293b', borderRadius: '20px', overflow: 'hidden' },
  label: { fontSize: '0.6rem', fontWeight: '900', color: '#475569', marginBottom: '10px', letterSpacing: '1px' },
  input: { width: '100%', padding: '12px', background: '#020617', borderRadius: '10px', border: '1px solid #334155', color: '#fff', marginBottom: '10px', fontSize: '0.8rem', boxSizing: 'border-box' },
  selectContainer: { position: 'relative' },
  arrow: { position: 'absolute', right: '12px', top: '14px', fontSize: '0.6rem', color: '#475569', pointerEvents: 'none' },
  btnPick: { flex: 1, padding: '10px', background: 'none', border: '1px dashed #334155', borderRadius: '8px', color: '#64748b', fontSize: '0.7rem', cursor: 'pointer' },
  btnPri: { padding: '14px', background: '#2563eb', color: '#fff', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' },
  btnSec: { padding: '10px', background: '#1e293b', color: '#fff', borderRadius: '10px', fontSize: '0.7rem', cursor: 'pointer' },
  checkStack: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '15px' },
  checkRow: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.75rem', color: '#64748b', cursor: 'pointer' },
  tr: { borderBottom: '1px solid #1e293b' },
  th: { textAlign: 'left', background: '#1e293b33', height: '45px', color: '#475569', fontSize: '0.65rem' },
  btnLaunch: { background: '#10b981', color: '#fff', padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' },
  btnStop: { background: '#f43f5e', color: '#fff', padding: '8px 18px', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' },
  btnOpt: { background: '#334155', color: '#fff', padding: '8px 12px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.7rem' },
  btnDel: { background: 'none', color: '#475569', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }
};