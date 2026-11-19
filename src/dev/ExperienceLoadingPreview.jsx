import ExperienceLoading from '../ExperienceLoading.jsx';
import { normalizeLogoUrl } from '../lib/brandTheme.js';

export default function ExperienceLoadingPreview() {
  const logoUrl = new URLSearchParams(window.location.search).get('logo');
  return <ExperienceLoading logoUrl={normalizeLogoUrl(logoUrl)} />;
}
