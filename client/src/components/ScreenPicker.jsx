// Seletor de tela/janela (Electron): a lista vem do processo principal via preload.
export default function ScreenPicker({ sources, onPick }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Escolher o que compartilhar">
      <div className="modal">
        <h3>O que você quer compartilhar?</h3>
        <ul className="source-grid">
          {sources.map((source) => (
            <li key={source.id}>
              <button type="button" className="source" onClick={() => onPick(source.id)}>
                <img src={source.thumbnail} alt="" />
                <span>{source.name}</span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-secondary" onClick={() => onPick(null)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
