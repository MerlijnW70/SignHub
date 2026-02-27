import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <h1>Something went wrong</h1>
          <p>An unexpected error occurred.</p>
          <div className="error-boundary-actions">
            <button onClick={() => this.setState({ hasError: false })}>Try Again</button>
            <button onClick={() => window.location.reload()}>Reload Page</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
