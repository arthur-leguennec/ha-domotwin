import { css } from "lit";

/** Look shared by the card, the panel and the overlays; follows the Home Assistant theme. */
export const baseStyles = css`
  :host {
    /* The card's font, then the bundled one (D-042) for what it lacks. */
    font-family:
      var(--domotwin-font-family, "DomoTwin Inter"), "DomoTwin Inter", system-ui, sans-serif;
    color: var(--primary-text-color, #1f2328);
    -webkit-font-smoothing: antialiased;
  }

  /* Browsers give controls their own font. */
  button,
  input,
  select,
  textarea {
    font-family: inherit;
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

  button.action:disabled {
    opacity: 0.5;
    cursor: default;
    filter: none;
    transform: none;
  }

  button:focus-visible,
  [tabindex]:focus-visible,
  a:focus-visible,
  input:focus-visible,
  select:focus-visible,
  textarea:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--primary-color, #03a9f4);
    outline-offset: 2px;
  }

  /* A dialog takes the focus to hand it on: no ring around all of it. */
  [role="dialog"]:focus,
  [role="alertdialog"]:focus {
    outline: none;
  }

  /* For screen readers only. */
  .hidden-text {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  svg.icon {
    width: 20px;
    height: 20px;
    fill: currentColor;
    flex: none;
  }
  /*
   * Right to left (D-082): the element Home Assistant shows turns round (its \`dir\`), and with
   * it what points back or on, every browser alike.
   */
  :host([dir="rtl"]) {
    --domotwin-mirror: -1;
  }
  svg.icon.mirrored {
    transform: scaleX(var(--domotwin-mirror, 1));
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
 * The night looks (D-027) keep their overlays, dialogs and header dark, and the cartoon and the
 * clay (D-036) light (their sky is always bright), whatever the dashboard's theme: on the element
 * with the `look` attribute.
 */
export const lookStyles = css`
  :host([look="neon"]) {
    --card-background-color: #15112b;
    --primary-background-color: #0b0920;
    --secondary-background-color: #1e1838;
    --primary-text-color: #f4efff;
    --secondary-text-color: #b3a9d4;
    --divider-color: rgba(200, 180, 255, 0.2);
    --primary-color: var(--domotwin-accent, #ffae45);
    --text-primary-color: #1a1206;
    --app-header-background-color: #15112b;
    --app-header-text-color: #f4efff;
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
  :host([look="cartoon"]) {
    /* The ink of its outlines (theme.rs). */
    --domotwin-ink: #1b1d29;
    --card-background-color: #ffffff;
    --primary-background-color: #f4fbff;
    --secondary-background-color: #e6f5ff;
    --primary-text-color: var(--domotwin-ink);
    --secondary-text-color: #4a4f63;
    --divider-color: rgba(27, 29, 41, 0.22);
    --app-header-background-color: #2b9cf2;
    --app-header-text-color: #ffffff;
  }
  :host([look="clay"]) {
    --card-background-color: #f8f6f2;
    --primary-background-color: #efebe4;
    --secondary-background-color: #e6e0d6;
    --primary-text-color: #3c372f;
    --secondary-text-color: #6a6257;
    --divider-color: rgba(60, 55, 47, 0.18);
    --app-header-background-color: #e2dbcf;
    --app-header-text-color: #3c372f;
  }
`;
