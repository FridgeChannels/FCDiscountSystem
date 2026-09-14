import { useState } from 'react';
import ExperienceLoading from '../ExperienceLoading.jsx';

export default function ExperienceLoadingPreview() {
  const params = new URLSearchParams(window.location.search);
  const copy = params.get('copy');
  const [isSkipped, setIsSkipped] = useState(false);

  if (isSkipped) {
    return (
      <main className="fc-loading-preview-skipped" role="status">
        Loading preview skipped.
      </main>
    );
  }

  return (
    <>
      <ExperienceLoading detail={copy || undefined} onSkip={() => setIsSkipped(true)} />
      <aside className="fc-loading-preview-hint" aria-hidden="true">
        <strong>Loading preview</strong>
        <span>Styles: src/experience-loading.css</span>
        <span>Add ?copy=Your text to test copy</span>
      </aside>
    </>
  );
}
