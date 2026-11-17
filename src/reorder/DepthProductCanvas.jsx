import { useEffect, useRef, useState } from 'react';

export default function DepthProductCanvas({
  cutoutUrl,
  depthUrl,
  scale = 1,
  className = 'depth-product-canvas',
  fallbackClassName = 'depth-product-canvas__fallback',
}) {
  const canvasRef = useRef(null);
  const pointerRef = useRef([0, 0]);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (!cutoutUrl || !depthUrl || !canvasRef.current) return undefined;
    let frame = 0;
    let alive = true;
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) { setFallback(true); return undefined; }
    setFallback(false);

    const loadImage = (url) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const vertexSource = `attribute vec2 aPosition; attribute vec2 aUv; uniform sampler2D uDepth; uniform vec2 uPointer; uniform float uScale; varying vec2 vUv; void main(){ float d=texture2D(uDepth,aUv).r; vec2 p=aPosition*uScale; p.x+=(d-.5)*uPointer.x*.055; p.y+=(d-.5)*uPointer.y*.04; gl_Position=vec4(p,d*.04,1.0); vUv=aUv; }`;
    const fragmentSource = `precision mediump float; uniform sampler2D uProduct; uniform sampler2D uDepth; varying vec2 vUv; void main(){ vec4 c=texture2D(uProduct,vUv); float dx=texture2D(uDepth,vUv+vec2(.006,0.0)).r-texture2D(uDepth,vUv-vec2(.006,0.0)).r; float dy=texture2D(uDepth,vUv+vec2(0.0,.006)).r-texture2D(uDepth,vUv-vec2(0.0,.006)).r; float light=clamp(1.0+(dx+dy)*.7, .88, 1.12); gl_FragColor=vec4(c.rgb*light,c.a); }`;
    const render = async () => {
      try {
        const [productImage, depthImage] = await Promise.all([loadImage(cutoutUrl), loadImage(depthUrl)]);
        if (!alive) return;
        const program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
        gl.useProgram(program);

        const columns = 48;
        const rows = 64;
        const vertices = [];
        const indices = [];
        const imageAspect = productImage.naturalWidth / productImage.naturalHeight;
        const stageAspect = canvas.clientWidth / canvas.clientHeight;
        const halfHeight = Math.min(.68, .66 * stageAspect / imageAspect);
        const halfWidth = halfHeight * imageAspect / stageAspect;
        for (let row = 0; row <= rows; row += 1) {
          for (let column = 0; column <= columns; column += 1) {
            const u = column / columns;
            const v = row / rows;
            vertices.push(-halfWidth + 2 * halfWidth * u, .02 + halfHeight - 2 * halfHeight * v, u, v);
          }
        }
        for (let row = 0; row < rows; row += 1) {
          for (let column = 0; column < columns; column += 1) {
            const a = row * (columns + 1) + column;
            const b = a + columns + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
          }
        }
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
        const indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
        const position = gl.getAttribLocation(program, 'aPosition');
        const uv = gl.getAttribLocation(program, 'aUv');
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(uv);
        gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);

        const makeTexture = (image, unit, uniformName) => {
          const texture = gl.createTexture();
          gl.activeTexture(gl.TEXTURE0 + unit);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          gl.uniform1i(gl.getUniformLocation(program, uniformName), unit);
        };
        makeTexture(productImage, 0, 'uProduct');
        makeTexture(depthImage, 1, 'uDepth');
        gl.uniform1f(gl.getUniformLocation(program, 'uScale'), scale);
        const pointerLocation = gl.getUniformLocation(program, 'uPointer');
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);
        const draw = () => {
          if (!alive) return;
          frame = requestAnimationFrame(draw);
          const rect = canvas.getBoundingClientRect();
          const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
          const width = Math.round(rect.width * ratio);
          const height = Math.round(rect.height * ratio);
          if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
          gl.viewport(0, 0, canvas.width, canvas.height);
          const target = pointerRef.current;
          draw.pointerX += (target[0] - draw.pointerX) * .12;
          draw.pointerY += (target[1] - draw.pointerY) * .12;
          gl.uniform2f(pointerLocation, draw.pointerX, draw.pointerY);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
        };
        draw.pointerX = 0;
        draw.pointerY = 0;
        draw();
      } catch {
        setFallback(true);
      }
    };
    render();
    return () => { alive = false; cancelAnimationFrame(frame); };
  }, [cutoutUrl, depthUrl, scale]);

  return (
    <>
      {fallback && <img className={fallbackClassName} src={cutoutUrl} alt="Prepared product cutout" />}
      <canvas
        ref={canvasRef}
        className={className}
        aria-label="Depth-mapped product preview"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          pointerRef.current = [((event.clientX - rect.left) / rect.width - .5) * 2, ((event.clientY - rect.top) / rect.height - .5) * 2];
        }}
        onPointerLeave={() => { pointerRef.current = [0, 0]; }}
      />
    </>
  );
}
