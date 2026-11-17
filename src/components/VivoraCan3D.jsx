const CAN_ICON = '/rewards/vivora-sparkling-can-3d-v2.png';

export default function VivoraCan3D({ label = 'VIVORA Sparkling can' }) {
  return (
    <span className="vivora-can-3d" role="img" aria-label={label}>
      <img src={CAN_ICON} alt="" draggable="false" />
    </span>
  );
}
