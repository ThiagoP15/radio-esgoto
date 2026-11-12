import AmbientRats from './AmbientRats.jsx';
/** Arte e movimento separados: a imagem mantém os materiais, o SVG anima a água. */
export default function SewerBase() {
  return (
    <div className="sewer-scene" aria-hidden="true">
      <div className="drain-art" />
      <svg className="sewer" viewBox="0 0 260 310" preserveAspectRatio="none" focusable="false" shapeRendering="crispEdges">
        {[[58, 184], [180, 152]].map(([x, y], i) => (
          <g key={x}>
            <path className="water-flow" d={`M${x - 2} ${y}v${284 - y}m4 -${284 - y}v${284 - y}`}
              stroke="#d1d6b5" opacity=".5" strokeWidth="1.3" strokeDasharray="4 10"
              style={{ animationDelay: `-${i * .4}s` }} />
            {[0, 1, 2].map(j => <rect key={j} className="falling-drop" x={x - 5 + j * 4} y={y + 4}
              width="1.5" height="3" fill="#e0d6a2" style={{ animationDelay: `-${j * .36 + i * .2}s` }} />)}
            <ellipse className="ripple" cx={x} cy="285" rx="20" ry="3.5" stroke="#c8d2b0" fill="none"
              strokeWidth="1" style={{ animationDelay: `-${i * .8}s` }} />
          </g>
        ))}
      </svg>
      <AmbientRats side="right" />
    </div>
  );
}

