export default function Offline() {
  return (
    <main className="offline">
      <h1>You’re offline.</h1>
      <p>Your payments are safe. Reconnect to see their latest status.</p>
      <a href="/" className="button primary">
        Try again
      </a>
    </main>
  );
}
