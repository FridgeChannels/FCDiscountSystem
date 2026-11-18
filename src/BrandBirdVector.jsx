export default function BrandBirdVector() {
  return (
    <svg
      className="fc-loading__bird-art"
      viewBox="0 0 440 360"
      role="presentation"
      aria-hidden="true"
    >
      <g className="fc-loading__tail">
        <path d="M139 220C87 185 59 194 45 220c33 20 64 26 99 16Z" fill="#F28B28" />
        <path d="M139 230c-39 2-61 19-66 42 31 8 57-1 80-23Z" fill="#FFD987" />
      </g>

      <g className="fc-loading__wing fc-loading__wing--left">
        <path d="M209 181c-49-68-145-95-179-56 27 57 98 95 179 77Z" fill="#E88720" />
        <path d="M176 161c-39-38-89-49-117-36 27 34 65 55 111 59Z" fill="#F6A331" opacity=".88" />
      </g>
      <g className="fc-loading__wing fc-loading__wing--right">
        <path d="M231 181c49-68 145-95 179-56-27 57-98 95-179 77Z" fill="#E88720" />
        <path d="M264 161c39-38 89-49 117-36-27 34-65 55-111 59Z" fill="#F6A331" opacity=".88" />
      </g>

      <g className="fc-loading__bird-body">
        <ellipse cx="220" cy="221" rx="100" ry="82" fill="#FFB331" />
        <ellipse cx="244" cy="239" rx="54" ry="58" fill="#FFDE91" />
        <ellipse cx="191" cy="298" rx="18" ry="7" fill="#FF6840" transform="rotate(-9 191 298)" />
        <ellipse cx="252" cy="298" rx="18" ry="7" fill="#FF6840" transform="rotate(9 252 298)" />
      </g>

      <g className="fc-loading__bird-head">
        <circle cx="260" cy="143" r="68" fill="#FFB331" />
        <ellipse cx="287" cy="151" rx="6.8" ry="9" fill="#28231F" className="fc-loading__eye fc-loading__eye--right" />
        <ellipse cx="253" cy="148" rx="6.8" ry="9" fill="#28231F" className="fc-loading__eye fc-loading__eye--left" />
        <circle cx="290" cy="146" r="2.5" fill="#FFFDF7" />
        <circle cx="256" cy="143" r="2.5" fill="#FFFDF7" />
        <path d="M326 144 378 158 329 183c-9-11-11-25-3-39Z" fill="#FF5D3A" />
        <path d="M292 189c-11 8-23 8-34 2" fill="none" stroke="#E88720" strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
