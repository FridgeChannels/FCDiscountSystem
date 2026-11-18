import ExperienceLoading from '../ExperienceLoading.jsx';

export default function ExperienceLoadingPreview() {
  const logoUrl = new URLSearchParams(window.location.search).get('logo');
  return <ExperienceLoading logoUrl={logoUrl} />;
}
