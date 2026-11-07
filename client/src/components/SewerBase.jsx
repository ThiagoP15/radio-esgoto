import canoRetoUrl from '../assets/art/cano-reto.webp';

// Linha central do cotovelo do cano
const PIPE = 'M22.5 0 V92 A24 24 0 0 0 46.5 116 H58.5 A24 24 0 0 1 82.5 140 V172';
const GRATE = { x: 174, y: 146 };

function Ring({ cx, cy, w = 43, h = 15 }) {
  // Anel de junta metálico escuro, fiel ao anel da textura cano-reto.webp
  return (
    <g>
      {/* Sombra projetada pelo anel no cano */}
      <rect x={cx - w / 2 + 1} y={cy - h / 2 + 2} width={w - 2} height={h} rx="2" fill="#050706" opacity=".75" />
      {/* Corpo do anel com gradiente horizontal cilíndrico */}
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx="2.5" fill="url(#sb-ring-metal)" stroke="#1a120b" strokeWidth="1.2" />
      {/* Linha de reflexo superior e inferior */}
      <line x1={cx - w / 2 + 2} y1={cy - h / 2 + 1.5} x2={cx + w / 2 - 2} y2={cy - h / 2 + 1.5} stroke="#f3c878" strokeOpacity=".45" strokeWidth="1" />
      <line x1={cx - w / 2 + 2} y1={cy + h / 2 - 1.5} x2={cx + w / 2 - 2} y2={cy + h / 2 - 1.5} stroke="#140d07" strokeOpacity=".8" strokeWidth="1.2" />
      {/* Parafusos/rebites com fenda igual ao cano-reto.webp */}
      {[-12, 12].map((dx) => (
        <g key={dx} transform={`translate(${cx + dx}, ${cy + 0.5})`}>
          <circle r="3.2" fill="#2a1a0d" />
          <circle r="2.6" fill="url(#sb-screw)" stroke="#1a0f07" strokeWidth=".6" />
          <line x1="-1.5" y1="1.2" x2="1.5" y2="-1.2" stroke="#2a1608" strokeWidth=".9" />
        </g>
      ))}
    </g>
  );
}

function Stream({ x, topW, bottomW, from, to, delay = 0 }) {
  const points = `M${x - topW / 2} ${from} L${x + topW / 2} ${from} L${x + bottomW / 2} ${to} L${x - bottomW / 2} ${to} Z`;
  return (
    <g>
      <path d={points} fill="url(#sb-water)" />
      {[-0.28, 0.05, 0.3].map((k, i) => (
        <line
          key={k}
          className="sb-flow"
          style={{ animationDelay: `${delay + i * 0.23}s`, animationDuration: `${0.85 + i * 0.12}s` }}
          x1={x + k * topW}
          y1={from + 2}
          x2={x + k * bottomW}
          y2={to - 2}
          stroke="#dcffe6"
          strokeOpacity=".6"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeDasharray="7 11"
        />
      ))}
    </g>
  );
}

export default function SewerBase() {
  return (
    <svg className="sewer-base" viewBox="0 0 244 320" preserveAspectRatio="xMinYMax meet" aria-hidden="true" focusable="false">
      <defs>
        {/* Textura real do cano para manter o mesmo grão de ferrugem escura */}
        <pattern id="sb-pipe-tex" patternUnits="userSpaceOnUse" width="45" height="146">
          <image href={canoRetoUrl} x="0" y="0" width="45" height="146" preserveAspectRatio="none" />
        </pattern>

        {/* Gradiente cilíndrico para os anéis de latão/cobre envelhecido */}
        <linearGradient id="sb-ring-metal" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#26170c" />
          <stop offset=".18" stopColor="#6e441f" />
          <stop offset=".42" stopColor="#c8873e" />
          <stop offset=".52" stopColor="#e6a856" />
          <stop offset=".68" stopColor="#854f22" />
          <stop offset=".88" stopColor="#3b2412" />
          <stop offset="1" stopColor="#1b1109" />
        </linearGradient>

        <linearGradient id="sb-screw" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e5a657" />
          <stop offset="1" stopColor="#633a16" />
        </linearGradient>

        {/* Aro da grade: cobre escuro oxidado, sem granulado artificial */}
        <radialGradient id="sb-grate-rim" cx="45%" cy="40%" r="55%">
          <stop offset="68%" stopColor="#1c1008" />
          <stop offset="78%" stopColor="#6e3918" />
          <stop offset="86%" stopColor="#b5682c" />
          <stop offset="93%" stopColor="#4f2911" />
          <stop offset="100%" stopColor="#180e07" />
        </radialGradient>

        <linearGradient id="sb-bar" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1c0f07" />
          <stop offset=".45" stopColor="#9e5624" />
          <stop offset=".6" stopColor="#c77738" />
          <stop offset="1" stopColor="#2b160a" />
        </linearGradient>

        <linearGradient id="sb-water" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7bd494" stopOpacity=".45" />
          <stop offset=".5" stopColor="#359457" stopOpacity=".92" />
          <stop offset="1" stopColor="#7bd494" stopOpacity=".45" />
        </linearGradient>

        <linearGradient id="sb-puddle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#285c3b" />
          <stop offset="1" stopColor="#0d1f15" />
        </linearGradient>

        <linearGradient id="sb-stone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4f5c4a" />
          <stop offset=".4" stopColor="#2d382b" />
          <stop offset="1" stopColor="#151b15" />
        </linearGradient>

        <clipPath id="sb-grate-clip">
          <circle cx={GRATE.x} cy={GRATE.y} r="35" />
        </clipPath>
      </defs>

      {/* Poça no chão */}
      <ellipse cx="122" cy="291" rx="119" ry="12" fill="url(#sb-puddle)" />
      <ellipse cx="122" cy="288" rx="108" ry="6.5" fill="#5ec27e" opacity=".14" />

      {/* Jatos de água animada */}
      <Stream x={82.5} topW={10} bottomW={15} from={180} to={289} />
      <Stream x={GRATE.x} topW={22} bottomW={14} from={186} to={289} delay={0.35} />

      {/* Ondas e gotas na poça */}
      {[82.5, GRATE.x].map((x, i) => (
        <g key={x}>
          <ellipse className="sb-ripple" style={{ animationDelay: `${i * 0.5}s` }} cx={x} cy="289" rx="24" ry="4.5" fill="none" stroke="#b8f0c8" strokeOpacity=".7" strokeWidth="1.1" />
          <ellipse className="sb-ripple" style={{ animationDelay: `${i * 0.5 + 0.9}s` }} cx={x} cy="289" rx="24" ry="4.5" fill="none" stroke="#b8f0c8" strokeOpacity=".7" strokeWidth="1.1" />
          <circle className="sb-drop" style={{ animationDelay: `${i * 0.3}s` }} cx={x - 13} cy="284" r="1.7" fill="#bff5cd" />
          <circle className="sb-drop" style={{ animationDelay: `${i * 0.3 + 0.4}s` }} cx={x + 13} cy="283" r="1.4" fill="#bff5cd" />
          <circle className="sb-drop" style={{ animationDelay: `${i * 0.3 + 0.7}s` }} cx={x + 6} cy="281" r="1.2" fill="#bff5cd" />
        </g>
      ))}

      {/* Grade redonda na parede de tijolos */}
      <circle cx={GRATE.x} cy={GRATE.y + 3} r="42" fill="#040605" opacity=".7" />
      <circle cx={GRATE.x} cy={GRATE.y} r="39" fill="#050807" />
      <g clipPath="url(#sb-grate-clip)">
        {/* Sombra interna profunda */}
        <circle cx={GRATE.x} cy={GRATE.y} r="36" fill="none" stroke="#000" strokeWidth="8" opacity=".8" />
        {[-24, -12, 0, 12, 24].map((dx) => (
          <rect key={dx} x={GRATE.x + dx - 2.2} y={GRATE.y - 40} width="4.4" height="80" fill="url(#sb-bar)" />
        ))}
      </g>
      {/* Aro metálico oxidado escuro */}
      <circle cx={GRATE.x} cy={GRATE.y} r="39" fill="none" stroke="url(#sb-grate-rim)" strokeWidth="10" />
      <circle cx={GRATE.x} cy={GRATE.y} r="44" fill="none" stroke="#120b06" strokeWidth="1.2" />
      <circle cx={GRATE.x} cy={GRATE.y} r="34" fill="none" stroke="#120b06" strokeWidth="1" />
      {Array.from({ length: 12 }, (_, i) => {
        const t = (i / 12) * Math.PI * 2;
        return (
          <circle
            key={i}
            cx={GRATE.x + 39 * Math.cos(t)}
            cy={GRATE.y + 39 * Math.sin(t)}
            r="1.8"
            fill="#b87e3d"
            stroke="#1f1208"
            strokeWidth=".7"
          />
        );
      })}
      {/* Musgo escuro integrado à paleta */}
      <path d="M137 124 q7-17 24-19 q9-1 17 0 q13 1 21 8 q7 6 12 15 q-9-5-17-5 q-6 3-12 1 q-8-3-14 1 q-8 2-13-1 q-11 2-18 0 q-4 1-1 0z" fill="#3a5923" opacity=".9" />
      <path d="M150 112 q10-7 22-6 q9 1 15 5 q-9-2-18-1 q-9 0-19 2z" fill="#557d32" opacity=".65" />

      {/* Cotovelo do cano: camadas cilíndricas escuras + textura real do cano */}
      <g>
        {/* Sombra externa projetada na parede */}
        <path d={PIPE} fill="none" stroke="#050706" strokeWidth="31" opacity=".7" />
        {/* Borda escura metálica */}
        <path d={PIPE} fill="none" stroke="#1c1109" strokeWidth="28" />
        {/* Base de cobre escuro */}
        <path d={PIPE} fill="none" stroke="#4a2812" strokeWidth="24" />
        {/* Meio-tom enferrujado */}
        <path d={PIPE} fill="none" stroke="#78421b" strokeWidth="16" />
        {/* Textura real do cano sobreposta para casar com o tubo vertical */}
        <path d={PIPE} fill="none" stroke="url(#sb-pipe-tex)" strokeWidth="25" opacity=".65" />
        {/* Reflexo especular central de cobre polido */}
        <path d={PIPE} fill="none" stroke="#c98038" strokeWidth="5" opacity=".55" />
        <path d={PIPE} fill="none" stroke="#f0b565" strokeWidth="1.5" opacity=".35" />
      </g>

      {/* Anéis de junção e bocal de saída */}
      <Ring cx={22.5} cy={2} />
      <Ring cx={82.5} cy={160} />
      <rect x="66" y="170" width="33" height="7" rx="2" fill="#21140b" stroke="#0d0804" strokeWidth="1" />
      <ellipse cx="82.5" cy="177" rx="13.5" ry="3" fill="#060403" />

      {/* Meio-fio de pedra na base */}
      <rect x="0" y="298" width="244" height="22" fill="url(#sb-stone)" />
      <rect x="0" y="298" width="244" height="2" fill="#697864" opacity=".45" />
      {[34, 88, 146, 204].map((x) => (
        <rect key={x} x={x} y="300" width="1.6" height="20" fill="#0e120e" opacity=".85" />
      ))}
    </svg>
  );
}