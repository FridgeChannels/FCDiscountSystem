import { DEV_SCENES, navigateToDevScene } from '../dev/index.js';

const btnStyle = {
  padding: '4px 7px',
  borderRadius: 6,
  border: 0,
  cursor: 'pointer',
  background: '#2a332a',
  color: '#e8f0e8',
  whiteSpace: 'nowrap',
};

const activeBtnStyle = {
  ...btnStyle,
  background: '#4f8a4a',
  color: '#fff',
};

export default function DevToolbar({ activeScene, onSelectScene, onResetFirstLogin }) {
  function selectScene(sceneId) {
    navigateToDevScene(sceneId);
    onSelectScene(sceneId);
  }

  function exitPreview() {
    navigateToDevScene('');
    onSelectScene('');
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: 10,
        right: 10,
        bottom: 10,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 10,
        background: 'rgba(16, 20, 16, 0.92)',
        font: '600 11px/1.2 sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ color: '#9fe1cb', letterSpacing: 1 }}>DEV</span>
        {activeScene ? (
          <span style={{ color: '#b8c7b8' }}>scene={activeScene}</span>
        ) : (
          <span style={{ color: '#7a8a7a' }}>live API</span>
        )}
        <button type="button" onClick={onResetFirstLogin} style={btnStyle}>
          First Login
        </button>
        {activeScene ? (
          <button type="button" onClick={exitPreview} style={btnStyle}>
            Exit Preview
          </button>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 5,
          overflowX: 'auto',
          paddingBottom: 2,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {DEV_SCENES.map((scene) => (
          <button
            key={scene.id}
            type="button"
            onClick={() => selectScene(scene.id)}
            style={activeScene === scene.id ? activeBtnStyle : btnStyle}
            title={`?scene=${scene.id}`}
          >
            {scene.label}
          </button>
        ))}
      </div>
    </div>
  );
}
