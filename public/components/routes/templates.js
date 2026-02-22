import { fetchJsonWithStatusDeduped } from '../../shared/api.js';

const html = String.raw;

class AppRouteTemplates extends HTMLElement {
  connectedCallback() {
    this.innerHTML = html`
      <div class="route-header">
        <h3>Templates</h3>
        <p>Templates ready to bootstrap new workspaces.</p>
      </div>
      <div class="route-cards cards-grid-auto" data-templates-container>
        <div class="route-empty route-loading"><div class="route-loading-spinner" aria-label="Loading" role="status"></div></div>
      </div>
    `;
    this.loadTemplates();
  }

  async loadTemplates() {
    const container = this.querySelector("[data-templates-container]");
    if (!container) return;

    try {
      const result = await fetchJsonWithStatusDeduped("/api/templates", {
        credentials: 'include'
      }, { windowMs: 2000 });
      if (!result.ok) throw new Error("Failed to load templates.");
      const templates = Array.isArray(result.data?.templates) ? result.data.templates : [];

      container.innerHTML = "";
      if (templates.length === 0) {
        container.innerHTML = html`<div class="route-empty">No templates yet.</div>`;
        return;
      }

      for (const template of templates) {
        const card = document.createElement("div");
        card.className = "route-card";
        card.innerHTML = html`
          <div class="route-title">${template.name}</div>
          <div>${template.description}</div>
          <div class="route-meta">${template.category}</div>
        `;
        container.appendChild(card);
      }
    } catch (error) {
      container.innerHTML = html`<div class="route-empty">Unable to load templates.</div>`;
    }
  }
}

customElements.define("app-route-templates", AppRouteTemplates);
