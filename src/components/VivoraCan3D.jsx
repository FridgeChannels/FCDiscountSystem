const CAN_ICON = '/rewards/vivora-sparkling-can-3d-v2.png';

export default function VivoraCan3D({ label = 'VIVORA Sparkling can', src = CAN_ICON }) {
  return (
    <span className="vivora-can-3d" role="img" aria-label={label}>
      <img src={src} alt="" draggable="false" />
    </span>
  );
}
