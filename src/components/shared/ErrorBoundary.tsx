import React, { Component, type ErrorInfo, type ReactNode } from 'react';

// src/components/shared/ErrorBoundary.tsx
// Catches render exceptions in child trees to prevent full-screen black canvas crashes.

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
    name?: string;
    resetKey?: unknown;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    public override state: ErrorBoundaryState = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    public override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null, errorInfo: null });
        }
    }

    public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}] Component error caught:`, error, errorInfo);
        this.setState({ errorInfo });
    }

    private handleReset = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    public override render(): ReactNode {
        if (this.state.hasError && this.state.error) {
            if (typeof this.props.fallback === 'function') {
                return this.props.fallback(this.state.error, this.handleReset);
            }
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return (
                <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-[var(--st-t2)]">
                    <span className="text-sm font-medium text-[var(--st-t1)]">组件发生错误</span>
                    <span className="mt-1 text-xs opacity-70">{this.state.error.message}</span>
                    {this.state.errorInfo?.componentStack && (
                        <pre className="mt-2 max-h-32 max-w-lg overflow-auto rounded bg-black/40 p-2 text-left font-mono text-[10px] text-zinc-300">
                            {this.state.errorInfo.componentStack}
                        </pre>
                    )}
                    <button
                        type="button"
                        onClick={this.handleReset}
                        className="mt-3 rounded-md bg-[var(--st-fill2)] px-3 py-1.5 text-xs text-[var(--st-t1)] hover:bg-[var(--st-fill)]"
                    >
                        重试
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
