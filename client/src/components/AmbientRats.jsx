import '../ambient-rats.css';

/** Decoração sem interação. data-fx e reduced-motion interrompem todos os ciclos. */
export default function AmbientRats({ side = 'left' }) {
  return <div className={`rat-habitat rat-habitat--${side}`} aria-hidden="true">
    {['', 'is-small'].map(size => <div key={size} className={`ambient-rat ${size}`}>
      <div className="rat-facing"><div className="rat-silhouette">
        <i className="rat-frame rat-walk" />
        <i className="rat-frame rat-watch" />
        <i className="rat-frame rat-rise" />
        <i className="rat-frame rat-upright" />
      </div></div>
    </div>)}
  </div>;
}

