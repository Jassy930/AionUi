import React from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import './RouteErrorBoundary.css';

type RouteErrorBoundaryProps = {
  children: React.ReactNode;
};

type RouteErrorBoundaryInnerProps = RouteErrorBoundaryProps & {
  errorTitle: string;
  reloadLabel: string;
};

type RouteErrorBoundaryState = {
  error: Error | null;
};

class RouteErrorBoundaryInner extends React.Component<RouteErrorBoundaryInnerProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Route render failed:', error);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div role='alert' className='route-error-boundary'>
        <div className='route-error-boundary__card'>
          <div className='route-error-boundary__title'>{this.props.errorTitle}</div>
          <pre className='route-error-boundary__message'>{this.state.error.message}</pre>
          <div className='route-error-boundary__actions'>
            <Button type='primary' onClick={() => window.location.reload()}>
              {this.props.reloadLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

const RouteErrorBoundary: React.FC<RouteErrorBoundaryProps> = ({ children }) => {
  const { t } = useTranslation();

  return (
    <RouteErrorBoundaryInner
      errorTitle={t('common.error', { defaultValue: 'Error' })}
      reloadLabel={t('common.reload', { defaultValue: 'Reload' })}
    >
      {children}
    </RouteErrorBoundaryInner>
  );
};

export default RouteErrorBoundary;
