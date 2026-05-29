import { KycWidget } from './KycWidget.js';

if (!customElements.get('kyc-widget')) {
  customElements.define('kyc-widget', KycWidget);
}

export { KycWidget };
