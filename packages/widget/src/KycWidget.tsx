import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './components/App.js';

export class KycWidget extends HTMLElement {
  private root?: Root;
  private mountEl?: HTMLDivElement;

  static get observedAttributes() {
    return ['session-token', 'api-base-url'];
  }

  connectedCallback() {
    this.mount();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = undefined;
  }

  attributeChangedCallback() {
    this.mount();
  }

  private mount(): void {
    const sessionToken = this.getAttribute('session-token');
    const apiBaseUrl = this.getAttribute('api-base-url') ?? 'http://localhost:3000';

    if (!this.mountEl) {
      this.mountEl = document.createElement('div');
      this.mountEl.className = 'kyc-widget-root';
      this.appendChild(this.mountEl);
    }

    if (!this.root) {
      this.root = createRoot(this.mountEl);
    }

    if (!sessionToken) {
      this.root.render(
        <div className="kyc-widget-root">
          <div className="kyc-container">
            <div className="kyc-body">
              <div className="kyc-error-banner">Missing session-token attribute.</div>
            </div>
          </div>
        </div>
      );
      return;
    }

    this.root.render(
      <App
        sessionToken={sessionToken}
        apiBaseUrl={apiBaseUrl}
        onComplete={(decision) => {
          this.dispatchEvent(new CustomEvent('kyc:complete', {
            bubbles: true,
            composed: true,
            detail: { decision },
          }));
        }}
        onError={(message) => {
          this.dispatchEvent(new CustomEvent('kyc:error', {
            bubbles: true,
            composed: true,
            detail: { message },
          }));
        }}
      />
    );
  }
}
