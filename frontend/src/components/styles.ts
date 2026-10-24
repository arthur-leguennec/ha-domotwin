import { css } from "lit";

/** Look shared by the card, the panel and the overlays; follows the Home Assistant theme. */
export const baseStyles = css`
  :host {
    font-family: var(
      --domotwin-font-family,
      var(--ha-font-family-body, var(--paper-font-body1_-_font-family, system-ui, sans-serif))
    );
    color: var(--primary-text-color, #1f2328);
    -webkit-font-smoothing: antialiased;
  }

  .glass {
    background: var(--card-background-color, #fff);
    background: color-mix(in srgb, var(--card-background-color, #fff) 80%, transparent);
    -webkit-backdrop-filter: blur(14px) saturate(1.2);
    backdrop-filter: blur(14px) saturate(1.2);
    border: 1px solid var(--divider-color, rgba(0, 0, 0, 0.12));
    border-radius: 16px;
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1);
  }

  button.action {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 16px;
    border: none;
    border-radius: 999px;
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition:
      filter 120ms ease,
      transform 120ms ease;
  }

  button.action.quiet {
    background: transparent;
    color: var(--primary-text-color, #1f2328);
  }

  button.action:hover {
    filter: brightness(1.08);
  }

  button.action:active {
    transform: scale(0.98);
  }

  button:focus-visible,
  [tabindex]:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }

  svg.icon {
    width: 20px;
    height: 20px;
    fill: currentColor;
    flex: none;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition: none !important;
    }
  }
`;

/**
 * The night looks (D-027) keep their overlays, dialogs and header dark, whatever the dashboard's
 * theme: on the element with the `look` attribute.
 */
export const lookStyles = css`
  :host([look="neon"]) {
    --card-background-color: #0b1426;
    --primary-background-color: #070c18;
    --secondary-background-color: #101c33;
    --primary-text-color: #e8f2ff;
    --secondary-text-color: #9fb3cf;
    --divider-color: rgba(130, 200, 255, 0.22);
    --primary-color: var(--domotwin-accent, #00d4ff);
    --text-primary-color: #04121f;
    --app-header-background-color: #0b1426;
    --app-header-text-color: #e8f2ff;
  }
  :host([look="blueprint"]) {
    --card-background-color: #0e3474;
    --primary-background-color: #0b2c63;
    --secondary-background-color: #13408a;
    --primary-text-color: #f2f7ff;
    --secondary-text-color: #b9cdee;
    --divider-color: rgba(255, 255, 255, 0.25);
    --primary-color: #ffffff;
    --text-primary-color: #0b2c63;
    --app-header-background-color: #0b2c63;
    --app-header-text-color: #f2f7ff;
  }
`;
