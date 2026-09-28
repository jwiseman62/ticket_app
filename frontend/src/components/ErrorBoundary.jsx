import { Component } from 'react'

/**
 * Catches render-time errors anywhere below it.
 *
 * Without this, a single thrown error unmounts the entire React root and the
 * user just sees a white page with no explanation — and because the root is
 * gone, navigating elsewhere stays blank until a full reload.
 *
 * Must be a class component: React has no hook equivalent for
 * componentDidCatch.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Caught by ErrorBoundary:', error, info)
  }

  handleReset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="error-boundary">
        <div className="error-boundary-card">
          <div className="error-boundary-icon">⚠️</div>
          <h1 className="error-boundary-title">Something went wrong</h1>
          <p className="error-boundary-body">
            This page hit an unexpected error. The details are below and in your
            browser console.
          </p>

          <pre className="error-boundary-detail">{String(error?.message || error)}</pre>

          <div className="error-boundary-actions">
            <button className="btn btn-primary" onClick={this.handleReset}>
              Try again
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { window.location.href = '/' }}
            >
              Go to home page
            </button>
          </div>
        </div>
      </div>
    )
  }
}