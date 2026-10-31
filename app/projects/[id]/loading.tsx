// Shown at once while a project page loads, so moving between the sidebar's pages never feels stuck.
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading">
      <div className="skeleton" style={{ height: 14, width: 120, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 34, width: '55%', marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 16, width: '80%', marginBottom: 28 }} />
      <div className="skeleton" style={{ height: 120, marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </main>
  );
}
