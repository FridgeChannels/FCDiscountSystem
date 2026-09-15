import ExperienceLoading from '../ExperienceLoading.jsx';

export default function ExperienceLoadingPreview() {
  const params = new URLSearchParams(window.location.search);
  const copy = params.get('copy');
  const logo = params.get('logo');
  const brand = params.get('brand');

  return (
    <>
      <ExperienceLoading
        detail={copy || undefined}
        logoUrl={logo || undefined}
        brandName={brand || undefined}
      />
      <aside className="fc-loading-preview-hint" aria-hidden="true">
        <strong>Loading preview</strong>
        <span>Styles: src/experience-loading.css</span>
        <span>Add ?copy=…&logo=…&brand=… to test</span>
      </aside>
    </>
  );
}
