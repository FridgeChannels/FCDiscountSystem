import { useState } from 'react';

function measureArtwork(image) {
  const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  const width = canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  let left = width, right = -1, top = height, bottom = -1;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (pixels[(row * width + column) * 4 + 3] < 6) continue;
      left = Math.min(left, column);
      right = Math.max(right, column);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }
  if (right < left) return null;
  left = Math.max(0, left - 1);
  top = Math.max(0, top - 1);
  return {
    left: left / width,
    top: top / height,
    width: (Math.min(width, right + 2) - left) / width,
    height: (Math.min(height, bottom + 2) - top) / height,
  };
}

export default function OfferWordmark({ src, onClick }) {
  const [frame, setFrame] = useState(null);
  const [failed, setFailed] = useState(false);
  function onLoad(event) {
    const image = event.currentTarget;
    let bounds;
    try {
      bounds = measureArtwork(image);
    } catch (error) {
      if (error.name !== 'SecurityError') throw error;
    }
    const box = bounds || { left: 0, top: 0, width: 1, height: 1 };
    setFrame({ ...box, ratio: image.naturalWidth * box.width / (image.naturalHeight * box.height) });
  }
  if (failed) return <h1 className="offers-heading" onClick={onClick}>Your offers</h1>;
  return (
    <div className="offers-wordmark" onClick={onClick} style={{ '--wordmark-ratio': frame?.ratio || 2.7 }}>
      <div className="offers-wordmark-frame">
        <img src={src} alt="" onLoad={onLoad} onError={() => setFailed(true)}
          style={frame ? { width: `${100 / frame.width}%`, transform: `translate(${-100 * frame.left}%, ${-100 * frame.top}%)` } : undefined} />
      </div>
    </div>
  );
}
