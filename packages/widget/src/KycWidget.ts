import { SessionClient } from './api/sessionClient.js';
import { StepManager } from './steps/StepManager.js';
import baseCSS from './styles/base.css?inline';

export class KycWidget extends HTMLElement {
  private shadow: ShadowRoot;
  private stepManager?: StepManager;

  static get observedAttributes() {
    return ['session-token', 'api-base-url'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.mount();
  }

  attributeChangedCallback() {
    this.mount();
  }

  private mount(): void {
    const sessionToken = this.getAttribute('session-token');
    const apiBaseUrl = this.getAttribute('api-base-url') ?? 'http://localhost:3000';

    if (!sessionToken) {
      this.shadow.innerHTML = `<style>${baseCSS}</style><div class="widget-container"><div class="widget-body"><div class="error-banner">Missing session-token attribute.</div></div></div>`;
      return;
    }

    const style = document.createElement('style');
    style.textContent = baseCSS;

    const container = document.createElement('div');
    container.className = 'widget-container';

    const body = document.createElement('div');
    body.className = 'widget-body';
    container.appendChild(body);

    this.shadow.innerHTML = '';
    this.shadow.appendChild(style);
    this.shadow.appendChild(container);

    const client = new SessionClient(sessionToken, apiBaseUrl);

    this.stepManager = new StepManager({
      client,
      container: body,
      onComplete: (decision) => {
        this.dispatchEvent(new CustomEvent('kyc:complete', {
          bubbles: true,
          composed: true,
          detail: { decision },
        }));
      },
      onError: (error) => {
        this.dispatchEvent(new CustomEvent('kyc:error', {
          bubbles: true,
          composed: true,
          detail: { message: error.message },
        }));
      },
      advance: () => this.stepManager?.advance(),
      showError: (msg) => {
        const banner = document.createElement('div');
        banner.className = 'error-banner';
        banner.textContent = msg;
        body.appendChild(banner);
      },
    });

    this.stepManager.start();
  }
}
