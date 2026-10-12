import { Component } from 'react';
import { t } from '../i18n/translate.js';

/** Keeps one broken page from blanking the whole app: shows a message with a way out instead. */
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('Page crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="banner danger" role="alert">
        <div>
          <strong>{t('Something went wrong on this page.')}</strong>
          <p className="small" style={{ margin: '4px 0 8px' }}>
            {t('Your data is safe. Try again, or open another page from the menu.')}
          </p>
          <button className="btn sm" onClick={() => this.setState({ error: null })}>
            {t('Try again')}
          </button>
        </div>
      </div>
    );
  }
}
