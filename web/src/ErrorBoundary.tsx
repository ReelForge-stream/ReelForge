import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * If anything in the app crashes, show what happened and a way back instead of an empty page.
 * (Browser translators and some extensions rewrite page text, which can make React fail this way.)
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ReelForge] the page crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h1>Something went wrong</h1>
          <p className="muted">This page hit an error. Going back to Home usually fixes it, and nothing on your server was affected.</p>
          <div className="crash-actions">
            <button className="btn primary" onClick={() => location.assign('/reelforge/')}>Back to Home</button>
            <button className="btn ghost" onClick={() => location.reload()}>Reload</button>
          </div>
          <details>
            <summary>Error details</summary>
            <code>{error.message}</code>
          </details>
        </div>
      </div>
    );
  }
}
