import {LitElement, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';

@customElement('number-input')
export class NumberInputElement extends LitElement { 
    @property()
    label: string;

    render() {
        return html`
          ${this.label}: <input type="number">
        `;
      }
}

